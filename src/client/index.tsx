/**
 * Project Ops client plugin (browser half).
 *
 * Two bounded views over recorded deliveries:
 *
 * - **current project**: the session's own workspace root documents plus every
 *   direct `docs/tasks` directory holding a PLAN/READY pair.
 * - **all projects**: every Workspace the Host has registered, whether or not it
 *   has sessions or documents, read through a session whose `cwd` is exactly the
 *   registered project path. No disk scan, no session body, no session creation.
 *
 * The Host file remote is session-scoped and its directory listing has no
 * cursor, so paging is a client snapshot per load generation: later batches of a
 * project are served from the snapshot captured when that project was read, and
 * only a refresh (offset 0) captures a new one. Every row carries the session
 * that produced it, so the native preview opens in the right project.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { documentStatus, headingTitle } from './document-status.ts'
import { en, NS, zh, type ProjectOpsKey } from './locales.ts'
import { ProjectOpsAction, type Face } from './ProjectOpsAction.tsx'
import { installStyles } from './styles.ts'
import {
  MAX_PROJECTS_PER_READ, type OverviewResult, type ProjectGroup, type ProjectStatus,
  type TaskLink, type TaskListResult,
} from './task-view.ts'
import {
  FILE_PAGE, FILE_ROOTS, safeFilePath, sortFileEntries, underRoot,
  type FileEntryView, type FilesPage, type ProjectOption,
} from './files.ts'
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
 * The file remotes, the native preview and the workspace/session registries stay
 * optional: a cordis 4.x plugin `inject` entry is a hard activation requirement,
 * so listing them here would remove the whole Project Ops entry from a Host that
 * lacks one of them. Each is probed at call time instead.
 */
export const inject = ['slots', 'locale']

/** Optional native services, named exactly as the kernel names them. */
export const OPTIONAL_SERVICES = ['remote.workspaceFiles', 'sidebarRight', 'workspaces', 'sessions'] as const
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
 * requirement**: it looks the service up by its full name in the isolate store,
 * and its strict default returns `undefined` while the providing fiber is
 * inactive. Reading a nested property off `ctx.remote` instead goes through the
 * namespace accessor, which requires that exact name to be injected and throws
 * `cannot get property "…" without inject` otherwise — the failure that removed
 * the whole Project Ops entry from the official alpha.5 Web build.
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

/** Requests at most in flight inside one project page. */
const READ_CONCURRENCY = 4

/** Projects read at the same time by one overview page. */
const PROJECT_CONCURRENCY = 2

/** Bytes read per document; the document contract rejects larger files. */
const DOCUMENT_BYTES = 128 * 1024

/** Directory warnings kept per page. */
const MAX_WARNINGS = 5

/** Bounded display length of a read-problem message. */
const MAX_PROBLEM = 300

/** The dated managed layout; a directory that does not match is shown as legacy. */
const MANAGED_DIRECTORY = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u

/** One project's directory snapshot for the current load generation. */
interface Snapshot {
  /** Session whose workspace is exactly this project path. */
  sessionId: string
  candidates: string[]
  truncated: boolean
  warnings: string[]
  rootRow?: TaskLink
  /** A root or `docs/tasks` read failed: the snapshot is partial, not complete. */
  incomplete: boolean
  /** Project identity of a cross-project snapshot, for continuation checks. */
  workspaceId?: string
  path?: string
}

/** One Host-registered project, defensively validated from the registry snapshot. */
interface RegisteredProject {
  workspaceId: string
  path: string
  title: string
}

/** Normalize a project path for exact comparison (trailing separators only). */
function normalizePath(value: string): string {
  return value.length > 1 ? value.replace(/[\\/]+$/u, '') : value
}

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

/** Read the Host workspace registry snapshot into bounded project rows. */
function readProjects(service: unknown): RegisteredProject[] | undefined {
  const registry = service as { list?: { getSnapshot?: () => unknown } } | undefined
  if (registry === undefined || registry.list === undefined || typeof registry.list.getSnapshot !== 'function') return undefined
  const snapshot = registry.list.getSnapshot() as { items?: unknown, state?: unknown, phase?: unknown, error?: unknown } | undefined
  if (snapshot === undefined || snapshot === null) return undefined
  // A loading or failed registry is not an authoritative empty project list.
  if (snapshot.error !== undefined && snapshot.error !== null) return undefined
  if (snapshot.state === 'loading' || snapshot.state === 'error' || snapshot.phase === 'pending' || snapshot.phase === 'loading') return undefined
  if (!Array.isArray(snapshot.items)) return undefined
  const items = snapshot.items
  const projects: RegisteredProject[] = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const row = item as { workspaceId?: unknown, path?: unknown, title?: unknown }
    if (typeof row.workspaceId !== 'string' || row.workspaceId.length === 0 || typeof row.path !== 'string' || row.path.length === 0) continue
    const title = typeof row.title === 'string' && row.title.trim().length > 0 ? row.title : row.path
    projects.push({ workspaceId: row.workspaceId, path: normalizePath(row.path), title })
  }
  return projects
}

/** Map registered project paths to one session whose `cwd` is exactly that path. */
function readSessionCwds(service: unknown): Map<string, string> | undefined {
  const registry = service as { list?: { getSnapshot?: () => unknown } } | undefined
  if (registry === undefined || registry.list === undefined || typeof registry.list.getSnapshot !== 'function') return undefined
  const snapshot = registry.list.getSnapshot() as { byId?: unknown, state?: unknown, error?: unknown } | undefined
  if (snapshot === undefined || snapshot === null) return undefined
  if (snapshot.error !== undefined && snapshot.error !== null) return undefined
  if (snapshot.state === 'loading' || snapshot.state === 'error') return undefined
  // The Host also reports `phase: 'pending'` while its registry is still loading.
  if (snapshot.phase === 'pending' || snapshot.phase === 'loading') return undefined
  // A missing map is unknown, never "no session exists".
  if (snapshot.byId === undefined || snapshot.byId === null || typeof snapshot.byId !== 'object') return undefined
  const byId = snapshot.byId as Record<string, unknown>
  const byCwd = new Map<string, string>()
  for (const value of Object.values(byId)) {
    if (value === null || typeof value !== 'object') continue
    const row = value as { id?: unknown, cwd?: unknown }
    if (typeof row.id !== 'string' || row.id.length === 0 || typeof row.cwd !== 'string' || row.cwd.length === 0) continue
    const key = normalizePath(row.cwd)
    // First readable session wins; a foreign cwd never matches a project path.
    if (!byCwd.has(key)) byCwd.set(key, row.id)
  }
  return byCwd
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
  const projectsAvailable = (): boolean => readProjects(optional.get('workspaces')) !== undefined && readSessionCwds(optional.get('sessions')) !== undefined
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: '@missher/dsh-project-ops',
    locale: NS,
    order: 140,
    inject: (sessionId: SessionId): Face => {
      // One snapshot map per load generation, owned by THIS session's face: the
      // Host listing has no cursor, so paging re-lists nothing and later batches
      // are served from the snapshot captured for that project. A first page
      // (projectOffset 0 or current-project offset 0) captures fresh snapshots,
      // and another session's face can never replace this one's cursors.
      let snapshots = new Map<string, Snapshot>()
      // The registered project list is captured once per load generation, so a
      // reordered or changed registry cannot duplicate or skip a project while
      // paginating; a first project page (projectOffset 0) captures a new one.
      let projectSnapshot: RegisteredProject[] | undefined
      const scopeId = String(sessionId)

      /** List one directory inside one session's workspace. */
      const listDir = async (scope: string, path: string, signal: AbortSignal) => {
        const files = workspaceFiles()
        if (files === undefined) throw new Error('the workspace-files remote (remote.workspaceFiles.list/readBytes) is unavailable on this Host')
        const listing = await files.list(scope as SessionId, path, signal)
        if (listing.ok) return listing.value
        if (listing.error.code === 'workspace-file/not-found') return undefined
        throw new Error(listing.error.message)
      }

      /** Read one document; absence is not an error, and one bad document never hides the other. */
      const readDoc = async (scope: string, path: string, signal: AbortSignal): Promise<{ text: string } | { missing: true } | { problem: string }> => {
        const files = workspaceFiles()
        if (files === undefined) throw new Error('the workspace-files remote is unavailable on this Host')
        try {
          const response = await files.readBytes(scope as SessionId, path, { range: { offset: 0, length: DOCUMENT_BYTES } }, signal)
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
       * Presence comes from that listing; a truncated listing is probed directly
       * so a PLAN/READY entry is not crowded out. Each document read is isolated:
       * a broken PLAN still yields the READY title, and a PLAN that does not exist
       * is never enabled. The row keeps its producing session for the preview.
       */
      const examine = async (
        scope: string, origin: 'root' | 'tasks', name: string, path: string,
        listing: WorkspaceDirectoryListing, signal: AbortSignal,
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
          const result = await readDoc(scope, join('PLAN.md'), signal)
          if ('text' in result) planText = result.text
          else if ('missing' in result) plan = false
          else problems.push(result.problem)
        }
        const readReady = async () => {
          const result = await readDoc(scope, join('READY.md'), signal)
          if ('text' in result) readyText = result.text
          else if ('missing' in result) ready = false
          else problems.push(result.problem)
        }
        if (plan) await readPlan()
        if (ready) await readReady()
        if (listing.truncated) {
          if (!plan) {
            const probe = await readDoc(scope, join('PLAN.md'), signal)
            if ('text' in probe) { plan = true; planText = probe.text } else if ('problem' in probe) problems.push(probe.problem)
          }
          if (!ready) {
            const probe = await readDoc(scope, join('READY.md'), signal)
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
          production: status.production, sessionId: scope,
        }
        if (status.damaged === true) link.damaged = true
        if (status.artifactsTruncated === true) link.artifactsTruncated = true
        if (status.productionRejected !== undefined) link.productionRejected = status.productionRejected
        if (status.verification !== undefined) link.verification = status.verification
        if (status.verificationTruncated === true) link.verificationTruncated = true
        if (title !== undefined) link.title = title
        const problem = problems[0]
        if (problem !== undefined) link.problem = problem
        return link
      }

      /** Capture this project's directory snapshot (root documents + candidates). */
      const buildSnapshot = async (scope: string, signal: AbortSignal): Promise<Snapshot> => {
        const captured: Snapshot = { sessionId: scope, candidates: [], truncated: false, warnings: [], incomplete: false }
        try {
          const rootListing = await listDir(scope, '.', signal)
          if (rootListing !== undefined) {
            const rootRow = await examine(scope, 'root', '.', '.', rootListing, signal)
            if (rootRow !== undefined) captured.rootRow = rootRow
          }
        } catch (error) {
          signal.throwIfAborted()
          captured.incomplete = true
          captured.warnings.push(messageOf(error))
        }
        try {
          const tasksListing = await listDir(scope, 'docs/tasks', signal)
          if (tasksListing !== undefined) {
            captured.truncated = tasksListing.truncated
            captured.candidates = tasksListing.entries
              .filter((entry): entry is WorkspaceDirectoryEntry & { type: 'directory' } => entry.type === 'directory' && entry.name.length > 0)
              .sort((left, right) => left.name < right.name ? 1 : left.name > right.name ? -1 : 0)
              .map(entry => entry.name)
          }
        } catch (error) {
          signal.throwIfAborted()
          captured.incomplete = true
          captured.warnings.push(messageOf(error))
        }
        signal.throwIfAborted()
        return captured
      }

      /** Read one bounded batch of a project's candidate directories. */
      const readBatch = async (snapshot: Snapshot, offset: number, signal: AbortSignal) => {
        const batch = snapshot.candidates.slice(offset, offset + BATCH)
        const rows = await pool(batch, READ_CONCURRENCY, async (name): Promise<TaskLink | undefined> => {
          const path = `docs/tasks/${name}`
          try {
            const listing = await listDir(snapshot.sessionId, path, signal)
            if (listing === undefined) return undefined
            return await examine(snapshot.sessionId, 'tasks', name, path, listing, signal)
          } catch (error) {
            signal.throwIfAborted()
            return {
              id: name, path, origin: 'tasks', legacy: !MANAGED_DIRECTORY.test(name),
              plan: false, ready: false, delivery: 'inspect', managed: false, artifacts: [], production: [],
              sessionId: snapshot.sessionId, problem: messageOf(error),
            }
          }
        })
        const found = rows.filter((row): row is TaskLink => row !== undefined)
        const nextOffset = Math.min(offset + batch.length, snapshot.candidates.length)
        return { rows: found, nextOffset, total: snapshot.candidates.length, pending: Math.max(0, snapshot.candidates.length - nextOffset) }
      }

      /** One group's page, shaped for the all-projects view. */
      const groupOf = (project: RegisteredProject, status: ProjectStatus, page: {
        rows: TaskLink[], nextOffset: number, total: number, pending: number
      }, snapshot: Snapshot | undefined, reason?: string): ProjectGroup => {
        const group: ProjectGroup = {
          workspaceId: project.workspaceId, path: project.path, title: project.title, status,
          rows: status === 'readable' ? page.rows : [],
          nextOffset: status === 'readable' ? page.nextOffset : 0,
          total: status === 'readable' ? page.total : 0,
          pending: status === 'readable' ? page.pending : 0,
          truncated: snapshot?.truncated ?? false,
          warnings: status === 'readable' ? snapshot?.warnings ?? [] : [],
        }
        if (snapshot?.incomplete === true) group.incomplete = true
        if (reason !== undefined) group.reason = reason
        return group
      }

      const emptyPage = { rows: [] as TaskLink[], nextOffset: 0, total: 0, pending: 0 }

      return {
        surface: () => ({ list: workspaceFiles() !== undefined, preview: preview() !== undefined, projects: projectsAvailable(), files: workspaceFiles() !== undefined }),
        /**
         * Read one bounded batch of the current project.
         * @param signal - caller cancellation.
         * @param options - `offset` into this session's candidate list.
         */
        async list(signal, options): Promise<TaskListResult> {
          const files = workspaceFiles()
          if (files === undefined) throw new Error('the workspace-files remote (remote.workspaceFiles.list/readBytes) is unavailable on this Host')
          const offset = Math.max(0, Math.floor(options?.offset ?? 0))
          const key = `current:${scopeId}`
          let snapshot = snapshots.get(key)
          if (offset === 0 || snapshot === undefined) {
            snapshot = await buildSnapshot(scopeId, signal)
            snapshots.set(key, snapshot)
          }
          const current = snapshot
          const page = await readBatch(current, offset, signal)
          return {
            tasks: offset === 0 && current.rootRow !== undefined ? [current.rootRow, ...page.rows] : page.rows,
            nextOffset: page.nextOffset,
            total: page.total,
            pending: page.pending,
            truncated: current.truncated,
            warnings: offset === 0 ? current.warnings.slice(0, MAX_WARNINGS) : [],
          }
        },
        /**
         * Read the all-projects overview, one bounded project page, or one
         * project's next batch.
         * @param signal - caller cancellation.
         * @param options - `projectOffset` for a project page; `group` for a group's next batch.
         */
        async overview(signal, options): Promise<OverviewResult> {
          const byCwd = readSessionCwds(optional.get('sessions'))
          if (byCwd === undefined) {
            throw new Error('the Host workspace registry (workspaces.list / sessions.list snapshots) is unavailable on this Host')
          }
          const groupMode = options?.group !== undefined
          const projectOffset = Math.max(0, Math.floor(options?.projectOffset ?? 0))
          // A first project page (or the very first call) captures the registry;
          // later pages reuse it. The per-project cursors are rebuilt only here.
          if (!groupMode && (projectOffset === 0 || projectSnapshot === undefined)) {
            projectSnapshot = readProjects(optional.get('workspaces'))
            if (projectSnapshot !== undefined) snapshots = new Map()
          }
          if (projectSnapshot === undefined) projectSnapshot = readProjects(optional.get('workspaces'))
          if (projectSnapshot === undefined) {
            throw new Error('the Host workspace registry (workspaces.list / sessions.list snapshots) is unavailable on this Host')
          }
          const projects: RegisteredProject[] = projectSnapshot
          // A group continuation: one loaded project's next batch.
          if (options?.group !== undefined) {
            const project = projects.find(row => row.workspaceId === options.group!.workspaceId)
            if (project === undefined) throw new Error('the project is no longer registered; refresh the overview')
            const key = `project:${project.workspaceId}:${project.path}`
            const snapshot = snapshots.get(key)
            if (snapshot === undefined) throw new Error('the project is not loaded; refresh the overview')
            // The continued cursor is only valid while the CURRENT registry still
            // holds the same project id and path, and the same session can read it.
            const live = readProjects(optional.get('workspaces'))
            if (live === undefined) throw new Error('the Host project registry is not ready; refresh the overview')
            const latest = live.find(row => row.workspaceId === project.workspaceId)
            if (latest === undefined) throw new Error('the project was removed from the Host registry; refresh the overview')
            if (latest.path !== snapshot.path) throw new Error('the project path changed in the Host registry; refresh the overview')
            const session = byCwd.get(latest.path)
            if (session === undefined || session !== snapshot.sessionId) {
              throw new Error('the project session is no longer available; refresh the overview')
            }
            const page = await readBatch(snapshot, Math.max(0, Math.floor(options.group.offset)), signal)
            return {
              groups: [groupOf(project, 'readable', page, snapshot)],
              pendingProjects: 0, totalProjects: 0, nextProjectOffset: 0, warnings: [],
            }
          }
          const slice = projects.slice(projectOffset, projectOffset + MAX_PROJECTS_PER_READ)
          // Every page re-checks the CURRENT registry: a project that vanished or
          // moved must not be served from an old ordering.
          const live = readProjects(optional.get('workspaces'))
          const groups = await pool(slice, PROJECT_CONCURRENCY, async project => {
            if (live === undefined) return groupOf(project, 'unreadable', emptyPage, undefined, 'the Host project registry is not ready; refresh the overview')
            const latest = live.find(row => row.workspaceId === project.workspaceId)
            if (latest === undefined) return groupOf(project, 'unreadable', emptyPage, undefined, 'the project was removed from the Host registry; refresh the overview')
            if (latest.path !== project.path) return groupOf(project, 'unreadable', emptyPage, undefined, 'the project path changed in the Host registry; refresh the overview')
            const key = `project:${project.workspaceId}:${project.path}`
            const session = byCwd.get(project.path)
            // A session moved into another directory never serves this project.
            if (session === undefined) return groupOf(project, 'no-session', emptyPage, undefined, 'no registered session reports this project path as its cwd')
            try {
              const snapshot = snapshots.get(key) ?? await buildSnapshot(session, signal)
              snapshot.workspaceId = project.workspaceId
              snapshot.path = project.path
              snapshots.set(key, snapshot)
              const page = await readBatch(snapshot, 0, signal)
              // The project's own root PLAN/READY pair opens the group; deeper
              // batches (offset > 0) never repeat it.
              const rows = snapshot.rootRow === undefined ? page.rows : [snapshot.rootRow, ...page.rows]
              return groupOf(project, 'readable', { ...page, rows }, snapshot)
            } catch (error) {
              signal.throwIfAborted()
              return groupOf(project, 'unreadable', emptyPage, undefined, messageOf(error))
            }
          })
          const nextProjectOffset = Math.min(projectOffset + slice.length, projects.length)
          return {
            groups,
            pendingProjects: Math.max(0, projects.length - nextProjectOffset),
            totalProjects: projects.length,
            nextProjectOffset,
            warnings: [],
          }
        },
        /** Read the registered projects for the files view selector; no directory reads. */
        async projects(signal): Promise<ProjectOption[]> {
          const projects = readProjects(optional.get('workspaces'))
          const byCwd = readSessionCwds(optional.get('sessions'))
          if (projects === undefined || byCwd === undefined) {
            throw new Error('the Host workspace registry is not ready; retry when the Host finishes loading')
          }
          signal.throwIfAborted()
          return projects.map(project => ({
            workspaceId: project.workspaceId,
            path: project.path,
            title: project.title,
            readable: byCwd.has(project.path),
          }))
        },
        /**
         * Read one bounded page of one project directory.
         * @param signal - caller cancellation.
         * @param options - `root`, `path`, display `offset`, and an optional registered project.
         */
        async files(signal, options): Promise<FilesPage> {
          const files = workspaceFiles()
          if (files === undefined) throw new Error('the workspace-files remote (remote.workspaceFiles.list/readBytes) is unavailable on this Host')
          const root = options?.root ?? '.'
          const path = options?.path ?? root
          if (!(FILE_ROOTS as readonly string[]).includes(root) || !safeFilePath(path) || !underRoot(root, path)) {
            throw new Error('unsupported project directory request')
          }
          let scope = scopeId
          if (options?.project !== undefined) {
            const projects = readProjects(optional.get('workspaces'))
            const byCwd = readSessionCwds(optional.get('sessions'))
            if (projects === undefined || byCwd === undefined) throw new Error('the Host project registry is not ready')
            const project = projects.find(row => row.workspaceId === options.project)
            if (project === undefined) throw new Error('the project is no longer registered; refresh the overview')
            const session = byCwd.get(project.path)
            if (session === undefined) throw new Error('the project has no readable session')
            scope = session
          }
          const offset = Math.max(0, Math.floor(options?.offset ?? 0))
          const listing = await listDir(scope, path, signal)
          if (listing === undefined) {
            return { root, path, sessionId: scope, entries: [], total: 0, nextOffset: 0, truncated: false, missing: true, warnings: [] }
          }
          const rows = sortFileEntries(listing.entries.flatMap((entry): FileEntryView[] => {
            if (entry.type !== 'file' && entry.type !== 'directory') return []
            const item: FileEntryView = {
              path: path === '.' ? entry.name : `${path}/${entry.name}`,
              name: entry.name, root, type: entry.type, sessionId: scope,
            }
            if (entry.size !== undefined) item.size = entry.size
            return [item]
          }))
          const skipped = listing.entries.length - rows.length
          const warnings: string[] = []
          if (skipped > 0) warnings.push(`${skipped} entries of an unsupported kind are not listed`)
          const entries = rows.slice(offset, offset + FILE_PAGE)
          return {
            root, path, sessionId: scope, entries, total: rows.length,
            nextOffset: Math.min(offset + entries.length, rows.length),
            truncated: listing.truncated,
            ...(warnings.length === 0 ? {} : { warnings }),
          }
        },
        /** Open one previewable file in the native right-sidebar preview, inside its project workspace. */
        openFile: (path, targetSession) => {
          preview()?.openResource(sessionFileAddress((targetSession ?? sessionId) as SessionId, path))
        },
        /** Observe native registry readiness; the shell refreshes when it changes. */
        observe: (onChange) => {
          /** Only readiness and project/session identity matter here: running state,
           * updatedAt and projection values must not reset the panel. */
          const signature = (): string => {
            const workspaceService = optional.get('workspaces') as { list?: { getSnapshot?: () => unknown } } | undefined
            const sessionService = optional.get('sessions') as { list?: { getSnapshot?: () => unknown } } | undefined
            const workspace = workspaceService?.list?.getSnapshot?.() as { items?: unknown, state?: unknown, phase?: unknown, error?: unknown } | undefined
            const session = sessionService?.list?.getSnapshot?.() as { byId?: unknown, state?: unknown, phase?: unknown, error?: unknown } | undefined
            const projects = workspace !== undefined && Array.isArray(workspace.items)
              ? (workspace.items as { workspaceId?: unknown, path?: unknown }[]).map(row => `${String(row.workspaceId)}:${String(row.path)}`).join('|')
              : '?'
            const sessions = session !== undefined && session.byId !== undefined && session.byId !== null && typeof session.byId === 'object'
              ? Object.values(session.byId as Record<string, unknown>).map(row => {
                const item = row as { id?: unknown, cwd?: unknown }
                return `${String(item.id)}:${String(item.cwd)}`
              }).sort().join('|')
              : '?'
            return [workspace?.state, workspace?.phase, workspace?.error === null ? '' : 'w-err', projects,
              session?.state, session?.phase, session?.error === null ? '' : 's-err', sessions].join('~')
          }
          let last = signature()
          const cleanups: (() => void)[] = []
          for (const name of ['workspaces', 'sessions'] as const) {
            const service = optional.get(name) as { list?: { subscribe?: (listener: () => void) => (() => void) | void } } | undefined
            if (service?.list?.subscribe === undefined) continue
            const off = service.list.subscribe(() => {
              const next = signature()
              if (next === last) return
              last = next
              onChange()
            })
            if (typeof off === 'function') cleanups.push(off)
          }
          return () => { for (const off of cleanups) off() }
        },
        open: (path, file, targetSession) => {
          // The panel disables both actions when the preview is absent; this guard
          // keeps the no-op explicit instead of throwing out of a click handler.
          // A cross-project row opens through the session that produced it.
          preview()?.openResource(sessionFileAddress((targetSession ?? sessionId) as SessionId, path === '.' ? file : `${path}/${file}`))
        },
      }
    },
  }, ProjectOpsAction)))
}
