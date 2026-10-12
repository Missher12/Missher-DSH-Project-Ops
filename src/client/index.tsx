/**
 * Project Ops client plugin (browser half).
 *
 * Contributes one session-header action that browses this session's
 * `docs/tasks` documents. The read is read-only and bounded, the preview is the
 * native right-sidebar file view, and the panel is styled with the Host's own
 * theme tokens. No new remote, no host patch, no second task store.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { documentStatus } from './document-status.ts'
import { en, NS, zh, type ProjectOpsKey } from './locales.ts'
import { ProjectOpsAction, type Face } from './ProjectOpsAction.tsx'
import { installStyles } from './styles.ts'
import type { TaskLink, TaskListResult } from './task-view.ts'
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

/** Required client services: slots, dictionaries, the file remotes and the native preview. */
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceFiles', 'sidebarRight']

/** One bounded read at a time, four requests in flight at most. */
const READ_CONCURRENCY = 4

/** More task directories than this are not read; the panel reports the truncation. */
const TASK_LIMIT = 100

/** Task directories carry a dated slug and a 16-hex revision suffix. */
const TASK_DIRECTORY = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u

/**
 * Register the dictionaries, the stylesheet and the session-header action.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  installStyles(ctx)
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: '@missher/dsh-project-ops',
    locale: NS,
    order: 140,
    inject: (sessionId: SessionId): Face => ({
      async list(signal): Promise<TaskListResult> {
        const root = await ctx.remote.workspaceFiles.list(sessionId, 'docs/tasks', signal)
        if (!root.ok) {
          if (root.error.code === 'workspace-file/not-found') return { tasks: [], truncated: false }
          throw new Error(root.error.message)
        }
        const dirs = root.value.entries
          .filter(row => row.type === 'directory' && TASK_DIRECTORY.test(row.name))
          .reverse()
        const tasks: TaskLink[] = []
        // Four requests at most in flight; one inaccessible task does not hide the others.
        const selected = dirs.slice(0, TASK_LIMIT)
        let cursor = 0
        await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, selected.length) }, async () => {
          while (cursor < selected.length) {
            const index = cursor++
            const dir = selected[index]!
            signal.throwIfAborted()
            const path = `docs/tasks/${dir.name}`
            let plan = false
            let ready = false
            try {
              const children = await ctx.remote.workspaceFiles.list(sessionId, path, signal)
              if (!children.ok) throw new Error(children.error.message)
              plan = children.value.entries.some(row => row.type === 'file' && row.name === 'PLAN.md')
              ready = children.value.entries.some(row => row.type === 'file' && row.name === 'READY.md')
              const read = async (file: string, exists: boolean) => {
                if (!exists) return undefined
                const response = await ctx.remote.workspaceFiles.readBytes(sessionId, `${path}/${file}`, { range: { offset: 0, length: 128 * 1024 } }, signal)
                if (!response.ok || !response.value.eof) throw new Error('Document unavailable or too large')
                return new TextDecoder('utf-8', { fatal: true }).decode(response.value.data)
              }
              const planText = await read('PLAN.md', plan)
              const readyText = await read('READY.md', ready)
              const status = await documentStatus(dir.name, planText, readyText)
              tasks[index] = { id: dir.name, plan, ready, ...status }
            } catch {
              signal.throwIfAborted()
              tasks[index] = { id: dir.name, plan, ready, delivery: 'inspect' }
            }
          }
        }))
        return { tasks, truncated: root.value.truncated || dirs.length > TASK_LIMIT }
      },
      open: (task, file) => ctx.sidebarRight.openResource(sessionFileAddress(sessionId, `docs/tasks/${task}/${file}`)),
    }),
  }, ProjectOpsAction)))
}
