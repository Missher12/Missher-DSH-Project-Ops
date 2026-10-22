/**
 * Read-only browser hints for one workspace document pair.
 *
 * Hash linkage is freshness evidence, not delivery acceptance. A PLAN that
 * carries no valid Project Ops record is not an error: it is a plain record the
 * human has to check, and this module says so instead of inventing a status.
 */

/** Freshness of the delivery record against the current plan revision. */
export type DeliveryState = 'current' | 'historical' | 'inspect' | 'missing'

/** Bounded evidence read from one PLAN/READY pair. */
export interface DocumentStatus {
  /** Managed freshness, or the plain-record fallback when no record decoded. */
  delivery: DeliveryState
  /** Title from the managed record, when the PLAN carried valid metadata. */
  title?: string
  /** The PLAN decoded to a valid Project Ops record bound to this task identity. */
  managed: boolean
  /** Artifact strings recorded by a licensed delivery report, bounded for display. */
  artifacts: readonly string[]
  /** At least one artifact summary was cut; the full record is in READY. */
  artifactsTruncated?: boolean
  /** The verification sentence recorded with the delivery, bounded for display. */
  verification?: string
  /** The verification sentence was cut; the full record is in READY. */
  verificationTruncated?: boolean
  /** A metadata header was present but did not validate: this is not a managed record. */
  damaged?: boolean
}

/** Limits applied to metadata before it reaches the panel. */
const MAX_ARTIFACTS = 5
const MAX_FIELD = 300
const MAX_DOCUMENT = 128 * 1024

/** One bounded, display-safe string from the report, with the cut recorded. */
function bounded(value: unknown): { text: string, cut: boolean } | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0) return undefined
  return { text: text.slice(0, MAX_FIELD), cut: text.length > MAX_FIELD }
}

/**
 * Derive the panel's status for one document pair.
 * @param id - task identity the PLAN metadata must claim (directory name, or '.' for the workspace root).
 * @param plan - PLAN.md text, when readable.
 * @param ready - READY.md text, when readable.
 * @returns managed freshness when a record decoded, otherwise a plain-record state.
 */
export async function documentStatus(id: string, plan: string | undefined, ready: string | undefined): Promise<DocumentStatus> {
  const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
  /** A plain record: visible, read-only, and flagged for the human to check. */
  const plain: DocumentStatus = { delivery: ready !== undefined ? 'inspect' : 'missing', managed: false, artifacts: [] }
  /** A metadata header existed but did not validate: damaged, so it needs review. */
  const damaged: DocumentStatus = { delivery: 'inspect', managed: false, artifacts: [], damaged: true }
  try {
    if (!plan) return plain
    if (new TextEncoder().encode(plan).length > MAX_DOCUMENT) return damaged
    const match = /^\[project-ops-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>\n\n/u.exec(plan)
    // A header that is present but not at the start means the document was moved
    // or edited by hand: report damage instead of silently treating it as plain.
    if (!match) return plan.includes('[project-ops-v1]:') ? damaged : plain
    /** The decoded envelope; every member is untrusted until narrowed below. */
    const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(match[1]!), c => c.charCodeAt(0)))) as {
      bodyHash?: unknown
      record?: {
        format?: unknown
        taskId?: unknown
        plan?: { title?: unknown }
        delivery?: unknown
        previousReadyHash?: string
      }
    }
    const record = metadata.record
    if (record?.format !== 1 || record.taskId !== id || typeof record.plan?.title !== 'string' || record.plan.title.length > 16000 || metadata.bodyHash !== await hash(plan.slice(match[0].length))) return damaged
    const title = record.plan.title
    /** The delivery half of the record, narrowed before any member is read. */
    const delivery: { readyHash?: unknown, verification?: unknown, report?: unknown } | undefined =
      record.delivery !== null && typeof record.delivery === 'object' ? record.delivery as { readyHash?: unknown, verification?: unknown, report?: unknown } : undefined
    /** Report artifacts, narrowed to a real array of unknown before mapping. */
    const reportValue: unknown = delivery === undefined ? undefined : delivery.report
    const artifactValues: unknown = reportValue !== null && typeof reportValue === 'object'
      ? (reportValue as { artifacts?: unknown }).artifacts
      : undefined
    const summaries = Array.isArray(artifactValues)
      ? (artifactValues as unknown[]).map((value: unknown) => bounded(value)).filter((summary): summary is { text: string, cut: boolean } => summary !== undefined)
      : []
    const kept = summaries.slice(0, MAX_ARTIFACTS)
    const managed: DocumentStatus = {
      title, managed: true, artifacts: kept.map(summary => summary.text),
      delivery: ready === undefined ? (delivery !== undefined ? 'inspect' : 'missing') : 'inspect',
    }
    if (kept.some(summary => summary.cut) || summaries.length > MAX_ARTIFACTS) managed.artifactsTruncated = true
    const verification = bounded(delivery?.verification)
    if (verification !== undefined) {
      managed.verification = verification.text
      if (verification.cut) managed.verificationTruncated = true
    }
    if (ready === undefined) return managed
    if (new TextEncoder().encode(ready).length > MAX_DOCUMENT) return managed
    const readyHash = await hash(ready)
    managed.delivery = delivery?.readyHash === readyHash ? 'current' : delivery === undefined && record.previousReadyHash === readyHash ? 'historical' : 'inspect'
    return managed
  } catch { return damaged }
}

/**
 * First Markdown heading of a plain document, bounded for use as a display title.
 * Never invents a title: returns `undefined` when the document has none.
 * @param text - document body.
 * @returns the heading text, or `undefined`.
 */
export function headingTitle(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const match = /^#{1,3}\s+(.+)$/mu.exec(text)
  const title = match?.[1]?.trim()
  return title === undefined || title.length === 0 ? undefined : title.slice(0, 200)
}
