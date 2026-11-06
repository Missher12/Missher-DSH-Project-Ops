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

/** Both optional native capabilities present. */
const AVAILABLE = { list: true, preview: true }
/** Preview present for the row-level tests. */
const PREVIEW = { available: true, reason: 'n/a' }

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
  // The four in-row labels stay short; the boundary wording lives in the hints.
  expect(seen.map(state => t(deliveryView(state).statusKey))).toEqual(['交付关联当前方案', '方案已更新', '记录待核对', '方案进行中'])
  // A linked delivery record is metadata: neutral, and only the record the
  // human has to check earns the attention color.
  expect(seen.map(state => deliveryView(state).dot)).toEqual(['idle', 'idle', 'warning', 'idle'])
  expect(seen.map(state => deliveryView(state).dot)).not.toContain('done')
  expect(seen.filter(state => deliveryView(state).attention)).toEqual(['inspect'])
})

test('a task row shows the Chinese title and hides the directory id behind title', () => {
  const tree = ProjectOpsRow({ t, task: task(), preview: PREVIEW, onOpen: () => {} })
  const rowProps = elements(tree)[0]!.props as { title: string, 'data-task': string }
  expect(rowProps['data-task']).toBe(task().id)
  expect(rowProps.title).toContain(task().id)
  expect(withClass(tree, styles.rowTitle).length).toBe(1)
  expect(withClass(tree, styles.rowId).length).toBe(0)
  expect(text(tree)).toContain('DSH 原生风格界面修订')
  expect(text(tree)).not.toContain('2026-10-12-project-ops')
  // Short status on the metadata line; the acceptance boundary lives in its tooltip.
  expect(text(tree)).toContain('方案进行中')
  expect(text(tree)).not.toContain('不代表')
  const status = withClass(tree, styles.rowStatus)[0]!
  expect(String((status.props as { title?: string }).title)).toContain('不代表')
})

test('a row without a readable title falls back to the id instead of inventing one', () => {
  const tree = ProjectOpsRow({ t, task: task({ title: undefined }), preview: PREVIEW, onOpen: () => {} })
  // The heading line still exists, but it carries the id fallback rather than a
  // real title (and therefore offers no separate full-title tooltip).
  const heading = withClass(tree, styles.rowTitle)[0]!
  expect(withClass(tree, styles.rowId).length).toBe(1)
  expect(heading.props.title).toBeUndefined()
  expect(text(tree)).toContain('2026-10-12-project-ops-dsh-native-ui-9ab213e2baf81a6e')
})

test('a missing document disables its action and says why', () => {
  const tree = ProjectOpsRow({ t, task: task({ plan: true, ready: false }), preview: PREVIEW, onOpen: () => {} })
  const actions = buttons(tree)
  expect(actions.length).toBe(2)
  const [plan, ready] = actions as [ReactElement<{ disabled?: boolean, title?: string }>, ReactElement<{ disabled?: boolean, title?: string }>]
  expect(plan.props.disabled).toBe(false)
  expect(plan.props.title).toContain('PLAN.md')
  expect(ready.props.disabled).toBe(true)
  expect(ready.props.title).toBe('尚未生成交付记录')
  expect(text(tree)).toContain('方案')
  expect(text(tree)).toContain('交付')
})

test('opening a document reports the task and file to the preview opener', () => {
  const calls: [string, string][] = []
  const tree = ProjectOpsRow({ t, task: task({ ready: true }), preview: PREVIEW, onOpen: (id, file) => { calls.push([id, file]) } })
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
  expect(props['aria-label']).toBe('项目方案与文件：3 项')
  expect(text(tree)).toContain('Project Ops')
})

test('the panel reports loading, empty, error and truncated states distinctly', () => {
  const base = { t, open: true, position: null, measureStyle: {}, panelRef: { current: null }, busy: false, availability: AVAILABLE, onRefresh: () => {}, onClose: () => {}, onOpen: () => {} }
  const loading = ProjectOpsPanel({ ...base, result: undefined, error: undefined })
  expect(String((withClass(loading, styles.skeleton)[0]!.props as { role?: string }).role)).toBe('status')
  expect(elements(loading).some(element => (element.props as { 'aria-label'?: string })['aria-label'] === '加载中…')).toBe(true)

  const empty = ProjectOpsPanel({ ...base, result: { tasks: [], truncated: false }, error: undefined })
  expect(text(empty)).toContain('暂无开发任务')
  expect(withClass(empty, styles.row).length).toBe(0)

  const failure = ProjectOpsPanel({ ...base, result: undefined, error: 'workspace-file/unavailable' })
  expect(elements(failure).some(element => (element.props as { role?: string }).role === 'alert')).toBe(true)
  expect(text(failure)).toContain('workspace-file/unavailable')
  expect(text(failure)).toContain('重试')

  const truncated = ProjectOpsPanel({ ...base, result: { tasks: [task()], truncated: true }, error: undefined })
  expect(text(truncated)).toContain('仅显示最近 100 项')
  expect(withClass(truncated, styles.row).length).toBe(1)
})

test('the panel exposes its title, refresh and close actions', () => {
  const tree = ProjectOpsPanel({
    t, open: true, position: { left: 10, top: 20 }, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [task()], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
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
  expect(text(tree)).toContain('1 项')
})

test('a closed panel renders nothing at all', () => {
  expect(ProjectOpsPanel({
    t, open: false, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [task()], truncated: false }, error: undefined, busy: true, availability: AVAILABLE,
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {},
  })).toBeNull()
})

test('a Host without the workspace-files remote explains itself instead of showing an empty project', () => {
  const tree = ProjectOpsPanel({
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: undefined, error: undefined, busy: false, availability: { list: false, preview: true },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {},
  })
  const rendered = text(tree)
  expect(rendered).toContain('无工作区文件读取能力')
  const notice = withClass(tree, styles.notice)[0]!
  expect(String((notice.props as { title?: string }).title)).toContain('remote.workspaceFiles')
  // A missing read capability must never be rendered as "no tasks yet".
  expect(rendered).not.toContain('暂无开发任务')
  expect(withClass(tree, styles.skeleton).length).toBe(0)
})

test('a Host without the native preview keeps the rows but disables both actions with one reason', () => {
  const reason = '此 Host 未提供原生文件预览'
  const tree = ProjectOpsRow({ t, task: task({ ready: true }), preview: { available: false, reason }, onOpen: () => {} })
  const actions = buttons(tree) as ReactElement<{ disabled?: boolean, title?: string }>[]
  expect(actions.length).toBe(2)
  expect(actions.every(action => action.props.disabled === true)).toBe(true)
  expect(actions.every(action => action.props.title === reason)).toBe(true)
  // The row itself is still listed: only the affected action is disabled.
  expect(text(tree)).toContain('DSH 原生风格界面修订')
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

test('file categories are independent of plans and keep a Word proposal in Word', () => {
  const base = {
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [task()], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onCategory: () => {},
    files: { files: [
      { path: '/work/方案.docx', updatedAt: 1 },
      { path: '/work/预算.XLSX', updatedAt: 2 },
      { path: '/work/汇报.pptx', updatedAt: 3 },
    ], truncated: false },
    onOpenFile: () => {},
  }
  const word = ProjectOpsPanel({ ...base, category: 'word' })
  expect(text(word)).toContain('方案.docx')
  expect(text(word)).not.toContain('预算.XLSX')
  expect(text(word)).not.toContain('DSH 原生风格界面修订')
  const plans = ProjectOpsPanel({ ...base, category: 'plans' })
  expect(text(plans)).toContain('DSH 原生风格界面修订')
  expect(text(plans)).toContain('交付记录')
  expect(text(plans)).not.toContain('方案.docx')
})

test('actual files remain usable when the project has no managed plans', () => {
  const opened: string[] = []
  const tree = ProjectOpsPanel({
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    files: { files: [{ path: '/work/out/report.pdf', updatedAt: 1 }], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onOpenFile: path => { opened.push(path) },
  })
  const file = buttons(tree).find(button => button.props.title === '/work/out/report.pdf')
  expect(file).toBeDefined()
  file!.props.onClick()
  expect(opened).toEqual(['/work/out/report.pdf'])
})

test('a delivered file keeps its native preview and adds a separate open-location action', () => {
  const opened: string[] = []
  const revealed: string[] = []
  const tree = ProjectOpsPanel({
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    files: { files: [{ path: '/work/方案-分类测试.docx', updatedAt: 1 }], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {},
    onOpenFile: path => { opened.push(path) },
    onRevealFile: path => { revealed.push(path) },
  })
  const all = buttons(tree) as ReactElement<{ title?: string, 'aria-label'?: string, onClick: () => void }>[]
  const preview = all.find(button => button.props.title === '/work/方案-分类测试.docx')
  const reveal = all.find(button => button.props.title === '打开位置')
  expect(preview).toBeDefined()
  expect(reveal).toBeDefined()
  // The reveal action names the file for assistive technology.
  expect(reveal!.props['aria-label']).toContain('方案-分类测试.docx')
  preview!.props.onClick()
  reveal!.props.onClick()
  expect(opened).toEqual(['/work/方案-分类测试.docx'])
  expect(revealed).toEqual(['/work/方案-分类测试.docx'])
})

test('a reveal refusal explains itself inside the panel instead of hiding the file', () => {
  const base = {
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    files: { files: [{ path: '/work/方案-分类测试.docx', updatedAt: 1 }], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onOpenFile: () => {}, onRevealFile: () => {},
  }
  const missing = ProjectOpsPanel({ ...base, revealError: { path: '/work/方案-分类测试.docx', outcome: 'missing', message: 'no entry' } })
  expect(text(missing)).toContain('文件已移动或删除')
  expect(text(missing)).toContain('方案-分类测试.docx')
  expect(withClass(missing, styles.menu).length).toBe(1)
  const unsupported = ProjectOpsPanel({ ...base, revealError: { path: '/work/方案-分类测试.docx', outcome: 'unsupported', message: 'no remote' } })
  expect(text(unsupported)).toContain('不支持显示文件位置')
  // A reveal failure on another row does not leak into this row.
  const other = ProjectOpsPanel({ ...base, revealError: { path: '/work/other.docx', outcome: 'missing', message: 'no entry' } })
  expect(text(other)).not.toContain('文件已移动或删除')
})

test('a file row keeps only its name and action, moving path and note into the tooltip', () => {
  const tree = ProjectOpsPanel({
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    files: { files: [{ path: '/work/out/report.docx', description: '初稿', updatedAt: 1 }], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onOpenFile: () => {}, onRevealFile: () => {},
  })
  const rendered = text(tree)
  // The row body stays short: name plus the always-visible open-location action.
  expect(rendered).toContain('report.docx')
  expect(rendered).toContain('打开位置')
  expect(rendered).not.toContain('/work/out')
  expect(rendered).not.toContain('初稿')
  const fileButton = buttons(tree)
    .find(button => String((button.props as { title?: string }).title ?? '').startsWith('/work/out/report.docx'))!
  expect(String((fileButton.props as { title: string }).title).split('\n')).toEqual(['/work/out/report.docx', '初稿'])
})

test('two rows with one file name add a directory line only where names collide', () => {
  const tree = ProjectOpsPanel({
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    files: { files: [
      { path: '/work/a/report.docx', updatedAt: 1 },
      { path: '/work/b/report.docx', updatedAt: 2 },
      { path: '/work/c/budget.xlsx', updatedAt: 3 },
    ], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onOpenFile: () => {}, onRevealFile: () => {},
  })
  const rendered = text(tree)
  expect(rendered).toContain('/work/a')
  expect(rendered).toContain('/work/b')
  // The unique name keeps no directory line at all.
  expect(rendered).not.toContain('/work/c')
})

test('a background refresh keeps the last file rows instead of replacing them with a spinner', () => {
  const base = {
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: true, availability: AVAILABLE,
    files: { files: [{ path: '/work/预算-分类测试.xlsx', updatedAt: 1 }], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onOpenFile: () => {},
  }
  const busy = ProjectOpsPanel({ ...base, fileBusy: true })
  // The row stays mounted while the read runs, so its DOM node (and focus) is kept.
  expect(text(busy)).toContain('预算-分类测试.xlsx')
  expect(text(busy)).not.toContain('加载中…')
  const failed = ProjectOpsPanel({ ...base, busy: false, fileBusy: false, fileError: 'offline' })
  // A failed background read keeps the rows and adds the reason beside them.
  expect(text(failed)).toContain('预算-分类测试.xlsx')
  expect(text(failed)).toContain('读取失败：offline')
  const first = ProjectOpsPanel({ ...base, busy: false, files: undefined, fileBusy: true })
  expect(text(first)).toContain('加载中…')
})

test('a preview refusal explains missing and permission separately, keeping other detail', () => {
  const base = {
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    files: { files: [{ path: '/work/方案-分类测试.docx', updatedAt: 1 }], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onOpenFile: () => {}, onRevealFile: () => {},
  }
  const missing = ProjectOpsPanel({ ...base, openError: { path: '/work/方案-分类测试.docx', outcome: 'missing', message: 'no entry' } })
  expect(text(missing)).toContain('文件已移动或删除')
  expect(text(missing)).not.toContain('no entry')
  const denied = ProjectOpsPanel({ ...base, openError: { path: '/work/方案-分类测试.docx', outcome: 'denied', message: 'EACCES' } })
  expect(text(denied)).toContain('没有访问该文件的权限')
  expect(text(denied)).not.toContain('文件已移动或删除')
  const failed = ProjectOpsPanel({ ...base, openError: { path: '/work/方案-分类测试.docx', outcome: 'failed', message: 'I/O error' } })
  expect(text(failed)).toContain('无法打开：I/O error')
})

test('a reveal permission refusal uses the localized permission sentence', () => {
  const base = {
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    files: { files: [{ path: '/work/方案-分类测试.docx', updatedAt: 1 }], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onOpenFile: () => {}, onRevealFile: () => {},
  }
  const denied = ProjectOpsPanel({ ...base, revealError: { path: '/work/方案-分类测试.docx', outcome: 'denied', message: 'EACCES' } })
  expect(text(denied)).toContain('没有访问该文件的权限')
  expect(text(denied)).not.toContain('文件已移动或删除')
})

test('the search tab lists every local hit, web source and opened page beside truncated totals', () => {
  const opened: string[] = []
  const revealed: string[] = []
  const base = {
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: { tasks: [], truncated: false }, error: undefined, busy: false, availability: AVAILABLE,
    files: { files: [{ path: '/work/delivered.docx', updatedAt: 1 }], truncated: false },
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onCategory: () => {},
    onOpenFile: (path: string) => { opened.push(path) },
    onRevealFile: (path: string) => { revealed.push(path) },
  }
  const tree = ProjectOpsPanel({ ...base, category: 'search', searches: { truncated: true, searches: [
    { callId: 'g1', mode: 'glob', query: 'README*.md', files: ['/a/README.md', '/b/README.md'], sources: [], total: 2, truncated: false, time: 1 },
    { callId: 'w1', mode: 'web_search', query: 'dsh docs', files: [], sources: [{ title: 'DSH docs', url: 'https://example.com/docs' }], total: 1, truncated: false, time: 2 },
    { callId: 'f1', mode: 'web_fetch', query: 'https://example.com/ok', files: [], sources: [], opened: 'https://example.com/ok', total: 1, truncated: false, time: 3 },
    { callId: 'e1', mode: 'grep', query: 'boom', files: [], sources: [], total: 0, truncated: false, error: 'tool exploded', time: 4 },
    { callId: 'z1', mode: 'grep', query: 'nothing', files: [], sources: [], total: 0, truncated: false, time: 5 },
    { callId: 'u1', mode: 'glob', query: 'unresolved', files: [], sources: [], total: 1, truncated: true, time: 6 },
    { callId: 'wf', mode: 'web_fetch', query: 'https://example.com/broken', files: [], sources: [], total: 0, truncated: false, error: 'fetch failed', time: 7 },
  ] } })
  // On the search tab the delivered-file rows stay out of the way.
  expect(text(tree)).not.toContain('delivered.docx')
  expect(text(tree)).toContain('README*.md')
  // Two identical names stay distinguishable by their directories.
  expect(text(tree)).toContain('/a')
  expect(text(tree)).toContain('/b')
  const hits = buttons(tree).filter(button => String(button.props.title ?? '').endsWith('README.md'))
  expect(hits).toHaveLength(2)
  hits[0]!.props.onClick()
  expect(opened).toEqual(['/a/README.md'])
  const reveal = buttons(tree).find(button => button.props.title === '打开位置')
  reveal!.props.onClick()
  expect(revealed).toEqual(['/a/README.md'])
  const links = elements(tree).filter(element => element.type === 'a')
  expect(links.map(link => link.props.href)).toEqual(['https://example.com/docs', 'https://example.com/ok'])
  expect(text(tree)).toContain('已打开网页')
  expect(text(tree)).toContain('搜索失败：tool exploded')
  expect(text(tree)).toContain('无命中')
  expect(text(tree)).toContain('结果不完整（共 1 条）')
  // A failed fetch stays a failed search, not an opened page.
  expect(text(tree)).toContain('搜索失败：fetch failed')
  expect(text(tree)).toContain('仅显示最近 50 次搜索')
})

test('the search tab reports an unavailable history instead of an empty list', () => {
  const tree = ProjectOpsPanel({
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: undefined, error: undefined, busy: false, availability: AVAILABLE,
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onCategory: () => {},
    category: 'search', searches: { searches: [], truncated: false, unavailable: true },
  })
  expect(text(tree)).toContain('此宿主无搜索记录')
})

test('a session query row shows the query and its in-session result label, never zero hits', () => {
  const tree = ProjectOpsPanel({
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    result: undefined, error: undefined, busy: false, availability: AVAILABLE,
    onRefresh: () => {}, onClose: () => {}, onOpen: () => {}, onCategory: () => {},
    category: 'search', searches: { truncated: false, searches: [
      { callId: 's1', mode: 'session_search', query: 'project ops', files: [], sources: [], total: 0, truncated: false, time: 1 },
    ] },
  })
  expect(text(tree)).toContain('project ops')
  expect(text(tree)).toContain('结果见会话')
  expect(text(tree)).not.toContain('无命中')
})
