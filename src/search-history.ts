/**
 * Browser-safe view of the native search results Project Ops records.
 *
 * Only structured tool metadata is stored: glob `meta.paths`, grep
 * `meta.files[].path`, web_search `meta.sources[]` (title/url) and a successful
 * web_fetch `meta.url`. Hit lines, snippets and page bodies never leave the
 * event log, and free text is never parsed back into files.
 */

/** Projection key registered beside the delivered-files projection. */
export const SEARCH_PROJECTION = 'missherProjectOpsSearch'

/** The native tools whose structured result metadata is recorded. */
export const SEARCH_MODES = ['glob', 'grep', 'web_search', 'web_fetch', 'session_search', 'session_event_search'] as const
export type SearchMode = typeof SEARCH_MODES[number]

/** One web source: a title and an http(s) link. */
export interface SearchWebSource {
  title: string
  url: string
}

/** One tool call's search history entry. */
export interface SearchEntry {
  callId: string
  mode: SearchMode
  /** The query text: glob/grep pattern, web search queries, or fetched URL. */
  query: string
  /** Deduplicated absolute local paths (grep stores paths only, never lines). */
  files: string[]
  /** Deduplicated http(s) sources. */
  sources: SearchWebSource[]
  /** A successfully opened page URL, for web_fetch. */
  opened?: string | undefined
  /** The Host's own total result count when it reports one, else what was retained. */
  total: number
  truncated: boolean
  /** Failure detail for a failed call; a failed call never yields hits. */
  error?: string | undefined
  time: number
}

export interface SearchHistory {
  searches: SearchEntry[]
  truncated: boolean
}

export interface SearchResult extends SearchHistory {
  unavailable?: boolean
}

/** Bounded retention: search history never crowds out delivered files. */
export const SEARCH_LIMITS = { searches: 50, files: 100, sources: 50, error: 300 } as const

/** Whether a value names one of the recorded search modes. */
export function isSearchMode(value: unknown): value is SearchMode {
  return typeof value === 'string' && (SEARCH_MODES as readonly string[]).includes(value)
}

/** An http(s) URL, or undefined for every other scheme and malformed value. */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

const validText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)

function isSource(value: unknown): value is SearchWebSource {
  if (typeof value !== 'object' || value === null) return false
  const source = value as SearchWebSource
  return validText(source.title, 1000) && safeHttpUrl(source.url) !== undefined
}

function isEntry(value: unknown): value is SearchEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as SearchEntry
  return typeof entry.callId === 'string' && entry.callId.length <= 200
    && isSearchMode(entry.mode)
    && validText(entry.query, 4000)
    && Array.isArray(entry.files) && entry.files.length <= SEARCH_LIMITS.files && entry.files.every(path => validText(path, 4096))
    && Array.isArray(entry.sources) && entry.sources.length <= SEARCH_LIMITS.sources && entry.sources.every(isSource)
    && (entry.opened === undefined || safeHttpUrl(entry.opened) !== undefined)
    && typeof entry.total === 'number' && Number.isFinite(entry.total)
    && typeof entry.truncated === 'boolean'
    && (entry.error === undefined || validText(entry.error, SEARCH_LIMITS.error))
    && typeof entry.time === 'number' && Number.isFinite(entry.time)
}

/** Missing or incompatible search projections are unavailable, not an empty history. */
export function isSearchHistory(value: unknown): value is SearchHistory {
  if (typeof value !== 'object' || value === null) return false
  const history = value as SearchHistory
  return typeof history.truncated === 'boolean'
    && Array.isArray(history.searches)
    && history.searches.length <= SEARCH_LIMITS.searches
    && history.searches.every(isEntry)
}
