import { documentStatus, type DeliveryState } from './document-status.ts'
import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState } from 'react'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

const zh = { title: 'Project Ops', plan: '查看方案', ready: '查看交付', loading: '正在读取项目任务…', empty: '尚无开发任务。向当前会话说明开发需求，Agent 会按任务规模维护方案与交付记录。', close: '关闭', refresh: '刷新', hint: '交付记录保留历史事实；请核对方案状态和关联修订。文件存在不代表已发布或安装。', missing: '尚未生成', error: '无法读取项目任务', truncated: '任务列表过长，当前只显示前 100 项。', current: '交付关联当前方案（不代表验收通过）', historical: '历史交付：方案已更新', inspect: '记录待核对：可能已编辑、中断或读取失败' }
const en: typeof zh = { title: 'Project Ops', plan: 'View plan', ready: 'View delivery', loading: 'Loading project tasks…', empty: 'No development tasks yet. Describe your development request in this session; the agent maintains documents when the task warrants them.', close: 'Close', refresh: 'Refresh', hint: 'Delivery records retain historical facts. Check the plan status and linked revision. A file does not imply release or installation.', missing: 'Not generated', error: 'Could not read project tasks', truncated: 'Showing the first 100 tasks.', current: 'Delivery linked to current plan (not acceptance)', historical: 'Historical delivery: plan updated', inspect: 'Review needed: edited, interrupted, or unreadable record' }
type Key = keyof typeof zh
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { projectOps: Key } }
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceFiles', 'sidebarRight']
export interface TaskLink { id: string; plan: boolean; ready: boolean; title?: string; delivery: DeliveryState }
interface Face {
  list: (signal: AbortSignal) => Promise<{ tasks: TaskLink[]; truncated: boolean }>
  open: (task: string, file: 'PLAN.md' | 'READY.md') => void
}
type Props = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'projectOps'> & Face
/** Bounded read-only task browser over the existing workspace-files remote. */
function ProjectOpsPanel({ t, list, open, sessionId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{ tasks: TaskLink[]; truncated: boolean }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setResult(undefined); setError(undefined)
    void list(controller.signal).then(value => { if (!controller.signal.aborted) setResult(value) }, reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => controller.abort()
  }, [expanded, reload, sessionId, list])
  return <div style={{ position: 'relative' }}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('title')}</button>
    {expanded && <section role="region" aria-label={t('title')} style={{ position: 'fixed', right: 16, top: 64, zIndex: 50, width: 'min(420px, 85vw)', maxHeight: '65vh', overflow: 'auto', padding: 16, border: '1px solid currentColor', borderRadius: 8, background: 'Canvas', color: 'CanvasText', boxShadow: '0 6px 24px #0003' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><strong>{t('title')}</strong><button type="button" onClick={() => setReload(value => value + 1)}>{t('refresh')}</button><button type="button" onClick={() => setExpanded(false)}>{t('close')}</button></div>
      <p>{t('hint')}</p>
      {error && <p role="alert">{t('error')}：{error}</p>}
      {!result && !error && <p role="status">{t('loading')}</p>}
      {result?.tasks.length === 0 && <p>{t('empty')}</p>}
      {result?.truncated && <p>{t('truncated')}</p>}
      <ul style={{ paddingLeft: 18 }}>{result?.tasks.map(task => <li key={task.id} style={{ marginBottom: 12, overflowWrap: 'anywhere' }}>
        <div><strong>{task.title ?? task.id}</strong></div><small>{task.title && task.id}<br />{t(task.delivery)}</small><br />
        <button type="button" disabled={!task.plan} onClick={() => { open(task.id, 'PLAN.md'); setExpanded(false) }}>{t('plan')}</button>{' '}
        <button type="button" disabled={!task.ready} title={task.ready ? undefined : t('missing')} onClick={() => { open(task.id, 'READY.md'); setExpanded(false) }}>{t('ready')}</button>
      </li>)}</ul>
    </section>}
  </div>
}
/** Register into the existing Session header and native file preview; no new remote or host patch. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('projectOps', { zh, en }))
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: '@missher/dsh-project-ops', locale: 'projectOps', order: 140,
    inject: (sessionId: SessionId): Face => ({
      async list(signal) {
        const root = await ctx.remote.workspaceFiles.list(sessionId, 'docs/tasks', signal)
        if (!root.ok) {
          if (root.error.code === 'workspace-file/not-found') return { tasks: [], truncated: false }
          throw new Error(root.error.message)
        }
        const dirs = root.value.entries.filter(row => row.type === 'directory' && /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u.test(row.name)).reverse()
        const tasks: TaskLink[] = []
        // Four requests at most in flight; one inaccessible task does not hide the others.
        const selected = dirs.slice(0, 100)
        let cursor = 0
        await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
          while (cursor < selected.length) {
            const index = cursor++; const dir = selected[index]!
            signal.throwIfAborted()
            const path = `docs/tasks/${dir.name}`
            let plan = false; let ready = false
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
        return { tasks, truncated: root.value.truncated || dirs.length > 100 }
      },
      open: (task, file) => ctx.sidebarRight.openResource(sessionFileAddress(sessionId, `docs/tasks/${task}/${file}`)),
    }),
  }, ProjectOpsPanel)))
}
