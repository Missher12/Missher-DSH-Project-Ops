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
import { deliveryView, filterGroups, taskView, type OverviewResult, type ProjectGroup, type TaskLink, type TaskListResult } from '../src/client/task-view.ts'
import type { FilesPage } from '../src/client/files.ts'

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

/** Concatenated text of a rendered tree: nested arrays, numbers and element children included. */
function text(node: ReactNode): string {
  const walk = (value: ReactNode): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    if (Array.isArray(value)) return value.map(item => walk(item as ReactNode)).join(' ')
    if (!isValidElement(value)) return ''
    const expanded = expand(value) as ReactElement<{ children?: ReactNode }>
    return walk(expanded.props?.children)
  }
  return walk(expand(node))
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
const AVAILABLE = { list: true, preview: true, projects: true, files: true }
/** Preview present for the row-level tests. */
const PREVIEW = { available: true, reason: 'n/a' }

function task(overrides: Partial<TaskLink> = {}): TaskLink {
  return {
    id: '2026-10-12-project-ops-dsh-native-ui-9ab213e2baf81a6e',
    path: 'docs/tasks/2026-10-12-project-ops-dsh-native-ui-9ab213e2baf81a6e',
    origin: 'tasks', legacy: false,
    plan: true, ready: false, title: 'DSH 原生风格界面修订', delivery: 'missing',
    managed: true, artifacts: [], production: [],
    ...overrides,
  }
}

/** One bounded page of the overview. */
function page(tasks: TaskLink[], overrides: Partial<TaskListResult> = {}): TaskListResult {
  return { tasks, nextOffset: tasks.length, total: tasks.length, pending: 0, truncated: false, warnings: [], ...overrides }
}

/** Panel props shared by the state tests; individual cases override the page. */
const BASE: Omit<Parameters<typeof ProjectOpsPanel>[0], 'result' | 'error'> = {
  t, open: true, position: null, measureStyle: {}, panelRef: { current: null }, busy: false,
  availability: AVAILABLE, query: '', onQuery: () => {}, onRefresh: () => {},
  onLoadMore: () => {}, onLoadMoreGroup: () => {},
  scope: 'current', onScope: () => {}, overview: undefined,
  files: undefined, fileRoot: '.', filePath: '.', fileProject: undefined, fileProjects: [],
  onFileRoot: () => {}, onFileProject: () => {}, onFileOpenDir: () => {}, onFileUp: () => {}, onFileOpen: () => {},
  onClose: () => {}, onOpen: () => {},
}

/** One page of the files view. */
function filesPage(overrides: Partial<FilesPage> = {}): FilesPage {
  return {
    root: '.', path: '.', sessionId: 'session',
    entries: [
      { path: 'docs', name: 'docs', root: '.', type: 'directory', sessionId: 'session' },
      { path: '报告 2026.xlsx', name: '报告 2026.xlsx', root: '.', type: 'file', size: 2048, sessionId: 'session' },
      { path: '安装包.exe', name: '安装包.exe', root: '.', type: 'file', size: 12 * 1024 * 1024, sessionId: 'session' },
      { path: '产物.weird', name: '产物.weird', root: '.', type: 'file', sessionId: 'session' },
    ],
    total: 4, nextOffset: 4, truncated: false, warnings: [],
    ...overrides,
  }
}

/** One project group for the all-projects view. */
function group(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    workspaceId: 'ws-a', path: '/ws/a', title: '项目 A', status: 'readable',
    rows: [task()], nextOffset: 1, total: 1, pending: 0, truncated: false, warnings: [],
    ...overrides,
  }
}

/** One all-projects page. */
function overview(groups: ProjectGroup[], overrides: Partial<OverviewResult> = {}): OverviewResult {
  return { groups, pendingProjects: 0, totalProjects: groups.length, nextProjectOffset: groups.length, warnings: [], ...overrides }
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
  // The heading stays the title; the relative location is a separate secondary line.
  expect(text(withClass(tree, styles.rowTitle)[0]!)).toBe('DSH 原生风格界面修订')
  expect(text(withClass(tree, styles.rowPath)[0]!)).toBe(task().path)
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
  expect(calls).toEqual([[task().path, 'READY.md']])
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
  const base = BASE
  const loading = ProjectOpsPanel({ ...base, result: undefined, error: undefined })
  expect(String((withClass(loading, styles.skeleton)[0]!.props as { role?: string }).role)).toBe('status')
  expect(elements(loading).some(element => (element.props as { 'aria-label'?: string })['aria-label'] === '正在读取项目任务…')).toBe(true)

  const empty = ProjectOpsPanel({ ...base, result: page([]), error: undefined })
  expect(text(empty)).toContain('尚无开发任务')
  expect(withClass(empty, styles.row).length).toBe(0)

  const failure = ProjectOpsPanel({ ...base, result: undefined, error: 'workspace-file/unavailable' })
  expect(elements(failure).some(element => (element.props as { role?: string }).role === 'alert')).toBe(true)
  expect(text(failure)).toContain('workspace-file/unavailable')
  expect(text(failure)).toContain('重试')

  const truncated = ProjectOpsPanel({ ...base, result: page([task()], { truncated: true }), error: undefined })
  // The Host listing cap is named; it is not a silent row limit.
  expect(text(truncated)).toContain('宿主目录列表已达上限')
  expect(withClass(truncated, styles.row).length).toBe(1)
})

test('the panel exposes its title, refresh and close actions and a read-only hint', () => {
  const tree = ProjectOpsPanel({
    ...BASE,
    t, open: true, position: { left: 10, top: 20 }, measureStyle: {}, panelRef: { current: null },
    result: page([task()]), error: undefined,
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
  expect(withClass(tree, styles.footer).length).toBe(1)
  expect(text(tree)).toContain('文件存在不代表已发布或安装')
  expect(text(tree)).toContain('1 项')
})

test('a closed panel renders nothing at all', () => {
  expect(ProjectOpsPanel({
    ...BASE,
    t, open: false, position: null, measureStyle: {}, panelRef: { current: null },
    result: page([task()]), error: undefined, busy: true,
  })).toBeNull()
})

test('a Host without the workspace-files remote explains itself instead of showing an empty project', () => {
  const tree = ProjectOpsPanel({
    t, open: true, position: null, measureStyle: {}, panelRef: { current: null },
    ...BASE, result: undefined, error: undefined, availability: { list: false, preview: true, projects: false },
  })
  const rendered = text(tree)
  expect(rendered).toContain('未提供工作区文件读取能力')
  const notice = withClass(tree, styles.notice)[0]!
  expect(String((notice.props as { title?: string }).title)).toContain('remote.workspaceFiles')
  // A missing read capability must never be rendered as "no tasks yet".
  expect(rendered).not.toContain('尚无开发任务')
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

test('a plain legacy row carries its provenance badges and relative location', () => {
  const tree = ProjectOpsRow({
    t, preview: PREVIEW, onOpen: () => {},
    task: task({
      id: '2026-10-01-old-layout', path: 'docs/tasks/2026-10-01-old-layout', origin: 'tasks',
      legacy: true, managed: false, delivery: 'inspect', ready: true, title: '旧方案',
    }),
  })
  expect(text(tree)).toContain('旧版目录')
  expect(text(tree)).toContain('普通记录')
  expect(text(withClass(tree, styles.rowPath)[0]!)).toBe('docs/tasks/2026-10-01-old-layout')
})

test('artifacts and the acceptance sentence are labelled as a session report, never as links', () => {
  const tree = ProjectOpsRow({
    t, preview: PREVIEW, onOpen: () => {},
    task: task({ delivery: 'current', ready: true, artifacts: ['dist/a.tgz'], artifactsTruncated: true,
      verification: '原生回执门未通过；等待复核', verificationTruncated: true }),
  })
  expect(text(tree)).toContain('产物')
  expect(text(tree)).toContain('dist/a.tgz')
  expect(text(tree)).toContain('摘要已截断')
  expect(text(tree)).toContain('验收（会话报告）')
  expect(text(tree)).toContain('原生回执门未通过；等待复核')
  // An artifact excerpt is text: no link and no button is created for it.
  expect(withClass(tree, styles.artifact).every(element => element.type === 'span')).toBe(true)
})

test('a damaged or unlinked record never reuses an old acceptance claim', () => {
  const tree = ProjectOpsRow({
    t, preview: PREVIEW, onOpen: () => {},
    task: task({ delivery: 'inspect', ready: true, verification: '旧验收句子' }),
  })
  expect(text(tree)).toContain('验收（会话报告）')
  expect(text(tree)).toContain('无证据，未验证')
  expect(text(tree)).not.toContain('旧验收句子')
})

test('a row with a read problem keeps its place and explains itself', () => {
  const tree = ProjectOpsRow({
    t, preview: PREVIEW, onOpen: () => {},
    task: task({ plan: false, ready: true, delivery: 'inspect', problem: 'read failed' }),
  })
  expect(text(tree)).toContain('未能完整读取：read failed')
  expect(withClass(tree, styles.row).length).toBe(1)
})

test('the panel reports directory warnings instead of an empty workspace', () => {
  const tree = ProjectOpsPanel({ ...BASE, result: page([], { warnings: ['listing failed for docs/tasks'] }), error: undefined })
  expect(text(tree)).toContain('未能完整读取：listing failed for docs/tasks')
  expect(text(tree)).not.toContain('尚无开发任务')
})

test('the panel offers the next bounded page and filters the loaded rows locally', () => {
  const more = ProjectOpsPanel({ ...BASE, result: page([task()], { pending: 40, total: 41 }), error: undefined })
  expect(text(more)).toContain('显示更多')
  expect(text(more)).toContain('还有 40 个目录未检查')
  const filtered = ProjectOpsPanel({ ...BASE, query: '不存在的检索词', result: page([task()]), error: undefined })
  expect(text(filtered)).toContain('没有匹配的记录')
  expect(withClass(filtered, styles.row).length).toBe(0)
  // The search field is part of the panel and therefore of its Tab traversal.
  expect(elements(filtered).some(element => element.type === 'input')).toBe(true)
})

test('a managed production block lists facts with source and time, and external links stay text', () => {
  const tree = ProjectOpsRow({
    t, preview: PREVIEW, onOpen: () => {},
    task: task({
      delivery: 'current', ready: true,
      production: [
        { kind: 'build', name: '构建候选', outcome: 'succeeded', source: 'agent', recordedAt: '2026-10-23T01:00:00Z' },
        { kind: 'release', name: '发布记录', target: 'https://example.invalid/rel', source: 'owner', recordedAt: '2026-10-23T02:00:00Z' },
      ],
      productionRejected: 1,
    }),
  })
  expect(text(tree)).toContain('生产信息（会话报告）')
  expect(text(tree)).toContain('构建')
  expect(text(tree)).toContain('已记录成功')
  expect(text(tree)).toContain('agent · 2026-10-23T01:00:00Z')
  // The external target is labelled as a link and rendered as text, not <a>.
  expect(text(tree)).toContain('外链（未打开）')
  expect(elements(tree).some(element => element.type === 'a')).toBe(false)
  expect(text(tree)).toContain('1 条生产记录无法解析')
})

test('a managed delivery without production says it was not recorded instead of implying success', () => {
  const tree = ProjectOpsRow({ t, preview: PREVIEW, onOpen: () => {}, task: task({ delivery: 'current', ready: true }) })
  expect(text(tree)).toContain('生产信息（会话报告）')
  expect(text(tree)).toContain('未记录')
})

test('the all-projects view lists every group with its status and keeps unreadable projects visible', () => {
  const tree = ProjectOpsPanel({
    ...BASE,
    scope: 'all',
    result: undefined,
    error: undefined,
    overview: overview([
      group(),
      group({ workspaceId: 'ws-b', path: '/ws/b', title: '项目 B', status: 'no-session', rows: [], reason: 'no session' }),
      group({ workspaceId: 'ws-c', path: '/ws/c', title: '项目 C', status: 'unreadable', rows: [], reason: 'read failed' }),
    ], { totalProjects: 3 }),
  })
  const rendered = text(tree)
  expect(rendered).toContain('项目 A')
  expect(rendered).toContain('项目 B')
  expect(rendered).toContain('项目 C')
  expect(rendered).toContain('无可读取会话')
  expect(rendered).toContain('读取失败')
  expect(withClass(tree, styles.project).length).toBe(3)
  // The scope switch is present and the current view stays selectable.
  expect(rendered).toContain('所有项目')
  expect(rendered).toContain('当前项目')
})

test('the all-projects view offers more projects and per-project continuation', () => {
  const tree = ProjectOpsPanel({
    ...BASE,
    scope: 'all',
    result: undefined,
    error: undefined,
    overview: overview([group({ pending: 2, nextOffset: 32 })], { pendingProjects: 4, totalProjects: 5, nextProjectOffset: 1 }),
  })
  expect(text(tree)).toContain('更多项目')
  expect(text(tree)).toContain('还有 4 个项目未读取')
  expect(text(tree)).toContain('还有 2 个目录未检查')
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

test('project search matches a project name or path and keeps its loaded rows', () => {
  const groups = [
    group({ workspaceId: 'ws-a', path: '/ws/a', title: '项目 A' }),
    group({ workspaceId: 'ws-b', path: '/ws/gamma', title: '项目 B', status: 'unreadable', rows: [], reason: 'read failed' }),
  ]
  const byName = filterGroups(groups, '项目 B')
  expect(byName).toHaveLength(1)
  expect(byName[0]!.group.workspaceId).toBe('ws-b')
  const byPath = filterGroups(groups, 'gamma')
  expect(byPath.map(row => row.group.workspaceId)).toEqual(['ws-b'])
  // A matching project also shows a task whose heading does not match the query.
  const byProjectThenRow = filterGroups(groups, 'ws-a')
  expect(byProjectThenRow[0]!.rows).toHaveLength(1)
  // No match anywhere hides the project entirely.
  expect(filterGroups(groups, '不存在')).toEqual([])
})

test('the all-projects view shows an unknown count for projects it could not read fully', () => {
  const tree = ProjectOpsPanel({
    ...BASE,
    scope: 'all',
    result: undefined,
    error: undefined,
    overview: overview([
      group({ workspaceId: 'ws-a' }),
      group({ workspaceId: 'ws-b', status: 'no-session', rows: [], reason: 'no session' }),
      group({ workspaceId: 'ws-c', status: 'readable', rows: [], incomplete: true, reason: 'read failed' }),
    ], { totalProjects: 3 }),
  })
  const rendered = text(tree)
  expect(rendered.match(/交付数量未知/g)?.length).toBe(2)
  expect(rendered).not.toContain('0 条交付')
})

test('a stale delivery record shows no production entries and explains why', () => {
  const stale = task({ delivery: 'inspect', ready: true, production: [
    { kind: 'install', name: '安装记录', outcome: 'succeeded', source: 'owner', recordedAt: '2026-10-23T03:00:00Z' },
  ] })
  const tree = ProjectOpsRow({ t, preview: PREVIEW, onOpen: () => {}, task: stale })
  expect(text(tree)).toContain('生产信息（会话报告）')
  expect(text(tree)).toContain('不视为当前有效')
  expect(text(tree)).not.toContain('安装记录')
})

test('the files view lists real entries with sizes, attribution and safe actions only', () => {
  const tree = ProjectOpsPanel({ ...BASE, scope: 'files', result: undefined, error: undefined, files: filesPage() })
  const rendered = text(tree)
  expect(rendered).toContain('文件产物')
  expect(rendered).toContain('报告 2026.xlsx')
  expect(rendered).toContain('安装包.exe')
  expect(rendered).toContain('2.0 KB')
  expect(rendered).toContain('项目文件，生成会话未确认')
  // Directory rows offer opening; the sheet offers the native preview.
  const labels = elements(tree).map(element => (element.props as { 'aria-label'?: string })['aria-label']).filter(Boolean)
  expect(labels.length).toBeGreaterThan(0)
  expect(buttons(tree).map(button => text(button))).toEqual(expect.arrayContaining(['展开', '预览']))
  // EXE and unknown suffixes keep their row but are never offered an opener.
  expect(rendered).toContain('可执行文件，不会自动运行')
  expect(rendered).toContain('此类型暂无可预览方式')
  expect(elements(tree).some(element => element.type === 'a')).toBe(false)
  expect(withClass(tree, styles.filesEntry).length).toBe(4)
})

test('the files view reports a missing directory, a host cap and more pages distinctly', () => {
  const missing = ProjectOpsPanel({ ...BASE, scope: 'files', result: undefined, error: undefined, files: filesPage({ entries: [], total: 0, nextOffset: 0, missing: true }) })
  expect(text(missing)).toContain('目录不存在')
  expect(text(missing)).not.toContain('此目录没有文件')
  const capped = ProjectOpsPanel({ ...BASE, scope: 'files', result: undefined, error: undefined, files: filesPage({ truncated: true }) })
  expect(text(capped)).toContain('宿主目录列表达到上限')
  const more = ProjectOpsPanel({ ...BASE, scope: 'files', result: undefined, error: undefined, files: filesPage({ total: 80, nextOffset: 40 }) })
  expect(text(more)).toContain('更多文件')
  expect(text(more)).toContain('40/80')
})

test('a narrow header slot keeps the icon and the accessible name but hides the label', () => {
  const narrow = ProjectOpsTrigger({ t, open: false, count: undefined, narrow: true, triggerRef: { current: null }, onToggle: () => {} })
  expect(withClass(narrow, styles.triggerLabel).length).toBe(0)
  expect(withClass(narrow, styles.triggerNarrow).length).toBe(1)
  const props = elements(narrow)[0]!.props as { 'aria-label': string, 'aria-expanded': boolean, title: string }
  expect(props['aria-label']).toBe('尚无项目任务')
  expect(props.title).toBe('尚无项目任务')
  expect(props['aria-expanded']).toBe(false)

  const full = ProjectOpsTrigger({ t, open: true, count: 3, triggerRef: { current: null }, onToggle: () => {} })
  expect(withClass(full, styles.triggerLabel).length).toBe(1)
  expect(withClass(full, styles.triggerChevron).length).toBe(1)
  expect(withClass(full, styles.triggerNarrow).length).toBe(0)
})

test('a project-name match renders the project rows even when a row title does not match', () => {
  const tree = ProjectOpsPanel({
    ...BASE,
    scope: 'all',
    result: undefined,
    error: undefined,
    query: '项目 A',
    overview: overview([group()]),
  })
  // The shell-side project filter kept the group and its rows; the panel must
  // render exactly those rows rather than re-filtering them by task text.
  expect(withClass(tree, styles.row).length).toBe(1)
  expect(text(tree)).toContain('DSH 原生风格界面修订')
})
