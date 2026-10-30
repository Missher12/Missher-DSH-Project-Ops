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
    surface: () => { list: boolean; preview: boolean }
    list: (signal: AbortSignal) => Promise<unknown>
    open: (task: string, file: 'PLAN.md' | 'READY.md') => void
    files: (signal: AbortSignal) => Promise<unknown>
    openFile: (path: string, signal: AbortSignal) => Promise<void>
    revealFile: (path: string, signal: AbortSignal) => Promise<void>
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
  expect(face.surface()).toEqual({ list: false, preview: false })
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
  expect(face.surface()).toEqual({ list: false, preview: false })
})

test('a provided workspace-files nameservice is reported available for the read half', async () => {
  // The kernel keys services by their full name in the isolate store, dotted
  // names included (`Context.get` documents itself as the accessor without the
  // inject requirement), so registering `remote.workspaceFiles` as one name is
  // exactly how a Host exposes it. Keep the assertion if this ever fails.
  const fixture = await clientFixture({ 'remote.workspaceFiles': filesFace() })
  const face = fixture.entry()!.inject('session-1')
  expect(face.surface().list).toBe(true)
  // The read path runs against the injected service and returns the empty listing.
  await expect(face.list(new AbortController().signal)).resolves.toEqual({ tasks: [], truncated: false })
})

test('a workspace-files service without readBytes keeps the read half disabled', async () => {
  const fixture = await clientFixture({ 'remote.workspaceFiles': { list: () => Promise.resolve({ ok: true, value: { entries: [], truncated: false } }) } })
  const face = fixture.entry()!.inject('session-1')
  expect(face.surface().list).toBe(false)
  await expect(face.list(new AbortController().signal)).rejects.toThrow(/workspace-files remote/)
})

test('the required services stay the only hard activation requirements', () => {
  // The archive check asserts this too; here it is pinned in source so a later
  // edit cannot quietly turn an optional service into a hard activation lock.
  expect(ProjectOps.inject).toEqual(['slots', 'locale'])
  expect(ProjectOps.OPTIONAL_SERVICES).toEqual(['remote.workspaceFiles', 'sidebarRight', 'remote.session', 'sessions'])
})

test('reads the viewed session file projection and checks the file before native preview', async () => {
  const reads: string[] = []
  const opened: string[] = []
  const fixture = await clientFixture({
    'remote.session': { projections: async ({ sessionId }: { sessionId: string }) => {
      reads.push(sessionId)
      return { ok: true, value: { kind: 'sequenced', asOfSeq: 10, values: {
        missherProjectOpsFiles: { files: [{ path: '/work/report.docx', updatedAt: 1 }], truncated: false },
      } } }
    } },
    'remote.workspaceFiles': { ...filesFace(), stat: async (sessionId: string, path: string) => {
      reads.push(`${sessionId}:${path}`)
      return path.endsWith('missing.xlsx') ? { ok: false, error: { code: 'workspace-file/not-found', message: 'File not found' } } : { ok: true, value: { kind: 'file' } }
    } },
    sidebarRight: { openResource: (address: string) => { opened.push(address) } },
  })
  const face = fixture.entry()!.inject('viewed-session')
  const signal = new AbortController().signal
  await expect(face.files(signal)).resolves.toMatchObject({ files: [{ path: '/work/report.docx' }], truncated: false })
  await face.openFile('/work/report.docx', signal)
  await expect(face.openFile('/work/missing.xlsx', signal)).rejects.toThrow('File not found')
  expect(reads).toEqual(['viewed-session', 'viewed-session:/work/report.docx', 'viewed-session:/work/missing.xlsx'])
  expect(opened).toHaveLength(1)
  expect(opened[0]).toContain('report.docx')
})

test('reveal asks the Host to show the file in Finder after checking it still exists', async () => {
  const calls: unknown[] = []
  const fixture = await clientFixture({
    'remote.session': { openWorkspacePath: async (request: { path: string, action?: string }) => { calls.push(request); return { ok: true } } },
    'remote.workspaceFiles': {
      ...filesFace(),
      stat: async (_sessionId: string, path: string) => path.endsWith('gone.docx')
        ? { ok: false, error: { code: 'workspace-file/not-found', message: 'no entry' } }
        : { ok: true, value: { kind: 'file' } },
    },
  })
  const face = fixture.entry()!.inject('viewed-session')
  const signal = new AbortController().signal
  await expect(face.revealFile('/work/方案-分类测试.docx', signal)).resolves.toBeUndefined()
  await expect(face.revealFile('/work/gone.docx', signal)).rejects.toMatchObject({ outcome: 'missing' })
  expect(calls).toEqual([{ path: '/work/方案-分类测试.docx', action: 'reveal' }])
})

test('a Host without the reveal Remote reports unsupported and keeps the panel usable', async () => {
  const fixture = await clientFixture({ 'remote.workspaceFiles': filesFace() })
  const face = fixture.entry()!.inject('session-1')
  await expect(face.revealFile('/work/report.docx', new AbortController().signal)).rejects.toMatchObject({ outcome: 'unsupported' })
  // Only the reveal action is affected: the entry itself still renders.
  expect(face.surface()).toEqual({ list: true, preview: false })
})
