import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import {
  SEARCH_LIMITS, SEARCH_MODES, SEARCH_PROJECTION, isSearchMode, safeHttpUrl,
  type SearchEntry, type SearchHistory, type SearchMode, type SearchWebSource,
} from './search-history.ts'

/** The session's search history: pending call metadata, the working directory and the view. */
interface SearchState {
  cwd: string
  pending: Record<string, { mode: SearchMode; query: string; cwd: string }>
  view: SearchHistory
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { missherProjectOpsSearch: SearchHistory }
  interface SessionProjectionStateMap { missherProjectOpsSearch: SearchState }
}

const entrySchema = z.object({
  callId: z.string().min(1).max(200),
  mode: z.enum(SEARCH_MODES),
  query: z.string().max(4000),
  files: z.array(z.string().min(1).max(4096)).max(SEARCH_LIMITS.files),
  sources: z.array(z.object({ title: z.string().max(1000), url: z.string().max(4096) })).max(SEARCH_LIMITS.sources),
  opened: z.string().max(4096).optional(),
  total: z.number().finite(),
  truncated: z.boolean(),
  error: z.string().max(SEARCH_LIMITS.error).optional(),
  time: z.number().finite(),
})
const viewSchema = z.object({
  searches: z.array(entrySchema).max(SEARCH_LIMITS.searches),
  truncated: z.boolean(),
})

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const validPath = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= 4096 && !/[\u0000-\u001f]/u.test(value)
const absolutePath = (value: string): boolean =>
  /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\\\') || value.startsWith('/')

/** Resolve one Host result path: absolute stays, a workdir-relative hit uses the call-time cwd. */
function resolveHit(cwd: string, value: unknown): string | undefined {
  if (!validPath(value)) return undefined
  const windows = absolutePath(value) ? /^[a-z]:[\\/]|^\\\\/iu.test(value) : /^[a-z]:[\\/]|^\\\\/iu.test(cwd)
  const paths = windows ? win32 : posix
  if (paths.isAbsolute(value)) return paths.normalize(value)
  // A relative hit without a known absolute working directory cannot name a
  // real file; keeping it would make a wrong directory clickable.
  if (cwd.length === 0 || !paths.isAbsolute(cwd)) return undefined
  return paths.resolve(cwd, value)
}

/** Dedupe and bound one result list, preserving the Host's order. */
function uniquePaths(cwd: string, values: unknown): { paths: string[]; truncated: boolean } {
  if (!Array.isArray(values)) return { paths: [], truncated: false }
  const seen = new Set<string>()
  let unresolved = 0
  for (const value of values) {
    const path = resolveHit(cwd, value)
    if (path !== undefined) { if (!seen.has(path)) seen.add(path) } else if (validPath(value)) unresolved += 1
  }
  // A relative hit without a known absolute cwd is not clickable, but the entry
  // must still say that some hits were not shown.
  return { paths: [...seen].slice(0, SEARCH_LIMITS.files), truncated: seen.size > SEARCH_LIMITS.files || unresolved > 0 }
}

/** Dedupe web sources by URL; a malformed or non-http(s) source is dropped. */
function uniqueSources(values: unknown): { sources: SearchWebSource[]; total: number; truncated: boolean } {
  if (!Array.isArray(values)) return { sources: [], total: 0, truncated: false }
  const seen = new Set<string>()
  const sources: SearchWebSource[] = []
  for (const value of values) {
    const source = record(value)
    const url = safeHttpUrl(source.url)
    if (url === undefined || seen.has(url)) continue
    const title = typeof source.title === 'string' && source.title.trim() !== '' ? source.title.slice(0, 1000) : url
    seen.add(url)
    sources.push({ title, url })
  }
  // `total` counts the compliant deduplicated sources before our display cap.
  return { sources: sources.slice(0, SEARCH_LIMITS.sources), total: seen.size, truncated: seen.size > SEARCH_LIMITS.sources }
}

/** The query text one native call carries. */
function queryOf(mode: SearchMode, args: Record<string, unknown>): string | undefined {
  if (mode === 'glob' || mode === 'grep') {
    return typeof args.pattern === 'string' && args.pattern.trim() !== '' ? args.pattern.slice(0, 4000) : undefined
  }
  if (mode === 'web_search') {
    const queries = Array.isArray(args.queries) ? args.queries.filter((query): query is string => typeof query === 'string' && query.trim() !== '') : []
    return queries.length > 0 ? queries.join(', ').slice(0, 4000) : undefined
  }
  if (mode === 'session_search' || mode === 'session_event_search') {
    return typeof args.query === 'string' && args.query.trim() !== '' ? args.query.slice(0, 4000) : undefined
  }
  return typeof args.url === 'string' && args.url.trim() !== '' ? args.url.slice(0, 4000) : undefined
}

/** The failure detail carried by one tool result, bounded and never parsed as data. */
function errorOf(message: Record<string, unknown>): string {
  const content = Array.isArray(message.content) ? message.content : []
  const text = content.map(part => {
    const item = record(part)
    return typeof item.text === 'string' ? item.text : ''
  }).join('\n').trim()
  return (text || 'search failed').slice(0, SEARCH_LIMITS.error)
}

/**
 * Project one finished call into an entry. Unknown or malformed metadata is
 * skipped instead of being guessed from text, a failed call never carries
 * files or sources, and a non-2xx fetch is not an opened page.
 */
function entryOf(
  pending: { mode: SearchMode; query: string; cwd: string },
  callId: string,
  message: Record<string, unknown>,
  meta: Record<string, unknown>,
  time: number,
): SearchEntry | undefined {
  const base = { callId, mode: pending.mode, query: pending.query, files: [] as string[], sources: [] as SearchWebSource[], total: 0, truncated: false, time }
  if (message.isError === true) return { ...base, error: errorOf(message) }
  // Session queries have no structured result metadata; record the query only.
  if (pending.mode === 'session_search' || pending.mode === 'session_event_search') return base
  const total = typeof meta.total === 'number' && Number.isFinite(meta.total) ? meta.total : undefined
  if (pending.mode === 'glob') {
    if (!Array.isArray(meta.paths)) return undefined
    const { paths, truncated } = uniquePaths(pending.cwd, meta.paths)
    return { ...base, files: paths, total: total ?? paths.length, truncated: meta.truncated === true || truncated }
  }
  if (pending.mode === 'grep') {
    if (meta.shape !== 'matches' || !Array.isArray(meta.files)) return undefined
    // Only file paths: grep hit lines stay in the session log, never in this view.
    const { paths, truncated } = uniquePaths(pending.cwd, meta.files.map(file => record(file).path))
    return { ...base, files: paths, total: total ?? paths.length, truncated: meta.truncated === true || truncated }
  }
  if (pending.mode === 'web_search') {
    if (!Array.isArray(meta.sources)) return undefined
    const { sources, total: sourceTotal, truncated } = uniqueSources(meta.sources)
    return { ...base, sources, total: sourceTotal, truncated: meta.truncated === true || truncated }
  }
  const opened = safeHttpUrl(meta.url)
  const status = meta.statusCode
  // A 404/500 response is a failed page, never an "opened page", even though the
  // tool returned normal content (its body is the error page).
  if (opened === undefined || typeof status !== 'number' || !Number.isFinite(status) || status < 200 || status > 299) return undefined
  // A content cut on a successful fetch is unrelated to the link itself.
  return { ...base, opened, total: 1, truncated: false }
}

/** Reuses the Host's replay, checkpoint and live notification machinery. */
export const searchProjection = {
  key: SEARCH_PROJECTION, stateVersion: 1,
  stateSchema: z.object({
    cwd: z.string(),
    pending: z.record(z.string(), z.object({ mode: z.enum(SEARCH_MODES), query: z.string().max(4000), cwd: z.string() })),
    view: viewSchema,
  }),
  init: (header: { cwd?: string }) => ({ cwd: header.cwd ?? '', pending: {}, view: { searches: [], truncated: false } }),
  apply(state, event) {
    const data = record(event.data)
    if (String(event.type) === 'working-directory/change' && typeof data.cwd === 'string') {
      // Search tools display relative hits against the call-time working directory.
      return { ...state, cwd: data.cwd }
    }
    if (event.type === 'tool/call' && isSearchMode(data.name) && typeof data.callId === 'string' && typeof data.arguments === 'string') {
      let args: Record<string, unknown>
      try { args = record(JSON.parse(data.arguments)) } catch { return state }
      const query = queryOf(data.name, args)
      if (query === undefined) return state
      return { ...state, pending: { ...state.pending, [data.callId]: { mode: data.name, query, cwd: state.cwd } } }
    }
    if (event.type === 'tool/result' && event.surfaceOp === 'append') {
      const message = record(data.message)
      const callId = record(message.source).callId
      if (typeof callId !== 'string' || !Object.hasOwn(state.pending, callId)) return state
      const pending = state.pending[callId]!
      const pendingNext = { ...state.pending }
      delete pendingNext[callId]
      // Replay must be deterministic: the session's own event time, never a wall clock.
      const time = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0
      const entry = entryOf(pending, callId, message, record(data.meta), time)
      if (entry === undefined) return { ...state, pending: pendingNext }
      const searches = [entry, ...state.view.searches].slice(0, SEARCH_LIMITS.searches)
      return {
        ...state,
        pending: pendingNext,
        view: { searches, truncated: state.view.truncated || state.view.searches.length >= SEARCH_LIMITS.searches },
      }
    }
    if (event.type === 'turn/end' && Object.keys(state.pending).length > 0) return { ...state, pending: {} }
    return state
  },
  wire: { viewSchema, view: (state: SearchState) => state.view },
} satisfies ProjectionDefinition<typeof SEARCH_PROJECTION>

export function registerSearchProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], inner => {
    if (typeof inner.sessionProjections.register === 'function') inner.sessionProjections.register(searchProjection)
  })
}
