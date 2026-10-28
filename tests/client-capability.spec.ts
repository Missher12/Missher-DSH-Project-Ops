/**
 * Client-half capability boundary — on a REAL cordis kernel.
 *
 * The first version of this file used a plain object as the context, so it
 * happily "passed" while the official alpha.5 Web build crashed: reading
 * `ctx.remote.workspaceFiles` from a fiber that did not inject that name throws
 * `cannot get property "remote.workspaceFiles" without inject`. These tests now
 * drive a real `Context`, real plugin fibers and the kernel's own optional-inject
 * callback, so the same mistake fails here instead of in a browser.
 */
import { Context } from '@deepseek-ai/cordis'
import { expect, test } from 'vitest'
import * as ProjectOps from '../src/client/index.tsx'

interface Registered {
  inject: (sessionId: string) => {
    surface: () => { list: boolean; preview: boolean; projects: boolean; files: boolean }
    list: (signal: AbortSignal, options?: { offset?: number }) => Promise<unknown>
    overview: (signal: AbortSignal, options?: { projectOffset?: number, group?: { workspaceId: string, offset: number } }) => Promise<unknown>
    projects: (signal: AbortSignal) => Promise<unknown>
    files: (signal: AbortSignal, options?: { root?: string; path?: string; offset?: number; project?: string }) => Promise<unknown>
    observe: (onChange: () => void) => () => void
    openFile: (path: string, sessionId?: string) => void
    open: (path: string, file: 'PLAN.md' | 'READY.md', sessionId?: string) => void
  }
}

/**
 * A real client context with the two services the entry requires, plus whatever
 * optional services a case provides. `slots.inject`/`slots.register` mirror the
 * client slot registry so the registered face can be inspected.
 */
async function clientFixture(optional: Record<string, unknown> = {}) {
  const ctx = new Context()
  let registered: Registered | undefined
  let dictionaries: unknown
  const opened: string[] = []
  await ctx.plugin({
    name: 'project-ops-client-fixture',
    apply(inner: Context) {
      inner.provide('locale', { register: (_ns: string, value: unknown) => { dictionaries = value } })
      inner.provide('slots', {
        inject: (_name: string, factory: () => Registered) => { registered = factory() },
        register: (entry: Registered) => entry,
      })
      for (const [name, value] of Object.entries(optional)) inner.provide(name, value)
    },
  })
  const fiber = await ctx.plugin(ProjectOps)
  return { ctx, fiber, entry: () => registered, dictionaries: () => dictionaries, opened }
}

/** A workspace-files face with the two methods the panel calls. */
function filesFace(opened: string[] = []) {
  return {
    list: () => Promise.resolve({ ok: true, value: { entries: [], truncated: false } }),
    readBytes: () => { opened.push('readBytes'); return Promise.resolve({ ok: true, value: { data: new Uint8Array(), eof: true } }) },
  }
}

/**
 * Mirrors the kernel's namespace accessor for a nested service.
 *
 * cordis 4.0.5-alpha.1 resolves a nested read through the service's own accessor
 * definition and rejects it with `cannot get property "<name>" without inject`
 * unless that exact name is injected (kernel guard, cordis `lib/index.js`). A
 * plain object would let a nested read succeed, so this double exists to keep
 * the original failure shape inside the regression: the pre-fix code path must
 * be seen to throw here, not silently pass.
 */
function guardedNamespace(fullName: string, members: Record<string, unknown>) {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, property) {
      if (typeof property === 'string' && property in members) {
        throw new Error(`cannot get property "${fullName}.${property}" without inject`)
      }
      return undefined
    },
  })
}

test('the pre-fix nested property read is reproduced as a failure, while the face stays available', async () => {
  const ctx = new Context()
  const face = filesFace()
  // The Host exposes the nested service under its full name and its `remote`
  // namespace accessor, exactly like the real client does.
  await ctx.plugin({
    name: 'project-ops-namespace-fixture',
    apply(inner: Context) {
      inner.provide('remote', guardedNamespace('remote', { workspaceFiles: face }))
      inner.provide('remote.workspaceFiles', face)
    },
  })
  // The original bug: a nested read on the namespace accessor without inject.
  expect(() => (ctx as unknown as { remote: { workspaceFiles: unknown } }).remote.workspaceFiles).toThrow(/without inject/)
  // The fix: the full service name resolves without the inject requirement.
  expect(ctx.get('remote.workspaceFiles')).toBe(face)
})

test('activates on a Host with neither optional service and reports both halves unavailable', async () => {
  const fixture = await clientFixture()
  expect(fixture.fiber).toBeDefined()
  expect(fixture.dictionaries()).toMatchObject({ zh: expect.any(Object), en: expect.any(Object) })

  const face = fixture.entry()!.inject('session-1')
  // This is the case that crashed the official alpha.5 build: resolving the
  // nested service must report "unavailable", never throw out of the render.
  expect(() => face.surface()).not.toThrow()
  expect(face.surface()).toEqual({ list: false, preview: false, projects: false })
  await expect(face.list(new AbortController().signal)).rejects.toThrow(/workspace-files remote/)
  expect(() => face.open('task', 'READY.md')).not.toThrow()
})

test('a provided native preview is reported available and receives the open call', async () => {
  const opened: string[] = []
  const fixture = await clientFixture({
    sidebarRight: { openResource: (address: unknown) => { opened.push(String(address)) } },
  })
  const face = fixture.entry()!.inject('session-1')
  expect(face.surface().preview).toBe(true)
  face.open('2026-10-14-wide-host-compat-5f76a32a7990cb98', 'PLAN.md')
  expect(opened).toHaveLength(1)
  expect(opened[0]).toContain('PLAN.md')
})

test('a preview service without the method the panel calls counts as unavailable', async () => {
  const fixture = await clientFixture({ sidebarRight: {} })
  const face = fixture.entry()!.inject('session-1')
  // Presence is not capability: a service missing `openResource` must disable the
  // document entries instead of failing inside a click handler.
  expect(face.surface()).toEqual({ list: false, preview: false, projects: false })
})

test('a provided workspace-files nameservice is reported available for the read half', async () => {
  // The kernel keys services by their full name in the isolate store, dotted
  // names included (`Context.get` documents itself as the accessor without the
  // inject requirement), so registering `remote.workspaceFiles` as one name is
  // exactly how a Host exposes it. Keep the assertion if this ever fails.
  const fixture = await clientFixture({ 'remote.workspaceFiles': filesFace() })
  const face = fixture.entry()!.inject('session-1')
  expect(face.surface().list).toBe(true)
  // The read path runs against the injected service and returns an empty first batch.
  await expect(face.list(new AbortController().signal)).resolves.toEqual({
    tasks: [], nextOffset: 0, total: 0, pending: 0, truncated: false, warnings: [],
  })
})

test('a workspace-files service without readBytes keeps the read half disabled', async () => {
  const fixture = await clientFixture({ 'remote.workspaceFiles': { list: () => Promise.resolve({ ok: true, value: { entries: [], truncated: false } }) } })
  const face = fixture.entry()!.inject('session-1')
  expect(face.surface().list).toBe(false)
  await expect(face.list(new AbortController().signal)).rejects.toThrow(/workspace-files remote/)
})

/** One workspace node: direct files and direct child directories. */
interface Node { files?: Record<string, string>, dirs?: string[] }

/**
 * A workspace-files face over an in-memory tree.
 * @param tree - directory path (`.` for the root) to its direct children.
 * @param fail - paths whose `readBytes` fails with a non-"not-found" error.
 * @returns the face plus the paths it was asked to read.
 */
function treeFace(tree: Record<string, Node>, fail: ReadonlySet<string> = new Set()) {
  const read = (path: string) => {
    const slash = path.lastIndexOf('/')
    const directory = slash === -1 ? '.' : path.slice(0, slash)
    const name = slash === -1 ? path : path.slice(slash + 1)
    const directoryNode = tree[directory]
    const text = directoryNode?.files?.[name]
    if (text === undefined) return { ok: false as const, error: { code: 'workspace-file/not-found', message: 'missing' } }
    const data = new TextEncoder().encode(text)
    return { ok: true as const, value: { data, eof: true } }
  }
  return {
    async list(_sessionId: string, path: string) {
      // A real io-error, not `not-found`: the product treats missing as empty.
      if (fail.has(path)) return { ok: false as const, error: { code: 'workspace-file/io-error', message: 'list failed' } }
      const node = tree[path]
      if (node === undefined) return { ok: false as const, error: { code: 'workspace-file/not-found', message: 'missing' } }
      const entries = [
        ...Object.keys(node.files ?? {}).map(name => ({ name, type: 'file' as const })),
        ...(node.dirs ?? []).map(name => ({ name, type: 'directory' as const })),
      ]
      return { ok: true as const, value: { path, entries, truncated: false } }
    },
    async readBytes(_sessionId: string, path: string) {
      if (fail.has(path)) return { ok: false as const, error: { code: 'workspace-file/io-error', message: 'read failed' } }
      return read(path)
    },
  }
}

test('root READY alone is a visible record and never enables a PLAN that does not exist', async () => {
  const face = treeFace({
    '.': { files: { 'READY.md': '# 根交付记录\n\n历史事实。\n', 'AGENTS.md': 'human' }, dirs: ['docs'] },
    'docs/tasks': { dirs: [] },
  })
  const fixture = await clientFixture({ 'remote.workspaceFiles': face })
  const view = await fixture.entry()!.inject('session-1').list(new AbortController().signal) as {
    tasks: { id: string, plan: boolean, ready: boolean, delivery: string, title?: string, origin: string }[]
  }
  expect(view.tasks).toHaveLength(1)
  expect(view.tasks[0]).toMatchObject({ id: '.', origin: 'root', plan: false, ready: true, delivery: 'inspect' })
  expect(view.tasks[0]!.title).toBe('根交付记录')
})

test('a broken PLAN read does not hide the READY title and keeps the row as a review item', async () => {
  const face = treeFace({
    '.': { files: { 'PLAN.md': '# 方案\n', 'READY.md': '# 交付标题\n' }, dirs: ['docs'] },
    'docs/tasks': { dirs: [] },
  }, new Set(['PLAN.md']))
  const fixture = await clientFixture({ 'remote.workspaceFiles': face })
  const view = await fixture.entry()!.inject('session-1').list(new AbortController().signal) as {
    tasks: { plan: boolean, ready: boolean, title?: string, problem?: string, delivery: string }[]
  }
  expect(view.tasks[0]).toMatchObject({ plan: true, ready: true, delivery: 'inspect' })
  expect(view.tasks[0]!.title).toBe('交付标题')
  expect(view.tasks[0]!.problem).toContain('read failed')
})

test('a docs/tasks listing failure keeps the root record and reports a warning', async () => {
  // A missing directory is normal (not a warning); this fixture injects a real
  // io-error for docs/tasks so the warning path is exercised.
  const face = treeFace({
    '.': { files: { 'PLAN.md': '# 根方案\n', 'READY.md': '# 根交付\n' }, dirs: [] },
  }, new Set(['docs/tasks']))
  const fixture = await clientFixture({ 'remote.workspaceFiles': face })
  const page = await fixture.entry()!.inject('session-1').list(new AbortController().signal) as {
    tasks: { id: string }[], warnings: string[]
  }
  expect(page.tasks.map(task => task.id)).toEqual(['.'])
  expect(page.warnings).toHaveLength(1)
  expect(page.warnings[0]).toContain('list failed')
})

test('legacy and plain directories stay visible; a directory without documents is skipped', async () => {
  const face = treeFace({
    '.': { dirs: ['docs'] },
    'docs/tasks': { dirs: ['2026-10-01-old-layout', 'not-a-task', '2026-10-12-current-0123456789abcdef'] },
    'docs/tasks/2026-10-01-old-layout': { files: { 'PLAN.md': '# 旧方案\n', 'READY.md': '# 旧交付\n' } },
    'docs/tasks/not-a-task': { files: { 'notes.md': 'x' } },
    'docs/tasks/2026-10-12-current-0123456789abcdef': { files: { 'PLAN.md': '# 断元数据\n[project-ops-v1]: <data:application/json;base64,bm90LWpzb24=>\n\n正文\n' } },
  })
  const fixture = await clientFixture({ 'remote.workspaceFiles': face })
  const page = await fixture.entry()!.inject('session-1').list(new AbortController().signal) as {
    tasks: { id: string, legacy: boolean, managed: boolean, delivery: string, damaged?: boolean, title?: string }[]
  }
  // Newest first; the directory without PLAN/READY is not a delivery at all.
  expect(page.tasks.map(task => task.id)).toEqual(['2026-10-12-current-0123456789abcdef', '2026-10-01-old-layout'])
  expect(page.tasks[0]).toMatchObject({ legacy: false, managed: false, delivery: 'inspect', damaged: true })
  expect(page.tasks[1]).toMatchObject({ legacy: true, managed: false, delivery: 'inspect' })
  expect(page.tasks[1]!.title).toBe('旧方案')
})

test('the cursor reaches a delivery behind more than 600 empty directories', async () => {
  const empties = Array.from({ length: 620 }, (_, index) => `m-${String(index).padStart(3, '0')}`)
  const target = 'a-final'
  const tree: Record<string, Node> = {
    '.': { dirs: ['docs'] },
    // Newest first puts the target last, so every earlier candidate is empty.
    'docs/tasks': { dirs: [target, ...empties] },
    [`docs/tasks/${target}`]: { files: { 'READY.md': '# 末尾交付\n' } },
  }
  for (const name of empties) tree[`docs/tasks/${name}`] = { files: { 'notes.md': 'x' } }
  const fixture = await clientFixture({ 'remote.workspaceFiles': treeFace(tree) })
  const entry = fixture.entry()!.inject('session-1')
  let offset = 0
  let found: { ready: boolean, title?: string } | undefined
  for (let page = 0; page < 40; page += 1) {
    const result = await entry.list(new AbortController().signal, { offset }) as {
      tasks: { id: string, ready: boolean, title?: string }[], nextOffset: number, pending: number
    }
    const hit = result.tasks.find(task => task.id === target)
    if (hit !== undefined) { found = hit; break }
    if (result.pending === 0) break
    offset = result.nextOffset
  }
  expect(found).toMatchObject({ ready: true, title: '末尾交付' })
})

test('paging reuses one directory snapshot, so churn between pages cannot duplicate or drop rows', async () => {
  const empties = Array.from({ length: 33 }, (_, index) => `m-${String(index).padStart(3, '0')}`)
  const tree: Record<string, Node> = {
    '.': { dirs: ['docs'] },
    // Newest first puts the target last.
    'docs/tasks': { dirs: [...empties, 'a-target'] },
    'docs/tasks/a-target': { files: { 'READY.md': '# 末尾交付\n' } },
  }
  for (const name of empties) tree[`docs/tasks/${name}`] = { files: { 'notes.md': 'x' } }
  const fixture = await clientFixture({ 'remote.workspaceFiles': treeFace(tree) })
  const entry = fixture.entry()!.inject('session-1')
  type Page = { tasks: { id: string }[], nextOffset: number, total: number, pending: number, warnings: string[] }
  const first = await entry.list(new AbortController().signal, { offset: 0 }) as Page
  expect(first.total).toBe(34)
  expect(first.pending).toBe(2)

  // Between the two pages one directory disappears and two appear: a paging
  // model that re-listed docs/tasks would duplicate or skip rows here.
  tree['docs/tasks']!.dirs = [...empties.slice(1), 'zz-added', 'zz-added2', 'a-target']
  tree['docs/tasks/zz-added'] = { files: { 'PLAN.md': '# 新增\n' } }
  tree['docs/tasks/zz-added2'] = { files: { 'PLAN.md': '# 新增二\n' } }

  const second = await entry.list(new AbortController().signal, { offset: first.nextOffset }) as Page
  // Same generation keeps the original snapshot: total is unchanged and the new
  // directories are not half-included.
  expect(second.total).toBe(34)
  expect(second.tasks.map(row => row.id)).toContain('a-target')
  expect(second.tasks.some(row => row.id === 'zz-added' || row.id === 'zz-added2')).toBe(false)
  expect(second.warnings).toEqual([])

  // A refresh is a new generation: the fresh snapshot sees the changed listing.
  const refreshed = await entry.list(new AbortController().signal, { offset: 0 }) as Page
  expect(refreshed.total).toBe(35)
  expect(refreshed.tasks.map(row => row.id)).toContain('zz-added')
})

test('two session faces keep independent paging snapshots', async () => {
  const empties = Array.from({ length: 33 }, (_, index) => `m-${String(index).padStart(3, '0')}`)
  const tree: Record<string, Node> = {
    '.': { dirs: ['docs'] },
    'docs/tasks': { dirs: [...empties, 'a-target'] },
    'docs/tasks/a-target': { files: { 'READY.md': '# 末尾交付\n' } },
  }
  for (const name of empties) tree[`docs/tasks/${name}`] = { files: { 'notes.md': 'x' } }
  const fixture = await clientFixture({ 'remote.workspaceFiles': treeFace(tree) })
  const entry = fixture.entry()!
  const faceA = entry.inject('session-a')
  const faceB = entry.inject('session-b')
  type Page = { tasks: { id: string }[], nextOffset: number, total: number }
  const a1 = await faceA.list(new AbortController().signal, { offset: 0 }) as Page
  expect(a1.total).toBe(34)

  // The workspace changes while both sessions are paging.
  tree['docs/tasks']!.dirs = [...empties.slice(1), 'zz-added', 'zz-added2', 'a-target']
  tree['docs/tasks/zz-added'] = { files: { 'PLAN.md': '# 新增\n' } }
  tree['docs/tasks/zz-added2'] = { files: { 'PLAN.md': '# 新增二\n' } }

  // B starts its own generation and must not replace A's snapshot.
  const b1 = await faceB.list(new AbortController().signal, { offset: 0 }) as Page
  expect(b1.total).toBe(35)
  const a2 = await faceA.list(new AbortController().signal, { offset: a1.nextOffset }) as Page
  expect(a2.total).toBe(34)
  expect(a2.tasks.map(row => row.id)).toContain('a-target')
  expect(a2.tasks.some(row => row.id === 'zz-added' || row.id === 'zz-added2')).toBe(false)
  // B keeps its own generation too.
  const b2 = await faceB.list(new AbortController().signal, { offset: b1.nextOffset }) as Page
  expect(b2.total).toBe(35)
})

test('the required services stay the only hard activation requirements', () => {
  // The archive check asserts this too; here it is pinned in source so a later
  // edit cannot quietly turn an optional service into a hard activation lock.
  expect(ProjectOps.inject).toEqual(['slots', 'locale'])
  expect(ProjectOps.OPTIONAL_SERVICES).toEqual(['remote.workspaceFiles', 'sidebarRight', 'workspaces', 'sessions'])
})

/** A workspace-files face over one tree per session id. */
function sessionTreeFace(trees: Record<string, Record<string, Node>>) {
  return {
    async list(sessionId: string, path: string) {
      const tree = trees[sessionId]
      const node = tree?.[path]
      if (node === undefined) return { ok: false as const, error: { code: 'workspace-file/not-found', message: 'missing' } }
      const entries = [
        ...Object.keys(node.files ?? {}).map(name => ({ name, type: 'file' as const })),
        ...(node.dirs ?? []).map(name => ({ name, type: 'directory' as const })),
      ]
      return { ok: true as const, value: { path, entries, truncated: false } }
    },
    async readBytes(sessionId: string, path: string) {
      const slash = path.lastIndexOf('/')
      const directory = slash === -1 ? '.' : path.slice(0, slash)
      const name = slash === -1 ? path : path.slice(slash + 1)
      const text = trees[sessionId]?.[directory]?.files?.[name]
      if (text === undefined) return { ok: false as const, error: { code: 'workspace-file/not-found', message: 'missing' } }
      const data = new TextEncoder().encode(text)
      return { ok: true as const, value: { data, eof: true } }
    },
  }
}

/** Host workspace + session registry doubles with the snapshots the panel reads. */
function registries(projects: { id: string, path: string, title: string }[], sessions: { id: string, cwd: string }[]) {
  return {
    workspaces: { list: { getSnapshot: () => ({ items: projects.map(row => ({
      workspaceId: row.id, path: row.path, title: row.title, sessionIds: [], createdAt: '', updatedAt: '',
    })) }) } },
    sessions: { list: { getSnapshot: () => ({ byId: Object.fromEntries(sessions.map(row => [row.id, { id: row.id, cwd: row.cwd }])) }) } },
  }
}

const sameTask = '2026-10-12-shared-task-0123456789abcdef'
function projectTree(title: string): Record<string, Node> {
  return {
    '.': { dirs: ['docs'] },
    'docs/tasks': { dirs: [sameTask] },
    [`docs/tasks/${sameTask}`]: { files: { 'READY.md': `# ${title}\n` } },
  }
}

test('every registered project is listed, and a project with no matching session is not a zero-delivery success', async () => {
  const face = sessionTreeFace({ 'session-a': projectTree('A 交付'), 'session-b': projectTree('B 交付') })
  const fixture = await clientFixture({
    'remote.workspaceFiles': face,
    ...registries(
      [{ id: 'ws-a', path: '/ws/a', title: '项目 A' }, { id: 'ws-b', path: '/ws/b', title: '项目 B' }, { id: 'ws-c', path: '/ws/c', title: '项目 C' }],
      // The third session's cwd belongs to no registered project: a moved session
      // must never serve a foreign project.
      [{ id: 'session-a', cwd: '/ws/a' }, { id: 'session-b', cwd: '/ws/b' }, { id: 'session-c', cwd: '/ws/elsewhere' }],
    ),
  })
  const entry = fixture.entry()!.inject('session-a')
  expect(entry.surface()).toEqual({ list: true, preview: false, projects: true })
  const overview = await entry.overview(new AbortController().signal) as {
    groups: { workspaceId: string, status: string, rows: { title?: string, sessionId?: string }[], totalProjects?: number }[]
    totalProjects: number, pendingProjects: number
  }
  expect(overview.totalProjects).toBe(3)
  expect(overview.pendingProjects).toBe(0)
  const byId = Object.fromEntries(overview.groups.map(group => [group.workspaceId, group]))
  expect(byId['ws-a']!.status).toBe('readable')
  expect(byId['ws-a']!.rows[0]).toMatchObject({ title: 'A 交付', sessionId: 'session-a' })
  expect(byId['ws-b']!.rows[0]).toMatchObject({ title: 'B 交付', sessionId: 'session-b' })
  // No session whose cwd is exactly the project path: visible, but not "readable".
  expect(byId['ws-c']!.status).toBe('no-session')
  expect(byId['ws-c']!.rows).toEqual([])
})

test('the same task directory in two projects stays two rows with their own sessions', async () => {
  const face = sessionTreeFace({ 'session-a': projectTree('A 交付'), 'session-b': projectTree('B 交付') })
  const fixture = await clientFixture({
    'remote.workspaceFiles': face,
    ...registries(
      [{ id: 'ws-a', path: '/ws/a', title: 'A' }, { id: 'ws-b', path: '/ws/b', title: 'B' }],
      [{ id: 'session-a', cwd: '/ws/a' }, { id: 'session-b', cwd: '/ws/b' }],
    ),
  })
  const overview = await fixture.entry()!.inject('session-a').overview(new AbortController().signal) as {
    groups: { workspaceId: string, rows: { id: string, path: string, title?: string, sessionId?: string }[] }[]
  }
  for (const group of overview.groups) {
    expect(group.rows).toHaveLength(1)
    expect(group.rows[0]!.id).toBe(sameTask)
    expect(group.rows[0]!.path).toBe(`docs/tasks/${sameTask}`)
    expect(group.rows[0]!.sessionId).toBe(group.workspaceId === 'ws-a' ? 'session-a' : 'session-b')
    expect(group.rows[0]!.title).toBe(group.workspaceId === 'ws-a' ? 'A 交付' : 'B 交付')
  }
})

test('a project group continues its own directory cursor without touching other groups', async () => {
  const empties = Array.from({ length: 33 }, (_, index) => `m-${String(index).padStart(3, '0')}`)
  const tree: Record<string, Node> = {
    '.': { dirs: ['docs'] },
    'docs/tasks': { dirs: [...empties, 'a-target'] },
    'docs/tasks/a-target': { files: { 'READY.md': '# 末尾交付\n' } },
  }
  for (const name of empties) tree[`docs/tasks/${name}`] = { files: { 'notes.md': 'x' } }
  const fixture = await clientFixture({
    'remote.workspaceFiles': sessionTreeFace({ 'session-d': tree }),
    ...registries(
      [{ id: 'ws-d', path: '/ws/d', title: 'D' }, { id: 'ws-e', path: '/ws/e', title: 'E' }],
      [{ id: 'session-d', cwd: '/ws/d' }],
    ),
  })
  const entry = fixture.entry()!.inject('session-d')
  type Group = { workspaceId: string, rows: { id: string }[], nextOffset: number, pending: number }
  const first = await entry.overview(new AbortController().signal) as { groups: Group[] }
  const group = first.groups.find(row => row.workspaceId === 'ws-d')!
  expect(group.pending).toBe(2)
  expect(group.rows.some(row => row.id === 'a-target')).toBe(false)
  const next = await entry.overview(new AbortController().signal, { group: { workspaceId: 'ws-d', offset: group.nextOffset } }) as { groups: Group[] }
  expect(next.groups).toHaveLength(1)
  expect(next.groups[0]!.rows.map(row => row.id)).toContain('a-target')
})

test('without the workspace registry the all-projects view reports unavailable and the current view still works', async () => {
  const fixture = await clientFixture({ 'remote.workspaceFiles': sessionTreeFace({ 'session-1': projectTree('当前交付') }) })
  const entry = fixture.entry()!.inject('session-1')
  expect(entry.surface()).toEqual({ list: true, preview: false, projects: false })
  await expect(entry.overview(new AbortController().signal)).rejects.toThrow(/workspace registry/u)
  const page = await entry.list(new AbortController().signal) as { tasks: { title?: string }[] }
  expect(page.tasks[0]!.title).toBe('当前交付')
})

test('a loading, failed or shapeless registry is never an authoritative empty project list', async () => {
  const face = sessionTreeFace({ 'session-a': projectTree('A 交付') })
  const loading = { workspaces: { list: { getSnapshot: () => ({ items: [], state: 'loading', phase: 'pending', error: null }) } } }
  const failed = { workspaces: { list: { getSnapshot: () => ({ items: [], state: 'error', error: new Error('boom') }) } } }
  const shapeless = { workspaces: { list: { getSnapshot: () => ({}) } } }
  for (const registry of [loading, failed, shapeless]) {
    const fixture = await clientFixture({
      'remote.workspaceFiles': face,
      ...registry,
      sessions: { list: { getSnapshot: () => ({ byId: { 'session-a': { id: 'session-a', cwd: '/ws/a' } } }) } },
    })
    const entry = fixture.entry()!.inject('session-a')
    expect(entry.surface().projects).toBe(false)
    await expect(entry.overview(new AbortController().signal)).rejects.toThrow(/registry/u)
  }
  // Only a ready, real empty registry is a true zero.
  const empty = await clientFixture({
    'remote.workspaceFiles': face,
    workspaces: { list: { getSnapshot: () => ({ items: [], state: 'idle', phase: 'ready', error: null }) } },
    sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
  })
  const page = await empty.entry()!.inject('session-a').overview(new AbortController().signal) as { totalProjects: number, groups: unknown[] }
  expect(page.totalProjects).toBe(0)
  expect(page.groups).toEqual([])
})

test('continuing a project cursor is refused after the project is removed or its path changes', async () => {
  const empties = Array.from({ length: 33 }, (_, index) => `m-${String(index).padStart(3, '0')}`)
  const tree: Record<string, Node> = {
    '.': { dirs: ['docs'] },
    'docs/tasks': { dirs: [...empties, 'a-target'] },
    'docs/tasks/a-target': { files: { 'READY.md': '# 末尾交付\n' } },
  }
  for (const name of empties) tree[`docs/tasks/${name}`] = { files: { 'notes.md': 'x' } }
  const registry = registries(
    [{ id: 'ws-d', path: '/ws/d', title: 'D' }],
    [{ id: 'session-d', cwd: '/ws/d' }],
  )
  const fixture = await clientFixture({ 'remote.workspaceFiles': sessionTreeFace({ 'session-d': tree }), ...registry })
  const entry = fixture.entry()!.inject('session-d')
  type Group = { workspaceId: string, rows: { id: string }[], nextOffset: number }
  const first = await entry.overview(new AbortController().signal) as { groups: Group[] }
  const group = first.groups[0]!
  // The project moves: the old cursor must not continue silently.
  registry.workspaces.list.getSnapshot = () => ({ items: [{ workspaceId: 'ws-d', path: '/ws/moved', title: 'D', sessionIds: [], createdAt: '', updatedAt: '' }] })
  await expect(entry.overview(new AbortController().signal, { group: { workspaceId: 'ws-d', offset: group.nextOffset } }))
    .rejects.toThrow(/path changed|refresh/u)
  // The project disappears entirely.
  registry.workspaces.list.getSnapshot = () => ({ items: [], state: 'idle', phase: 'ready', error: null })
  await expect(entry.overview(new AbortController().signal, { group: { workspaceId: 'ws-d', offset: group.nextOffset } }))
    .rejects.toThrow(/removed|refresh/u)
})

test('the registry observer subscribes both stores and its cleanup unsubscribes them', async () => {
  const listeners: (() => void)[] = []
  const off = () => { listeners.pop() }
  const face = sessionTreeFace({ 'session-1': projectTree('当前交付') })
  const fixture = await clientFixture({
    'remote.workspaceFiles': face,
    workspaces: { list: { getSnapshot: () => ({ items: [], state: 'idle', phase: 'ready', error: null }), subscribe: (fn: () => void) => { listeners.push(fn); return off } } },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: (fn: () => void) => { listeners.push(fn); return off } } },
  })
  const entry = fixture.entry()!.inject('session-1')
  const cleanup = entry.observe(() => {})
  expect(listeners).toHaveLength(2)
  cleanup()
  expect(listeners).toHaveLength(0)
})

/** A workspace-files face over sized directory listings. */
type SizedEntry = { name: string, type: 'file' | 'directory' | 'other', size?: number }
function sizedFace(dirs: Record<string, SizedEntry[]>, truncated: ReadonlySet<string> = new Set()) {
  return {
    async list(_session: string, path: string) {
      const entries = dirs[path]
      if (entries === undefined) return { ok: false as const, error: { code: 'workspace-file/not-found', message: 'missing' } }
      return { ok: true as const, value: { path, entries, truncated: truncated.has(path) } }
    },
    async readBytes() {
      return { ok: false as const, error: { code: 'workspace-file/not-found', message: 'missing' } }
    },
  }
}

test('project files are listed from real directories without PLAN, READY or an extension filter', async () => {
  const face = sizedFace({
    '.': [
      { name: 'docs', type: 'directory' },
      { name: 'release notes 2026.xlsx', type: 'file', size: 5382 },
      { name: '安装包.exe', type: 'file', size: 12 * 1024 * 1024 },
      { name: 'report.unknownext', type: 'file' },
      { name: 'link-entry', type: 'other' },
    ],
    dist: [{ name: 'app.bin', type: 'file', size: 2048 }],
    build: [],
  }, new Set(['.']))
  const fixture = await clientFixture({ 'remote.workspaceFiles': face })
  const entry = fixture.entry()!.inject('session-1')
  expect(entry.surface().files).toBe(true)
  const page = await entry.files(new AbortController().signal) as {
    entries: { name: string, type: string, size?: number, path: string, sessionId: string }[]
    total: number, truncated: boolean, missing?: boolean, warnings: string[]
  }
  // No PLAN.md or READY.md exists here; the files still appear.
  expect(page.entries.map(row => row.name)).toEqual(expect.arrayContaining(['docs', 'release notes 2026.xlsx', '安装包.exe', 'report.unknownext']))
  expect(page.entries[0]!.type).toBe('directory')
  expect(page.total).toBe(4)
  expect(page.truncated).toBe(true)
  // The exotic entry is counted, not silently dropped.
  expect(page.warnings.join(' ')).toContain('unsupported kind')
  const exe = page.entries.find(row => row.name === '安装包.exe')!
  expect(exe.size).toBe(12 * 1024 * 1024)
  expect(exe.path).toBe('安装包.exe')
  expect(exe.sessionId).toBe('session-1')
  const noSize = page.entries.find(row => row.name === 'report.unknownext')!
  expect(noSize.size).toBeUndefined()

  const dist = await entry.files(new AbortController().signal, { root: 'dist' }) as { entries: { name: string, path: string }[], missing?: boolean }
  expect(dist.entries.map(row => row.path)).toEqual(['dist/app.bin'])
  // An absent root is explicitly missing, not an empty listing that reads as success.
  const missing = await entry.files(new AbortController().signal, { root: 'release' }) as { missing?: boolean }
  expect(missing.missing).toBe(true)
  const empty = await entry.files(new AbortController().signal, { root: 'build' }) as { entries: unknown[], missing?: boolean }
  expect(empty.missing).toBeUndefined()
  expect(empty.entries).toEqual([])
})

test('file directory requests are confined to the approved roots', async () => {
  const fixture = await clientFixture({ 'remote.workspaceFiles': sizedFace({ '.': [] }) })
  const entry = fixture.entry()!.inject('session-1')
  await expect(entry.files(new AbortController().signal, { root: 'nope' })).rejects.toThrow(/unsupported project directory/u)
  await expect(entry.files(new AbortController().signal, { root: 'dist', path: '../etc' })).rejects.toThrow(/unsupported project directory/u)
  await expect(entry.files(new AbortController().signal, { root: 'dist', path: '/etc/passwd' })).rejects.toThrow(/unsupported project directory/u)
})

test('files can be read for another registered project through its own session', async () => {
  const face = sessionTreeFace({
    'session-a': { '.': { files: { 'a.txt': 'a' } } },
    'session-b': { '.': { files: { '安装 包.exe': 'x' } } },
  })
  const fixture = await clientFixture({
    'remote.workspaceFiles': face,
    ...registries(
      [{ id: 'ws-a', path: '/ws/a', title: 'A' }, { id: 'ws-b', path: '/ws/b', title: 'B' }],
      [{ id: 'session-a', cwd: '/ws/a' }, { id: 'session-b', cwd: '/ws/b' }],
    ),
  })
  const entry = fixture.entry()!.inject('session-a')
  const options = await entry.projects(new AbortController().signal) as { workspaceId: string, readable: boolean }[]
  expect(options.map(option => option.workspaceId)).toEqual(['ws-a', 'ws-b'])
  expect(options.every(option => option.readable)).toBe(true)
  const page = await entry.files(new AbortController().signal, { project: 'ws-b' }) as { entries: { name: string, sessionId: string }[] }
  expect(page.entries[0]).toMatchObject({ name: '安装 包.exe', sessionId: 'session-b' })
  await expect(entry.files(new AbortController().signal, { project: 'ws-gone' })).rejects.toThrow(/no longer registered|registered/u)
})

test('a pending session registry phase is not an authoritative empty identity map', async () => {
  const face = sessionTreeFace({ 'session-a': projectTree('A 交付') })
  const fixture = await clientFixture({
    'remote.workspaceFiles': face,
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-a', path: '/ws/a', title: 'A' }], state: 'idle', phase: 'ready', error: null }) } },
    sessions: { list: { getSnapshot: () => ({ byId: {}, state: 'idle', phase: 'pending', error: null }) } },
  })
  const entry = fixture.entry()!.inject('session-a')
  expect(entry.surface().projects).toBe(false)
  await expect(entry.overview(new AbortController().signal)).rejects.toThrow(/registry/u)
  // The files view still works: it does not depend on the session map.
  const page = await entry.files(new AbortController().signal) as { entries: unknown[] }
  expect(page.entries).toEqual([])
})

test('the registry observer ignores projection-only churn and reports identity changes only', async () => {
  const listeners: (() => void)[] = []
  const state: { items: { workspaceId: string, path: string }[], byId: Record<string, { id: string, cwd: string, updatedAt?: number }> } = {
    items: [{ workspaceId: 'ws-a', path: '/ws/a' }],
    byId: { sa: { id: 'sa', cwd: '/ws/a' } },
  }
  const subscribe = (fn: () => void) => { listeners.push(fn); return () => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1) } }
  const fixture = await clientFixture({
    'remote.workspaceFiles': sizedFace({ '.': [] }),
    workspaces: { list: { getSnapshot: () => ({ items: state.items, state: 'idle', phase: 'ready', error: null }), subscribe } },
    sessions: { list: { getSnapshot: () => ({ byId: state.byId, state: 'idle', phase: 'ready', error: null }), subscribe } },
  })
  const entry = fixture.entry()!.inject('session-a')
  const calls: number[] = []
  const cleanup = entry.observe(() => calls.push(1))
  expect(listeners).toHaveLength(2)
  // Running state / updatedAt / projection values are not identity: no reset.
  state.byId = { sa: { id: 'sa', cwd: '/ws/a', updatedAt: 99 } }
  for (const listener of [...listeners]) listener()
  expect(calls).toHaveLength(0)
  // A newly registered project is an identity change.
  state.items = [...state.items, { workspaceId: 'ws-b', path: '/ws/b' }]
  for (const listener of [...listeners]) listener()
  expect(calls).toHaveLength(1)
  cleanup()
  expect(listeners).toHaveLength(0)
})
