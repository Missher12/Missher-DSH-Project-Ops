/**
 * Project Ops client plugin (browser half).
 *
 * Contributes one session-header action that browses every delivery record of
 * the current workspace: the root `PLAN.md`/`READY.md` pair and every direct
 * directory under `docs/tasks` that holds either document — dated managed
 * layouts, older naming and plain human-written records alike.
 *
 * Paging is a client cursor over the one directory listing the Host exposes
 * (the remote has no cursor of its own): each read examines a fixed batch of
 * candidate directories and returns the offset of the next batch, so a record
 * behind any number of empty directories stays reachable while every single
 * read stays bounded. The read is read-only and never scans outside the session
 * workspace; the preview is the native right-sidebar file view.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { documentStatus, headingTitle } from './document-status.ts'
import { en, NS, zh, type ProjectOpsKey } from './locales.ts'
import { ProjectOpsAction, type Face } from './ProjectOpsAction.tsx'
import { installStyles } from './styles.ts'
import type { TaskLink, TaskListResult } from './task-view.ts'
import type { WorkspaceDirectoryEntry, WorkspaceDirectoryListing } from '@deepseek-ai/dsh-api-workspace-files/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Key domain of the `projectOps` namespace declared by {@link NS}. */
    projectOps: ProjectOpsKey
  }
}

/** The task identity surface, re-exported for consumers that only read documents. */
export type { TaskLink, TaskListResult } from './task-view.ts'

/**
 * Required client services: only the slot registry and the dictionaries.
 *
 * The file remotes and the native preview stay optional: a cordis 4.x plugin
 * `inject` entry is a hard activation requirement, so listing them here would
 * remove the whole Project Ops entry from a Host that lacks one of them.
 */
export const inject = ['slots', 'locale']

/** Optional native services, named exactly as the kernel names them. */
export const OPTIONAL_SERVICES = ['remote.workspaceFiles', 'sidebarRight'] as const
export type OptionalService = typeof OPTIONAL_SERVICES[number]

/** Whether a live service actually exposes every method this panel calls. */
function hasMethods(service: unknown, members: readonly string[]): boolean {
  if (typeof service !== 'object' || service === null) return false
  const face = service as Record<string, unknown>
  return members.every(member => typeof face[member] === 'function')
}

/**
 * Optional-service accessor of one plugin activation.
 *
 * `ctx.get(name)` is the kernel's documented accessor **without the inject
 * requirement**: it looks the service up by its full name in the isolate store
 * (so the nested service's own name, `remote.workspaceFiles`, is the key), and
 * its strict default returns `undefined` while the providing fiber is inactive.
 * Reading the nested property off `ctx.remote` instead goes through the
 * namespace accessor, which requires that exact name to be injected and throws
 * `cannot get property "remote.workspaceFiles" without inject` otherwise — the
 * failure that removed the whole Project Ops entry from the official alpha.5
 * Web build.
 *
 * Nothing is cached here: a deactivated provider must not keep reporting as
 * available, and the kernel already answers that question per call.
 */
export function optionalServices(ctx: Context) {
  return {
    /** The service, or `undefined` when this Host does not currently provide it. */
    get(name: OptionalService): unknown {
      return ctx.get(name)
    },
  }
}

/** Candidate directories examined by one read; the next batch starts right after them. */
export const BATCH = 32

/** Requests at most in flight; one inaccessible entry never hides the others. */
const READ_CONCURRENCY = 4

/** Bytes read per document; the document contract rejects larger files. */
const DOCUMENT_BYTES = 128 * 1024

/** Directory warnings kept per page. */
const MAX_WARNINGS = 5

/** Bounded display length of a read-problem message. */
const MAX_PROBLEM = 300

/** One load generation's directory snapshot, owned by a single session face. */
interface Snapshot {
  sessionId: SessionId
  candidates: string[]
  truncated: boolean
  warnings: string[]
  rootRow?: TaskLink
}

/** The dated managed layout; a directory that does not match is shown as legacy. */
const MANAGED_DIRECTORY = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u

/** Run `work` over `items` with a fixed number of workers, honouring cancellation. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await work(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

/** Bound one diagnostic message for display. */
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, MAX_PROBLEM)
}

/**
 * Register the dictionaries, the stylesheet and the session-header action.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  installStyles(ctx)
  const optional = optionalServices(ctx)
  const workspaceFiles = (): Context['remote']['workspaceFiles'] | undefined => {
    const service = optional.get('remote.workspaceFiles')
    return hasMethods(service, ['list', 'readBytes']) ? service as Context['remote']['workspaceFiles'] : undefined
  }
  const preview = (): Context['sidebarRight'] | undefined => {
    const service = optional.get('sidebarRight')
    return hasMethods(service, ['openResource']) ? service as Context['sidebarRight'] : undefined
  }
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: '@missher/dsh-project-ops',
    locale: NS,
    order: 140,
    inject: (sessionId: SessionId): Face => {
      // One directory snapshot per load generation, owned by THIS session's face:
      // the Host listing has no cursor, so paging re-lists nothing and later
      // batches are served from this snapshot. Only a first batch (offset 0) of
      // this face builds a new one, so two sessions paging in parallel can never
      // replace each other's cursor, and directory churn cannot duplicate or drop
      // rows mid-pagination.
      let snapshot: Snapshot | undefined
      return {
      surface: () => ({ list: workspaceFiles() !== undefined, preview: preview() !== undefined }),
      /**
       * Read one bounded batch of deliveries.
       * @param signal - caller cancellation.
       * @param options - `offset` into the Host's `docs/tasks` candidate list.
       * @returns this batch's rows (the root row only on the first batch), the next offset and warnings.
       */
      async list(signal, options): Promise<TaskListResult> {
        const files = workspaceFiles()
        if (files === undefined) throw new Error('the workspace-files remote (remote.workspaceFiles.list/readBytes) is unavailable on this Host')
        const offset = Math.max(0, Math.floor(options?.offset ?? 0))

        /** List one directory; `undefined` when it does not exist. */
        const listDir = async (path: string) => {
          const listing = await files.list(sessionId, path, signal)
          if (listing.ok) return listing.value
          if (listing.error.code === 'workspace-file/not-found') return undefined
          throw new Error(listing.error.message)
        }

        /** Read one document; absence is not an error, and one bad document never hides the other. */
        const readDoc = async (path: string): Promise<{ text: string } | { missing: true } | { problem: string }> => {
          try {
            const response = await files.readBytes(sessionId, path, { range: { offset: 0, length: DOCUMENT_BYTES } }, signal)
            if (!response.ok) {
              return response.error.code === 'workspace-file/not-found' ? { missing: true } : { problem: messageOf(response.error.message) }
            }
            if (!response.value.eof) return { problem: 'document is larger than the 128 KiB read limit' }
            return { text: new TextDecoder('utf-8', { fatal: true }).decode(response.value.data) }
          } catch (error) {
            signal.throwIfAborted()
            return { problem: messageOf(error) }
          }
        }

        /**
         * Turn one real directory listing into a row.
         *
         * Presence comes from that listing; a truncated listing is probed
         * directly so a PLAN/READY entry is not crowded out by other files.
         * Each document read is isolated: a broken PLAN still yields the READY
         * title, and a PLAN that does not exist is never enabled.
         */
        const examine = async (
          origin: 'root' | 'tasks', name: string, path: string, listing: WorkspaceDirectoryListing,
        ): Promise<TaskLink | undefined> => {
          signal.throwIfAborted()
          const has = (file: string) => listing.entries.some(entry => entry.type === 'file' && entry.name === file)
          const join = (file: string) => origin === 'root' ? file : `${path}/${file}`
          let plan = has('PLAN.md')
          let ready = has('READY.md')
          let planText: string | undefined
          let readyText: string | undefined
          const problems: string[] = []
          const readPlan = async () => {
            const result = await readDoc(join('PLAN.md'))
            if ('text' in result) planText = result.text
            else if ('missing' in result) plan = false
            else problems.push(result.problem)
          }
          const readReady = async () => {
            const result = await readDoc(join('READY.md'))
            if ('text' in result) readyText = result.text
            else if ('missing' in result) ready = false
            else problems.push(result.problem)
          }
          if (plan) await readPlan()
          if (ready) await readReady()
          // A truncated child listing may have dropped the document entries.
          if (listing.truncated) {
            if (!plan) {
              const probe = await readDoc(join('PLAN.md'))
              if ('text' in probe) { plan = true; planText = probe.text } else if ('problem' in probe) problems.push(probe.problem)
            }
            if (!ready) {
              const probe = await readDoc(join('READY.md'))
              if ('text' in probe) { ready = true; readyText = probe.text } else if ('problem' in probe) problems.push(probe.problem)
            }
          }
          if (!plan && !ready && problems.length === 0) return undefined
          const identity = origin === 'root' ? '.' : name
          const status = await documentStatus(identity, planText, readyText)
          const title = status.title ?? headingTitle(planText) ?? headingTitle(readyText)
          const link: TaskLink = {
            id: name, path, origin, legacy: origin === 'tasks' && !MANAGED_DIRECTORY.test(name), plan, ready,
            delivery: status.delivery, managed: status.managed, artifacts: status.artifacts,
          }
          if (status.damaged === true) link.damaged = true
          if (status.artifactsTruncated === true) link.artifactsTruncated = true
          if (status.verification !== undefined) link.verification = status.verification
          if (status.verificationTruncated === true) link.verificationTruncated = true
          if (title !== undefined) link.title = title
          const problem = problems[0]
          if (problem !== undefined) link.problem = problem
          return link
        }

        // A first batch (or a new session) captures the directory snapshot; every
        // later batch of the same generation reuses it untouched.
        if (offset === 0 || snapshot === undefined || snapshot.sessionId !== sessionId) {
          const captured: Snapshot = { sessionId, candidates: [], truncated: false, warnings: [] }
          // The workspace root documents are read first and are never dropped
          // by a `docs/tasks` failure; only their own error becomes a warning.
          try {
              const rootListing = await listDir('.')
              if (rootListing !== undefined) {
                const rootRow = await examine('root', '.', '.', rootListing)
                if (rootRow !== undefined) captured.rootRow = rootRow
              }
          } catch (error) {
            signal.throwIfAborted()
            captured.warnings.push(messageOf(error))
          }
          try {
            const tasksListing = await listDir('docs/tasks')
            if (tasksListing !== undefined) {
              captured.truncated = tasksListing.truncated
              captured.candidates = tasksListing.entries
                .filter((entry): entry is WorkspaceDirectoryEntry & { type: 'directory' } => entry.type === 'directory' && entry.name.length > 0)
                // Newest first: the dated prefix sorts correctly, older layouts follow.
                .sort((left, right) => left.name < right.name ? 1 : left.name > right.name ? -1 : 0)
                .map(entry => entry.name)
            }
          } catch (error) {
            signal.throwIfAborted()
            captured.warnings.push(messageOf(error))
          }
          // A cancelled build never publishes its snapshot.
          signal.throwIfAborted()
          snapshot = captured
        }
        const current = snapshot
        const candidates = current?.candidates ?? []
        const batch = candidates.slice(offset, offset + BATCH)
        const rows = await pool(batch, READ_CONCURRENCY, async (name): Promise<TaskLink | undefined> => {
          const path = `docs/tasks/${name}`
          try {
            const listing = await listDir(path)
            if (listing === undefined) return undefined
            return await examine('tasks', name, path, listing)
          } catch (error) {
            signal.throwIfAborted()
            // A directory that cannot be listed stays visible with its reason.
            return {
              id: name, path, origin: 'tasks', legacy: !MANAGED_DIRECTORY.test(name),
              plan: false, ready: false, delivery: 'inspect', managed: false, artifacts: [], problem: messageOf(error),
            }
          }
        })
        const found = rows.filter((row): row is TaskLink => row !== undefined)
        const nextOffset = Math.min(offset + batch.length, candidates.length)
        return {
          tasks: offset === 0 && current?.rootRow !== undefined ? [current.rootRow, ...found] : found,
          nextOffset,
          total: candidates.length,
          pending: Math.max(0, candidates.length - nextOffset),
          truncated: current?.truncated ?? false,
          // Warnings describe the snapshot build, so only the first batch carries them.
          warnings: offset === 0 ? (current?.warnings ?? []).slice(0, MAX_WARNINGS) : [],
        }
      },
      open: (path, file) => {
        // The panel disables both actions when the preview is absent; this guard
        // keeps the no-op explicit instead of throwing out of a click handler.
        preview()?.openResource(sessionFileAddress(sessionId, path === '.' ? file : `${path}/${file}`))
      },
      }
    },
  }, ProjectOpsAction)))
}
