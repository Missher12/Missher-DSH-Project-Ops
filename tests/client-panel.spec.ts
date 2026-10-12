/**
 * Panel behaviour without a DOM.
 *
 * The presentational components are hook-free by design, so a test can call
 * them, walk the returned element tree and assert exactly what the header
 * action renders for each delivery freshness state, each read state and each
 * action availability. Rendering inside a real Host is covered by the isolated
 * acceptance run, not here.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { expect, test } from 'vitest'
import { en, zh, type ProjectOpsKey } from '../src/client/locales.ts'
import { ProjectOpsPanel, ProjectOpsRow, ProjectOpsTrigger } from '../src/client/ProjectOpsPanel.tsx'
import { styles } from '../src/client/styles.ts'
import { deliveryView, taskView, type TaskLink } from '../src/client/task-view.ts'

const dictionaries: Record<'zh' | 'en', Record<string, string>> = { zh, en }

/** A translate seat over the real dictionaries, with the framework's `{param}` substitution. */
function translate(dictionary: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dictionary[key]
    if (template === undefined) throw new Error(`missing dictionary key: ${key}`)
    return template.replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
  }
}

const t = translate(zh)
const tEn = translate(en)

/** Expand function components so one walk reaches the real host elements. */
function expand(node: ReactNode, depth = 0): ReactNode {
  if (depth > 12 || !isValidElement(node)) return node
  const element = node as ReactElement<{ children?: ReactNode }>
  if (typeof element.type !== 'function') return node
  const Component = element.type as (props: unknown) => ReactNode
  return expand(Component(element.props), depth + 1)
}

/** Every host element in a rendered tree, with its props. */
function elements(node: ReactNode, found: ReactElement[] = [], depth = 0): ReactElement[] {
  if (depth > 24) return found
  const expanded = expand(node)
  if (Array.isArray(expanded)) {
    for (const child of expanded) elements(child as ReactNode, found, depth + 1)
    return found
  }
  if (!isValidElement(expanded)) return found
  const element = expanded as ReactElement<{ children?: ReactNode }>
  found.push(element)
  const children = element.props.children
  if (children !== undefined) elements(children, found, depth + 1)
  return found
}

/** Concatenated text of a rendered tree. */
function text(node: ReactNode): string {
  return elements(node).map(element => {
    const children = (element.props as { children?: ReactNode }).children
    return typeof children === 'string' ? children : ''
  }).join(' ')
}

/** Host elements of one raw tree carrying a given class (the tree is walked once). */
function withClass(tree: ReactNode, className: string): ReactElement[] {
  return elements(tree).filter(element => String((element.props as { className?: unknown }).className ?? '').split(/\s+/u).includes(className))
}

/** Buttons in one raw tree, in document order. */
function buttons(tree: ReactNode): ReactElement[] {
  return elements(tree).filter(element => element.type === 'button')
}

function task(overrides: Partial<TaskLink> = {}): TaskLink {
  return { id: '2026-10-12-project-ops-dsh-native-ui-9ab213e2baf81a6e', plan: true, ready: false, title: 'DSH 原生风格界面修订', delivery: 'missing', ...overrides }
}

test('locales keep one key set and describe links, never acceptance', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  const statuses: ProjectOpsKey[] = ['status.current', 'status.historical', 'status.inspect', 'status.missing']
  for (const dictionary of [zh, en]) {
    for (const key of statuses) {
      // No delivery state may claim a passed review, a release or an install.
      expect(dictionary[key]).not.toMatch(/验收通过|已验收|已发布|已安装|accepted|released|installed/iu)
    }
  }
  expect(zh['status.current']).toBe('交付关联当前方案')
  expect(zh['status.currentHint']).toContain('不代表验收通过')
})

test('four delivery freshness states map to four labels and never to a success dot', () => {
  const seen = ['current', 'historical', 'inspect', 'missing'] as const
  expect(seen.map(state => deliveryView(state).statusKey)).toEqual(['status.current', 'status.historical', 'status.inspect', 'status.missing'])
  // A linked delivery record is metadata: neutral, and only the record the
  // human has to check earns the attention color.
  expect(seen.map(state => deliveryView(state).dot)).toEqual(['idle', 'idle', 'warning', 'idle'])
  expect(seen.map(state => deliveryView(state).dot)).not.toContain('done')
  expect(seen.filter(state => deliveryView(state).attention)).toEqual(['inspect'])
})

test('a task row shows the Chinese title and hides the directory id behind title', () => {
  const tree = ProjectOpsRow({ t, task: task(), onOpen: () => {} })
  const rowProps = elements(tree)[0]!.props as { title: string, 'data-task': string }
  expect(rowProps['data-task']).toBe(task().id)
  expect(rowProps.title).toContain(task().id)
  expect(withClass(tree, styles.rowTitle).length).toBe(1)
  expect(withClass(tree, styles.rowId).length).toBe(0)
  expect(text(tree)).toContain('DSH 原生风格界面修订')
  expect(text(tree)).not.toContain('2026-10-12-project-ops')
  expect(text(tree)).toContain('尚未生成交付')
})

test('a row without a readable title falls back to the id instead of inventing one', () => {
  const tree = ProjectOpsRow({ t, task: task({ title: undefined }), onOpen: () => {} })
  expect(withClass(tree, styles.rowId).length).toBe(1)
  expect(withClass(tree, styles.rowTitle).length).toBe(0)
  expect(text(tree)).toContain('2026-10-12-project-ops-dsh-native-ui-9ab213e2baf81a6e')
})

test('a missing document disables its action and says why', () => {
  const tree = ProjectOpsRow({ t, task: task({ plan: true, ready: false }), onOpen: () => {} })
  const actions = buttons(tree)
  expect(actions.length).toBe(2)
  const [plan, ready] = actions as [ReactElement<{ disabled?: boolean, title?: string }>, ReactElement<{ disabled?: boolean, title?: string }>]
  expect(plan.props.disabled).toBe(false)
  expect(plan.props.title).toContain('PLAN.md')
  expect(ready.props.disabled).toBe(true)
  expect(ready.props.title).toBe('尚未生成交付记录')
  expect(text(tree)).toContain('查看方案')
  expect(text(tree)).toContain('查看交付')
})

test('opening a document reports the task and file to the preview opener', () => {
  const calls: [string, string][] = []
  const tree = ProjectOpsRow({ t, task: task({ ready: true }), onOpen: (id, file) => { calls.push([id, file]) } })
  const actions = buttons(tree) as ReactElement<{ onClick: () => void }>[]
  actions[1]!.props.onClick()
  expect(calls).toEqual([[task().id, 'READY.md']])
})

test('the trigger is a plain labelled button, not a browser default face', () => {
  const ref = { current: null }
  const tree = ProjectOpsTrigger({ t, open: false, count: 3, triggerRef: ref, onToggle: () => {} })
  const trigger = elements(tree)[0]!
  const props = trigger.props as { className: string, 'aria-expanded': boolean, 'aria-haspopup': string, 'aria-label': string }
  expect(trigger.type).toBe('button')
  expect(props.className).toBe(styles.trigger)
  expect(props['aria-expanded']).toBe(false)
  expect(props['aria-haspopup']).toBe('dialog')
  expect(props['aria-label']).toBe('项目任务与交付记录：3 项')
  expect(text(tree)).toContain('Project Ops')
})

test('the panel reports loading, empty, error and truncated states distinctly', () => {
  const base = { t, open: true, position: null, measureStyle: {}, panelRef: { current: null }, busy: false, onRefresh: () => {}, onClose: () => {}, onOpen: () => {} }
  const loading = ProjectOpsPanel({ ...base, result: undefined, error: undefined })
  expect(String((withClass(loading, styles.skeleton)[0]!.props as { role?: string }).role)).toBe('status')
  expect(elements(loading).some(element => (element.props as { 'aria-label'?: string })['aria-label'] === '正在读取项目任务…')).toBe(true)

  const empty = ProjectOpsPanel({ ...base, result: { tasks: [], truncated: false }, error: undefined })
  expect(text(empty)).toContain('尚无开发任务')
  expect(withClass(empty, styles.row).length).toBe(0)

  const failure = ProjectOpsPanel({ ...base, result: undefined, error: 'workspace-file/unavailable' })
  expect(elements(failure).some(element => (element.props as { role?: string }).role === 'alert')).toBe(true)
  expect(text(failure)).toContain('workspace-file/unavailable')
  expect(text(failure)).toContain('重试')

  const truncated = ProjectOpsPanel({ ...base, result: { tasks: [task()], truncated: true }, error: undefined })
  expect(text(truncated)).toContain('仅显示最近 100 项')
  expect(withClass(truncated, styles.row).length).toBe(1)
})

test('the panel exposes its title, refresh and close actions and a read-only hint', () => {
  const tree = ProjectOpsPanel({
    t, open: true, position: { left: 10, top: 20 }, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [task()], truncated: false }, error: undefined, busy: false,
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {},
  })
  const panel = elements(tree)
  const surface = panel[0]!
  const props = surface.props as { role: string, 'aria-label': string, 'aria-busy': boolean, style: unknown, className: string }
  expect(surface.type).toBe('section')
  expect(props.role).toBe('dialog')
  expect(props['aria-label']).toBe('Project Ops')
  expect(props['aria-busy']).toBe(false)
  expect(props.style).toEqual({ left: 10, top: 20 })
  const labels = panel.map(element => (element.props as { 'aria-label'?: string })['aria-label']).filter(Boolean)
  expect(labels).toContain('刷新')
  expect(labels).toContain('关闭')
  expect(text(tree)).toContain('交付记录只保留历史事实')
  expect(text(tree)).toContain('1 项')
})

test('a closed panel renders nothing at all', () => {
  expect(ProjectOpsPanel({
    t, open: false, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [task()], truncated: false }, error: undefined, busy: true,
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {},
  })).toBeNull()
})

test('the English dictionary renders the same four states', () => {
  const states = ['current', 'historical', 'inspect', 'missing'] as const
  for (const state of states) {
    const view = taskView(task({ delivery: state }))
    expect(tEn(view.status).length).toBeGreaterThan(0)
    expect(tEn(view.hint).length).toBeGreaterThan(0)
  }
  expect(tEn(taskView(task({ delivery: 'current' })).status)).toBe('Delivery linked to current plan')
})
