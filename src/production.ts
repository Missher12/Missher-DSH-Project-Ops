/**
 * Structured production facts recorded with a delivery report.
 *
 * Pure module: it carries no Node import, so the document chain and the browser
 * bundle share one contract. Everything here is a **report**: recording a build,
 * a release or an install never proves the later stage, and an absent section
 * means "unknown", never "succeeded".
 */

/** Most entries one delivery may record. */
export const PRODUCTION_LIMIT = 40
/** Bound on a production entry name. */
export const PRODUCTION_NAME_LIMIT = 200
/** Bound on version/summary/environment/platform. */
export const PRODUCTION_TEXT_LIMIT = 300
/** Bound on a target path or link. */
export const PRODUCTION_TARGET_LIMIT = 2048
/** Bound on the recorded-at stamp. */
export const PRODUCTION_STAMP_LIMIT = 64

/** The four production stages this contract can record. */
export const PRODUCTION_KINDS = ['artifact', 'build', 'release', 'install'] as const
export type ProductionKind = typeof PRODUCTION_KINDS[number]

/** Outcome of one stage; absence means unknown, not success. */
export const PRODUCTION_OUTCOMES = ['succeeded', 'failed', 'unverified'] as const
export type ProductionOutcome = typeof PRODUCTION_OUTCOMES[number]

/** One recorded production fact. Every entry names its source and record time. */
export interface ProductionEntry {
  kind: ProductionKind
  name: string
  /** Workspace-relative path or an http(s) link; never an absolute path or another scheme. */
  target?: string
  version?: string
  summary?: string
  /** Who or what recorded it (person, command, tool). A session report, not host proof. */
  source: string
  /** When it was recorded: an ISO-8601 stamp or a bounded free-form stamp. */
  recordedAt: string
  /** Build/release/install outcome; absent stays unknown. */
  outcome?: ProductionOutcome
  /** Install only: the environment (for example a profile or machine name). */
  environment?: string
  /** Install only: the platform (for example linux-x64). */
  platform?: string
}

const ENTRY_FIELDS = ['kind', 'name', 'target', 'version', 'summary', 'source', 'recordedAt', 'outcome', 'environment', 'platform'] as const

/** What a caller actually passed, for a field-specific error. */
function received(value: unknown): string {
  if (value === undefined) return 'nothing (field absent)'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `a ${typeof value}`
}

function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}: expected a string, received ${received(value)}.`)
  if (!value.trim()) throw new Error(`Invalid ${label}: the string is empty.`)
  if (value.length > limit) throw new Error(`Invalid ${label}: ${value.length} characters exceeds the ${limit}-character limit.`)
  return value
}

function optionalText(value: unknown, label: string, limit: number): string | undefined {
  if (value === undefined) return undefined
  return text(value, label, limit)
}

/** Whether a target is an http(s) link without credentials. */
export function isExternalTarget(value: string): boolean {
  if (value.length === 0 || value.length > PRODUCTION_TARGET_LIMIT || /\s/u.test(value)) return false
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  // Credentials in a recorded link are never acceptable evidence.
  return url.username === '' && url.password === ''
}

/** Whether a target is a safe workspace-relative path. */
export function isWorkspaceRelativeTarget(value: string): boolean {
  if (value.length === 0 || value.length > PRODUCTION_TARGET_LIMIT) return false
  if (value.includes('\u0000') || value.includes('\\')) return false
  // Absolute POSIX paths and drive-letter paths are rejected, as is any scheme.
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value) || /^[a-z][a-z0-9+.-]*:/iu.test(value)) return false
  return value.split('/').every(segment => segment !== '..')
}

/**
 * Parse one entry, rejecting unknown fields and malformed targets.
 * @param value - untrusted entry.
 * @param index - position in the array, used in the error path.
 * @returns the validated entry.
 */
export function parseProductionEntry(value: unknown, index: number): ProductionEntry {
  const label = `production[${index}]`
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}: expected an object, received ${received(value)}.`)
  const row = value as Record<string, unknown>
  const unknown = Object.keys(row).filter(key => !(ENTRY_FIELDS as readonly string[]).includes(key))
  if (unknown.length > 0) throw new Error(`Unknown ${label} field(s): ${unknown.join(', ')}. Allowed fields: ${ENTRY_FIELDS.join(', ')}.`)
  const kind = row.kind
  if (!PRODUCTION_KINDS.includes(kind as ProductionKind)) throw new Error(`Invalid ${label}.kind: expected one of ${PRODUCTION_KINDS.join(', ')}.`)
  const outcome = row.outcome
  if (outcome !== undefined && !PRODUCTION_OUTCOMES.includes(outcome as ProductionOutcome)) throw new Error(`Invalid ${label}.outcome: expected one of ${PRODUCTION_OUTCOMES.join(', ')} or absent.`)
  const target = optionalText(row.target, `${label}.target`, PRODUCTION_TARGET_LIMIT)
  if (target !== undefined && !isExternalTarget(target) && !isWorkspaceRelativeTarget(target)) {
    throw new Error(`Invalid ${label}.target: expected an http(s) link without credentials or a workspace-relative path (no absolute paths, no "..", no other schemes).`)
  }
  const entry: ProductionEntry = {
    kind: kind as ProductionKind,
    name: text(row.name, `${label}.name`, PRODUCTION_NAME_LIMIT),
    source: text(row.source, `${label}.source`, PRODUCTION_TEXT_LIMIT),
    recordedAt: text(row.recordedAt, `${label}.recordedAt`, PRODUCTION_STAMP_LIMIT),
  }
  const version = optionalText(row.version, `${label}.version`, PRODUCTION_TEXT_LIMIT)
  const summary = optionalText(row.summary, `${label}.summary`, PRODUCTION_TEXT_LIMIT)
  const environment = optionalText(row.environment, `${label}.environment`, PRODUCTION_TEXT_LIMIT)
  const platform = optionalText(row.platform, `${label}.platform`, PRODUCTION_TEXT_LIMIT)
  if (target !== undefined) entry.target = target
  if (version !== undefined) entry.version = version
  if (summary !== undefined) entry.summary = summary
  if (outcome !== undefined) entry.outcome = outcome as ProductionOutcome
  if (environment !== undefined) entry.environment = environment
  if (platform !== undefined) entry.platform = platform
  return entry
}

/**
 * Parse the optional production array of a delivery report.
 * @param value - the `production` member, or `undefined` when absent.
 * @returns the entries, or `undefined` when the field is absent (unknown, not empty).
 */
export function parseProduction(value: unknown): ProductionEntry[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`Invalid production: expected an array of production entries, received ${received(value)}.`)
  if (value.length > PRODUCTION_LIMIT) throw new Error(`Invalid production: ${value.length} entries exceeds the ${PRODUCTION_LIMIT}-entry limit.`)
  return value.map((entry, index) => parseProductionEntry(entry, index))
}

/**
 * Read stored production entries for display without trusting them.
 * @param value - untrusted stored value.
 * @returns the valid entries and how many were rejected (never silently dropped).
 */
export function readProduction(value: unknown): { entries: ProductionEntry[]; rejected: number } {
  if (value === undefined) return { entries: [], rejected: 0 }
  if (!Array.isArray(value)) return { entries: [], rejected: 1 }
  const entries: ProductionEntry[] = []
  let rejected = 0
  for (const [index, entry] of value.slice(0, PRODUCTION_LIMIT).entries()) {
    try { entries.push(parseProductionEntry(entry, index)) } catch { rejected += 1 }
  }
  if (value.length > PRODUCTION_LIMIT) rejected += value.length - PRODUCTION_LIMIT
  return { entries, rejected }
}

/** One bounded human-readable line of a production entry. */
export function productionLine(entry: ProductionEntry): string {
  const details = [
    entry.version === undefined ? undefined : `v${entry.version}`,
    entry.outcome,
    entry.target,
    entry.summary,
    entry.environment === undefined ? undefined : `env=${entry.environment}`,
    entry.platform === undefined ? undefined : `platform=${entry.platform}`,
  ].filter((value): value is string => value !== undefined)
  return `- ${entry.kind} · ${entry.name}${details.length === 0 ? '' : ` · ${details.join(' · ')}`} · source=${entry.source} · ${entry.recordedAt}`
}
