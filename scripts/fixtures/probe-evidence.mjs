// Source-side Profile diagnostics only; never included in the plugin archive.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const unavailable = 'unavailable'
const text = value => typeof value === 'string' ? value.slice(0, 2048) : unavailable
const object = value => value !== null && typeof value === 'object' ? value : {}
const field = (value, key) => {
  const item = object(value)[key]
  return typeof item === 'string' ? text(item) : item === null || ['boolean', 'number'].includes(typeof item) ? item : unavailable
}
const errorSummary = error => ({ name: text(error?.name), message: text(error?.message ?? String(error)),
  code: field(error, 'code'), infoCode: field(error?.info, 'code'), stack: text(error?.stack) })

function returnedSummary(value) {
  const row = object(value)
  return { exitCode: field(row, 'exitCode'), signal: field(row, 'signal'), timedOut: field(row, 'timedOut'),
    workdir: field(row, 'workdir'), cwd: field(row, 'cwd'), aborted: field(row, 'aborted'),
    stdout: text(row.stdout), stderr: text(row.stderr), output: text(row.output),
    kind: field(row, 'kind'), verdict: field(row, 'verdict'), jobId: field(row, 'jobId'),
    sourceSnapshot: field(row, 'sourceSnapshot'), foreground: field(row, 'foreground'), planDigest: field(row, 'planDigest'),
    tasks: Array.isArray(row.tasks) ? { count: row.tasks.length, firstIds: row.tasks.slice(0, 20).map(task => field(task, 'id')) } : unavailable,
    sandbox: { runnerFailed: field(row.sandbox, 'runnerFailed'), denied: field(row.sandbox, 'denied') },
    receipt: { outcome: field(row.receipt, 'outcome'), exitCode: field(row.receipt, 'exitCode'),
      taskId: field(row.receipt, 'taskId'), nestedCallId: field(row.receipt, 'nestedCallId') } }
}

/**
 * Bounded, scrubbed projection of a probe result for CI upload.
 *
 * Every uploaded string goes through the same scrubber before it is truncated —
 * in that order, so a cap can never leave the head of a secret behind. Unknown
 * values stay `null`: an absent exit code is not a zero and an unknown timeout
 * is not `false`. This is a bounded projection, not a guarantee that any
 * possible secret is recognised, which is why free text is kept as short as it
 * is useful.
 */

/** Longest free-text field kept for the upload. */
const MAX_FREE_TEXT = 240
/** Longest structured string (names, phases, codes, labels). */
const MAX_STRING = 120
/** Longest credential-shaped or path-shaped replacement sweep is applied to. */
const MAX_SCAN = 4096

/**
 * Replace credential-shaped and machine-local fragments, then cap the length.
 * @param input - any value; stringified for scrubbing.
 * @param limit - cap applied after scrubbing.
 * @returns the scrubbed, capped string.
 */
export function scrubDiagnosticText(input, limit = MAX_STRING) {
  const text = String(input).slice(0, MAX_SCAN)
  return text
    // Authorization headers first, as a whole: matching just the scheme word
    // ("Authorization: Bearer") would leave the token itself in place.
    .replace(/(?:"|')?authorization(?:"|')?\s*[:=]\s*(?:"|')?(?:bearer|basic|token)?\s*[^\s,;"'}]+/giu, '[redacted]')
    // A bare scheme + token anywhere else.
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/giu, '[redacted]')
    // Generic key/value secrets, quoted or bare, in JSON or plain text.
    .replace(/(?:"|')?(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|credential)(?:"|')?\s*[:=]\s*(?:"|')?[^\s,;"'}]+/giu, '[redacted]')
    // Credentials embedded in URLs, and token-like query parameters.
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, '$1[redacted]@')
    .replace(/([?&](?:token|key|secret|signature|sig|access_token|api_key)=)[^&#\s"']+/giu, '$1[redacted]')
    // Windows drive paths, including segments that contain spaces, replaced whole
    // so no tail of the original location survives.
    .replace(/[A-Za-z]:\\(?:[^\\\r\n"'<>|,;]*\\)*[^\\\r\n"'<>|,;\s]*/gu, '[path]')
    // Unix locations, same treatment.
    .replace(/\/(?:home|Users|root|tmp|var|private|opt|mnt|media)\/(?:[^/\r\n"'<>|,;]*\/)*[^/\r\n"'<>|,;\s]*/gu, '[path]')
    .slice(0, limit)
}

/** Bounded, scrubbed identity of the runtime a run used. */
export function scrubRuntime(runtime) {
  const row = runtime !== null && typeof runtime === 'object' ? runtime : {}
  const source = row.source !== null && typeof row.source === 'object' ? row.source : {}
  const archive = row.archive !== null && typeof row.archive === 'object' ? row.archive : {}
  const version = value => typeof value === 'string' && /^[0-9][0-9A-Za-z.+-]{0,63}$/u.test(value) ? value : null
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null
  return {
    source: { kind: typeof source.kind === 'string' ? scrubDiagnosticText(source.kind) : null,
      // A caller-supplied label is untrusted input and is scrubbed like any other string.
      label: source.label === undefined || source.label === null ? null : scrubDiagnosticText(source.label) },
    sdkVersion: version(row.sdkVersion),
    archive: { name: typeof archive.name === 'string' ? scrubDiagnosticText(archive.name) : null,
      version: version(archive.version), sha256: digest(archive.sha256),
      bytes: typeof archive.bytes === 'number' && Number.isFinite(archive.bytes) ? archive.bytes : null },
  }
}

/** Project one probe result or command record onto the upload allowlist. */
export function diagnosticProjection(value) {
  const pick = (source, keys) => {
    const row = source !== null && typeof source === 'object' ? source : {}
    const out = {}
    for (const key of keys) {
      const item = row[key]
      if (item === undefined || item === null) out[key] = null
      else if (typeof item === 'boolean') out[key] = item
      else if (typeof item === 'number') out[key] = Number.isFinite(item) ? item : null
      else if (typeof item === 'string') out[key] = scrubDiagnosticText(item)
      else if (Array.isArray(item)) out[key] = item.slice(0, 12).map(entry => typeof entry === 'string' ? scrubDiagnosticText(entry) : null)
      else out[key] = null
    }
    return out
  }
  const record = value !== null && typeof value === 'object' ? value : {}
  return {
    ...pick(record, ['passed', 'attemptDirectory', 'phase', 'ordinal', 'cleanupError', 'cleanupErrors', 'diagnosticFailures']),
    error: record.error === undefined || record.error === null ? null
      : pick(record.error, ['name', 'message', 'code', 'infoCode']),
    returned: record.returned === undefined || record.returned === null ? null
      : pick(record.returned, ['exitCode', 'signal', 'timedOut', 'kind', 'verdict', 'stdout', 'stderr', 'output']),
  }
}

/**
 * The exact document CI uploads, for both outcomes.
 *
 * Everything here has been projected or scrubbed individually: no caller label,
 * phase, cleanup message or free text reaches the artifact unscrubbed, and free
 * text is capped small.
 * @param input - the run outcome and its already-collected summaries.
 * @returns the upload document.
 */
export function ciDiagnosticDocument(input) {
  const row = input !== null && typeof input === 'object' ? input : {}
  const passed = row.passed === true
  return {
    passed,
    phase: typeof row.phase === 'string' ? scrubDiagnosticText(row.phase) : null,
    platform: { node: typeof row.platform?.node === 'string' ? scrubDiagnosticText(row.platform.node) : null,
      os: typeof row.platform?.os === 'string' ? scrubDiagnosticText(row.platform.os) : null,
      arch: typeof row.platform?.arch === 'string' ? scrubDiagnosticText(row.platform.arch) : null },
    selectedRuntime: scrubRuntime(row.selectedRuntime),
    fixtureEvidence: typeof row.fixtureEvidence === 'string' ? scrubDiagnosticText(row.fixtureEvidence) : null,
    installed: row.installed === undefined || row.installed === null ? null : diagnosticProjection(row.installed),
    removed: row.removed === undefined || row.removed === null ? null : diagnosticProjection(row.removed),
    firstError: row.firstError === undefined || row.firstError === null ? null
      : { message: scrubDiagnosticText(row.firstError.message ?? String(row.firstError), MAX_FREE_TEXT) },
    cleanupError: row.cleanupError === undefined || row.cleanupError === null ? null
      : scrubDiagnosticText(row.cleanupError, MAX_FREE_TEXT),
    // Cleanup problems are listed separately from the first error, never merged
    // into it.
    cleanupErrors: Array.isArray(row.cleanupErrors)
      ? row.cleanupErrors.slice(0, 6).map(entry => scrubDiagnosticText(entry, MAX_FREE_TEXT))
      : [],
    diagnosticFailures: Array.isArray(row.diagnosticFailures)
      ? row.diagnosticFailures.slice(0, 6).map(entry => scrubDiagnosticText(entry))
      : [],
  }
}

/**
 * Run cleanup steps in order, each guarded on its own.
 *
 * Every step runs even when an earlier one throws, and each failure is reported
 * through `onError` (or collected when no reporter is given) instead of being
 * thrown: the run's own error must stay the one the caller sees.
 * @param steps - `[label, step]` pairs, executed in order.
 * @param onError - optional reporter per failed step.
 * @returns the collected failure labels and messages.
 */
export async function runGuardedCleanup(steps, onError) {
  const errors = []
  for (const [label, step] of steps) {
    try {
      await step()
    } catch (error) {
      const message = `${label}: ${error instanceof Error ? error.message : String(error)}`
      errors.push(message)
      if (typeof onError === 'function') onError(label, error)
    }
  }
  return errors
}

/**
 * Settle one fixture run: business result, business failure, cleanup failure.
 *
 * A `return` inside the guarded `try` would bypass any check made afterwards, so
 * the fixture stores its result and settles here instead. The business failure
 * always wins; a cleanup failure with no business failure still fails the run.
 * @param result - the success value, or `undefined` when the run failed.
 * @param failure - the first business exception, if any.
 * @param cleanupErrors - failures collected from the cleanup steps.
 * @returns the success value when nothing failed.
 */
export function settleRun(result, failure, cleanupErrors) {
  if (failure !== undefined) throw failure
  if (Array.isArray(cleanupErrors) && cleanupErrors.length > 0) {
    throw new Error(`fixture cleanup failed after a successful run: ${cleanupErrors.join('; ')}`)
  }
  return result
}

/**
 * Save each invocation before its caller can assert on the result; retain errors
 * without changing them.
 *
 * Diagnostic writes are guarded: if a record cannot be written, the failure is
 * collected (and later reported as a diagnostic failure) but never replaces the
 * probe result or the error the caller is about to see. Cleanup failures are
 * collected separately from the run's own error.
 */
export function createProbeEvidence(config) {
  const parent = join(dirname(config.report), 'attempts')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(join(parent, config.removed ? 'removed-' : 'installed-'))
  let sequence = 0
  const diagnosticFailures = []
  const cleanupErrors = []
  const guarded = (label, write) => {
    try { write(); return true } catch (error) {
      diagnosticFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
  const save = (filename, value) => guarded(`write ${filename}`,
    () => writeFileSync(join(directory, filename), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }))
  const record = (kind, value) => save(`${String(sequence++).padStart(4, '0')}-${kind}.json`,
    { kind, recordedAt: new Date().toISOString(), ...value })
  record('start', { runtime: { node: process.version, executable: process.execPath,
    platform: process.platform, arch: process.arch, processCwd: process.cwd() },
    sessionWorkspace: config.workspace ?? unavailable, selectedHost: config.hostEvidence ?? unavailable,
    nativeProcessRuntime: unavailable, intendedSummary: config.report })
  return {
    directory, record, diagnosticFailures, cleanupErrors,
    recordError(kind, error) { record(kind, { error: errorSummary(error) }) },
    /** Record one bounded diagnostic failure without disturbing the run's own error. */
    noteDiagnosticFailure(message) { guarded('note', () => { diagnosticFailures.push(String(message)) }) },
    /** Record one cleanup failure beside the run's own error (never instead of it). */
    noteCleanupError(label, error) {
      cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    },
    async observe(layer, details, invoke) {
      record(`${layer}-call`, details)
      let result
      try { result = await invoke() }
      catch (error) {
        // The original failure is rethrown untouched: a diagnostic write that
        // fails here must not become the error the caller sees.
        record(`${layer}-error`, { ...details, returned: returnedSummary(undefined), error: errorSummary(error) })
        throw error
      }
      const value = layer === 'tool' ? object(result).value : result
      record(`${layer}-return`, { ...details, returned: returnedSummary(value),
        isError: field(result, 'isError'), error: result?.error ? errorSummary(result.error) : unavailable,
        concludesTurn: field(result, 'concludesTurn'),
        additionalContexts: Array.isArray(result?.additionalContexts) ? { count: result.additionalContexts.length,
          first: result.additionalContexts.slice(0, 4).map(row => ({ role: field(row, 'role'),
            sourceKind: field(row.source, 'kind'), plugin: field(row.source, 'plugin'),
            content: Array.isArray(row.content) ? row.content.slice(0, 4).map(block => text(block.text)) : unavailable })) } : unavailable,
        content: Array.isArray(result?.content) ? result.content.slice(0, 4).map(block => text(block.text)) : unavailable })
      return result
    },
    async run(invoke) {
      let result
      try { result = await invoke(this) }
      catch (error) {
        // The probe's own failure becomes the report's error field, unchanged;
        // a diagnostic write problem is recorded separately and never replaces it.
        record('probe-error', { error: errorSummary(error) })
        result = { passed: false, error: errorSummary(error) }
      }
      const report = { ...result, attemptDirectory: directory,
        ...diagnosticFailures.length === 0 ? {} : { diagnosticFailures: [...diagnosticFailures] },
        ...cleanupErrors.length === 0 ? {} : { cleanupErrors: [...cleanupErrors] } }
      save('result.json', report)
      guarded('write summary', () => {
        try { writeFileSync(config.report, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }) }
        catch (error) {
          // The first summary belongs to the first attempt; later attempts keep their own result.json.
          if (error.code !== 'EEXIST') throw error
        }
      })
      return report
    },
  }
}
