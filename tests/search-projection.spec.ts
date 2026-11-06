import { Context } from '@deepseek-ai/cordis'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { expect, test } from 'vitest'
import * as ProjectOps from '../src/index.ts'
import { SEARCH_PROJECTION, SEARCH_LIMITS, type SearchHistory } from '../src/search-history.ts'

const header = (id: string, cwd = '/work/repo') => ({ id, version: 3, createdAt: 0, cwd, isSeeded: false })
const event = (seq: number, type: string, data: unknown, surfaceOp?: unknown) =>
  ({ seq, time: 1000 + seq * 10, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) })
const call = (seq: number, callId: string, name: string, args: Record<string, unknown>) =>
  event(seq, 'tool/call', { callId, name, arguments: JSON.stringify(args) })
const result = (seq: number, callId: string, meta: unknown, isError = false, text = 'ok') =>
  event(seq, 'tool/result', { message: { role: 'tool', source: { callId }, isError, content: [{ type: 'text', text }] }, meta }, 'append')

async function registry() {
  const ctx = new Context()
  await ctx.plugin(SessionProjections)
  await ctx.plugin({ apply(inner: Context) {
    inner.provide('fs', {})
    inner.provide('tools', { register: () => () => {} })
  } })
  const fiber = await ctx.plugin(ProjectOps)
  return { ctx, fiber }
}

function restore(ctx: Context, events: unknown[], sessionHeader = header('search-session')): SearchHistory {
  return ctx.sessionProjections.restore({}, events as never, 0 as never, sessionHeader as never, 0 as never).snapshot.values[SEARCH_PROJECTION] as SearchHistory
}

test('replays glob and grep metadata as deduplicated absolute paths without hit lines', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [
      event(0, 'working-directory/change', { cwd: '/work/repo' }),
      call(1, 'g1', 'glob', { pattern: '**/*.md', path: 'src' }),
      result(2, 'g1', { shape: 'paths', paths: ['a.md', 'src/a.md', '/abs/b.md'], truncated: false, total: 3 }),
      call(3, 'g2', 'grep', { pattern: 'secret', path: 'src' }),
      result(4, 'g2', { shape: 'matches', files: [{ path: 'src/x.ts', matches: [{ lineNumber: 1, line: 'secret line' }] }], truncated: false, total: 1 }),
    ]
    const view = restore(ctx, events)
    expect(view.searches).toHaveLength(2)
    expect(view.searches[0]).toMatchObject({ mode: 'grep', query: 'secret', files: ['/work/repo/src/x.ts'], total: 1, truncated: false })
    expect(view.searches[1]).toMatchObject({
      mode: 'glob', query: '**/*.md', files: ['/work/repo/a.md', '/work/repo/src/a.md', '/abs/b.md'], total: 3, truncated: false,
    })
    // The grep hit line stays in the session log, never in this projection.
    expect(JSON.stringify(view)).not.toContain('secret line')
    expect(view.searches.every(entry => Number.isFinite(entry.time))).toBe(true)
  } finally { await fiber.dispose() }
})

test('uses the call-time working directory for relative hits and omits unresolvable ones', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [
      call(0, 'g1', 'glob', { pattern: '*.md' }),
      result(1, 'g1', { shape: 'paths', paths: ['early.md'], truncated: false, total: 1 }),
      event(2, 'working-directory/change', { cwd: '/work/next' }),
      call(3, 'g2', 'glob', { pattern: '*.md' }),
      result(4, 'g2', { shape: 'paths', paths: ['later.md'], truncated: false, total: 1 }),
    ]
    const view = restore(ctx, events)
    expect(view.searches[0]!.files).toEqual(['/work/next/later.md'])
    expect(view.searches[1]!.files).toEqual(['/work/repo/early.md'])
    // No absolute working directory at all: no wrong clickable path, but the
    // entry still reports that some hits were not shown.
    const bare = restore(ctx, [call(0, 'g3', 'glob', { pattern: '*.md' }), result(1, 'g3', { shape: 'paths', paths: ['rel.md'], truncated: false, total: 1 })], header('bare', ''))
    expect(bare.searches[0]!.files).toEqual([])
    expect(bare.searches[0]!.truncated).toBe(true)
  } finally { await fiber.dispose() }
})

test('records web search sources once each, with only http(s) links', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [
      call(0, 'w1', 'web_search', { queries: ['dsh docs', 'project ops'] }),
      result(1, 'w1', { sources: [
        { url: 'https://example.com/a', title: 'A' },
        { url: 'https://example.com/a', title: 'duplicate' },
        { url: 'javascript:alert(1)', title: 'unsafe' },
        { url: 'https://example.com/b' },
      ], truncated: true }),
    ]
    const view = restore(ctx, events)
    expect(view.searches[0]).toMatchObject({
      mode: 'web_search', query: 'dsh docs, project ops', truncated: true,
      sources: [{ title: 'A', url: 'https://example.com/a' }, { title: 'https://example.com/b', url: 'https://example.com/b' }],
    })
  } finally { await fiber.dispose() }
})

test('a successful fetch is an opened page only with a 2xx status and an explicit link', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [
      call(0, 'f1', 'web_fetch', { url: 'https://example.com/ok' }),
      result(1, 'f1', { url: 'https://example.com/ok', statusCode: 200, truncated: false }),
      call(2, 'f2', 'web_fetch', { url: 'https://example.com/missing' }),
      result(3, 'f2', { url: 'https://example.com/missing', statusCode: 404, truncated: false }),
      call(4, 'f3', 'web_fetch', { url: 'https://example.com/error' }),
      result(5, 'f3', { url: 'https://example.com/error', statusCode: 500, truncated: true }),
      call(6, 'f4', 'web_fetch', { url: 'https://example.com/cut' }),
      result(7, 'f4', { url: 'https://example.com/cut', statusCode: 200, truncated: true }),
    ]
    const view = restore(ctx, events)
    expect(view.searches).toHaveLength(2)
    expect(view.searches[0]).toMatchObject({ mode: 'web_fetch', opened: 'https://example.com/cut', total: 1, truncated: false })
    expect(view.searches[1]).toMatchObject({ mode: 'web_fetch', opened: 'https://example.com/ok', total: 1 })
  } finally { await fiber.dispose() }
})

test('a capped web search still reports the pre-cap deduplicated source total', async () => {
  const { ctx, fiber } = await registry()
  try {
    const sources = Array.from({ length: SEARCH_LIMITS.sources + 5 }, (_, index) => ({ url: `https://example.com/${index}`, title: `S${index}` }))
    const events = [call(0, 'w1', 'web_search', { queries: ['wide'] }), result(1, 'w1', { sources, truncated: false })]
    const view = restore(ctx, events)
    expect(view.searches[0]!.sources).toHaveLength(SEARCH_LIMITS.sources)
    expect(view.searches[0]!.total).toBe(SEARCH_LIMITS.sources + 5)
    expect(view.searches[0]!.truncated).toBe(true)
  } finally { await fiber.dispose() }
})

test('a failed call is kept as a failure and never contributes hits', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [call(0, 'g1', 'grep', { pattern: 'boom' }), result(1, 'g1', { shape: 'matches', files: [{ path: 'x.md', matches: [] }] }, true, 'tool exploded')]
    const view = restore(ctx, events)
    expect(view.searches[0]).toMatchObject({ mode: 'grep', files: [], sources: [], error: 'tool exploded' })
  } finally { await fiber.dispose() }
})

test('session query tools contribute only their query text, never parsed results', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [
      call(0, 's1', 'session_search', { query: 'project ops' }),
      result(1, 's1', {}, false, 'Found sessions: secret body'),
      call(2, 's2', 'session_event_search', { query: 'README.md' }),
      result(3, 's2', {}, true, 'search failed'),
    ]
    const view = restore(ctx, events)
    expect(view.searches).toHaveLength(2)
    expect(view.searches[0]).toMatchObject({ mode: 'session_event_search', query: 'README.md', files: [], sources: [], error: 'search failed' })
    expect(view.searches[1]).toMatchObject({ mode: 'session_search', query: 'project ops', files: [], sources: [], total: 0 })
    expect(view.searches[1]!.error).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('secret body')
  } finally { await fiber.dispose() }
})

test('missing metadata is skipped instead of becoming a zero-hit search', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [
      call(0, 'g1', 'glob', { pattern: '*.md' }),
      result(1, 'g1', {}),
      call(2, 'g2', 'glob', { pattern: '*.ts' }),
      result(3, 'g2', { shape: 'paths', paths: [], truncated: false, total: 0 }),
    ]
    const view = restore(ctx, events)
    expect(view.searches).toHaveLength(1)
    expect(view.searches[0]).toMatchObject({ query: '*.ts', files: [], total: 0 })
  } finally { await fiber.dispose() }
})

test('bounds the history and marks it truncated', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events: unknown[] = []
    for (let index = 0; index < SEARCH_LIMITS.searches + 1; index += 1) {
      events.push(call(index * 2, `g${index}`, 'glob', { pattern: `*.md` }))
      events.push(result(index * 2 + 1, `g${index}`, { shape: 'paths', paths: [`f${index}.md`], truncated: false, total: 1 }))
    }
    const view = restore(ctx, events)
    expect(view.searches).toHaveLength(SEARCH_LIMITS.searches)
    expect(view.truncated).toBe(true)
  } finally { await fiber.dispose() }
})

test('replay is deterministic and one session never inherits another session search history', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [call(0, 'g1', 'glob', { pattern: '*.md' }), result(1, 'g1', { shape: 'paths', paths: ['a.md'], truncated: false, total: 1 })]
    const first = restore(ctx, events)
    const again = restore(ctx, events)
    expect(again).toEqual(first)
    expect(restore(ctx, [], header('other-session'))).toEqual({ searches: [], truncated: false })
  } finally { await fiber.dispose() }
})
