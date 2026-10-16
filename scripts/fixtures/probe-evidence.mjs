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

/** Longest single nested-output block kept from a tool value. */
const MAX_BLOCK_TEXT = 240
/** How many recent call summaries stay in memory (never a full history). */
const RECENT_LIMIT = 6
/** How many job-id relations are kept for dispatch/collect pairing. */
const JOB_INDEX_LIMIT = 4

/**
 * Longest stderr kept: a bounded forensic budget rather than a claim about where
 * any particular failure was. The first Windows artifact was captured with a 240
 * character cap and arrived truncated, so the full text's length and the real
 * root cause's position are unknown; 1024 keeps substantially more context while
 * staying a small, bounded upload field. stdout keeps the smaller block size.
 */
const MAX_STDERR_TEXT = 1024

/** Scrubbed, capped text; anything that is not a non-empty string stays null. */
const boundedText = (value, limit = MAX_BLOCK_TEXT) =>
  typeof value === 'string' && value.trim().length > 0 ? scrubDiagnosticText(value, limit) : null

/**
 * One canonical Host stream as text: a bare string, or the `{ text }` shape the
 * Host's canonical shell result uses. Anything else — including the whole
 * object, its `spillPath` and its other metadata — is not text and stays null;
 * the object is never serialized into the upload.
 */
function streamText(value) {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof value.text === 'string') return value.text
  return null
}

/** Allowlisted execution-receipt facts; an absent receipt is null, never a zero. */
function receiptFacts(receipt) {
  if (receipt === null || typeof receipt !== 'object') return null
  return {
    outcome: typeof receipt.outcome === 'string' ? receipt.outcome : null,
    exitCode: Number.isFinite(receipt.exitCode) ? receipt.exitCode : null,
    executionMode: typeof receipt.executionMode === 'string' ? receipt.executionMode : null,
    executorTool: typeof receipt.executorTool === 'string' ? receipt.executorTool : null,
    jobId: typeof receipt.jobId === 'string' ? receipt.jobId : null,
    nestedCallId: typeof receipt.nestedCallId === 'string' ? receipt.nestedCallId : null,
  }
}

/** Native facts of one shell value: structured fields first, text bounded. */
function nativeFacts(value) {
  // `undefined` is a real state here: a native call that failed before returning
  // anything. Its facts are unknown, not absent, so they are reported as nulls.
  const unknown = value === undefined
  if (!unknown && (value === null || typeof value !== 'object')) return null
  const row = unknown ? {} : value
  const sandbox = row.sandbox !== null && typeof row.sandbox === 'object' ? row.sandbox : {}
  return {
    kind: typeof row.kind === 'string' ? row.kind : null,
    exitCode: Number.isFinite(row.exitCode) ? row.exitCode : null,
    signal: typeof row.signal === 'string' ? row.signal : null,
    timedOut: typeof row.timedOut === 'boolean' ? row.timedOut : null,
    aborted: typeof row.aborted === 'boolean' ? row.aborted : null,
    sandbox: {
      denied: typeof sandbox.denied === 'boolean' ? sandbox.denied : null,
      runnerFailed: typeof sandbox.runnerFailed === 'boolean' ? sandbox.runnerFailed : null,
    },
    stderr: boundedText(streamText(row.stderr), MAX_STDERR_TEXT),
    stdout: boundedText(streamText(row.stdout), MAX_BLOCK_TEXT),
  }
}

/**
 * Up to two text blocks of `value.nestedContent`, each scrubbed and capped.
 * The product's real shell/Jobs error text lives here — the outer tool content
 * is not a substitute.
 */
function nestedTexts(value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.nestedContent)) return null
  const texts = value.nestedContent
    .map(block => typeof block === 'string' ? block : typeof block?.text === 'string' ? block.text : null)
    .filter(entry => entry !== null)
    .slice(0, 2)
    .map(entry => scrubDiagnosticText(entry, MAX_BLOCK_TEXT))
  return texts.length === 0 ? null : texts
}

/**
 * Per-object key lists: a receipt must not acquire a `stderr`, an error must not
 * acquire an `exitCode`, and every nested object stays as small as its meaning.
 */
const PROJECTION_KEYS = {
  error: ['name', 'message', 'code', 'infoCode'],
  tool: ['ordinal', 'tool', 'callId', 'isError'],
  receipt: ['outcome', 'exitCode', 'executionMode', 'executorTool', 'jobId', 'nestedCallId'],
  // `stderr`/`stdout` are deliberately absent: they are free text with their own
  // caps, and the generic string projection would cut them back to 120.
  native: ['callId', 'parentCallId', 'kind', 'exitCode', 'signal', 'timedOut', 'aborted'],
  dispatch: ['ordinal', 'callId'],
}

/** Project one flat object onto one explicit short key list; unknown fields are dropped. */
function pickScalars(source, keys) {
  const row = source !== null && typeof source === 'object' ? source : null
  if (row === null) return null
  const out = {}
  for (const key of keys) {
    const item = row[key]
    if (item === undefined || item === null) out[key] = null
    else if (typeof item === 'boolean') out[key] = item
    else if (typeof item === 'number') out[key] = Number.isFinite(item) ? item : null
    else if (typeof item === 'string') out[key] = scrubDiagnosticText(item)
    else out[key] = null
  }
  return out
}

/** Sandbox flags survive as unknown (`null`) rather than as `false`. */
function pickSandbox(source) {
  const row = source !== null && typeof source === 'object' ? source : null
  if (row === null) return null
  return {
    denied: typeof row.denied === 'boolean' ? row.denied : null,
    runnerFailed: typeof row.runnerFailed === 'boolean' ? row.runnerFailed : null,
  }
}

/** Native half of the snapshot: shell identity plus its bounded output. */
function pickNative(source) {
  const row = pickScalars(source, PROJECTION_KEYS.native)
  if (row === null) return null
  // Scrubbing is idempotent and the caps match the recorder's, so projecting an
  // already-projected snapshot (driver pass, then upload pass) is stable.
  return { callId: row.callId, parentCallId: row.parentCallId, kind: row.kind, exitCode: row.exitCode,
    signal: row.signal, timedOut: row.timedOut, aborted: row.aborted, sandbox: pickSandbox(source?.sandbox),
    // Same normalization as the recorder, so a snapshot written by an older
    // fixture (object streams, no text normalization) still projects to text
    // instead of silently becoming null; the object itself is never serialized.
    stderr: boundedText(streamText(source?.stderr), MAX_STDERR_TEXT),
    stdout: boundedText(streamText(source?.stdout), MAX_BLOCK_TEXT) }
}

/**
 * Project the frozen business failure onto the upload allowlist.
 *
 * Every branch is explicit and stable under a second application: the smoke
 * driver projects the fixture summary once, and the upload document projects it
 * again, so a lossy or non-idempotent branch would silently drop the evidence
 * that is the whole point of this snapshot.
 */
function pickBusinessFailure(source) {
  if (source === null || typeof source !== 'object') return null
  const tool = source.tool === null || source.tool === undefined ? null : pickScalars(source.tool, PROJECTION_KEYS.tool)
  const dispatchSource = source.dispatch === null || source.dispatch === undefined ? null : source.dispatch
  const dispatchHead = dispatchSource === null ? null : pickScalars(dispatchSource, PROJECTION_KEYS.dispatch)
  const dispatch = dispatchSource === null ? null : {
    ordinal: dispatchHead.ordinal,
    callId: dispatchHead.callId,
    receipt: dispatchSource.receipt == null ? null : pickScalars(dispatchSource.receipt, PROJECTION_KEYS.receipt),
  }
  return {
    stage: typeof source.stage === 'string' ? scrubDiagnosticText(source.stage) : null,
    error: source.error == null ? null : pickScalars(source.error, PROJECTION_KEYS.error),
    tool: tool === null ? null : { ordinal: tool.ordinal, tool: tool.tool, callId: tool.callId,
      isError: tool.isError, error: source.tool.error == null ? null : pickScalars(source.tool.error, PROJECTION_KEYS.error) },
    receipt: source.receipt == null ? null : pickScalars(source.receipt, PROJECTION_KEYS.receipt),
    native: pickNative(source.native),
    value: pickNative(source.value),
    nestedContent: Array.isArray(source.nestedContent)
      ? source.nestedContent.slice(0, 2).map(entry => scrubDiagnosticText(entry, MAX_BLOCK_TEXT))
      : null,
    dispatch,
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
    businessFailure: pickBusinessFailure(record.businessFailure),
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
    // The frozen business snapshot is NOT duplicated here: the driver attributes
    // it to the phase it belongs to (`installed`/`removed`), so a second
    // top-level copy would have no consumer and could disagree with that one.
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
  // Bounded, in-memory only: the current business stage, the last few calls of
  // each layer, and the job-id pairs a promoted dispatch/collect is made of.
  let businessStage = null
  let frozenFailure = null
  const recentTools = []
  const recentNatives = []
  const jobIndex = new Map()
  const remember = (list, entry) => { list.push(entry); while (list.length > RECENT_LIMIT) list.shift() }
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
      const staged = { ...details, stage: businessStage }
      record(`${layer}-call`, staged)
      let result
      try { result = await invoke() }
      catch (error) {
        // The original failure is rethrown untouched: a diagnostic write that
        // fails here must not become the error the caller sees. The failed call
        // is still remembered, so a freeze inside this stage points at it rather
        // than at an earlier successful call or at nothing.
        guarded(`remember failed ${layer} call`, () => {
          const summary = {
            stage: businessStage,
            ordinal: Number.isInteger(details.ordinal) ? details.ordinal : null,
            tool: typeof details.tool === 'string' ? details.tool : null,
            callId: typeof details.callId === 'string' ? details.callId : null,
            parentCallId: typeof details.parentCallId === 'string' ? details.parentCallId : null,
            // No result exists, so every fact about it stays unknown.
            isError: null,
            error: errorSummary(error),
            receipt: null,
            value: null,
            nestedContent: null,
            native: layer === 'native' ? nativeFacts(undefined) : null,
            dispatch: null,
            threw: true,
          }
          if (layer === 'native') remember(recentNatives, summary)
          else remember(recentTools, summary)
        })
        record(`${layer}-error`, { ...staged, returned: returnedSummary(undefined), error: errorSummary(error) })
        throw error
      }
      const value = layer === 'tool' ? object(result).value : result
      // The record's argument object is built eagerly, so the construction itself
      // belongs inside the guard: a value accessor that throws is a diagnostic
      // failure, not a new outcome for the call that just returned.
      guarded(`record ${layer} return`, () => record(`${layer}-return`, { ...staged, returned: returnedSummary(value),
        isError: field(result, 'isError'), error: result?.error ? errorSummary(result.error) : unavailable,
        concludesTurn: field(result, 'concludesTurn'),
        additionalContexts: Array.isArray(result?.additionalContexts) ? { count: result.additionalContexts.length,
          first: result.additionalContexts.slice(0, 4).map(row => ({ role: field(row, 'role'),
            sourceKind: field(row.source, 'kind'), plugin: field(row.source, 'plugin'),
            content: Array.isArray(row.content) ? row.content.slice(0, 4).map(block => text(block.text)) : unavailable })) } : unavailable,
        content: Array.isArray(result?.content) ? result.content.slice(0, 4).map(block => text(block.text)) : unavailable }))
      // One guard around the entire summary path: extracting diagnostic facts
      // reads tool-provided values (including accessors), so a diagnostic
      // failure must never change the returned result or replace a thrown error.
      guarded(`remember ${layer} call`, () => {
        const summary = {
          stage: businessStage,
          ordinal: Number.isInteger(details.ordinal) ? details.ordinal : null,
          tool: typeof details.tool === 'string' ? details.tool : null,
          callId: typeof details.callId === 'string' ? details.callId : null,
          parentCallId: typeof details.parentCallId === 'string' ? details.parentCallId : null,
          // Only a real boolean is a fact; a missing flag is unknown, not `false`.
          isError: typeof result?.isError === 'boolean' ? result.isError : null,
          error: layer === 'tool' && result?.error ? errorSummary(result.error) : null,
          receipt: layer === 'tool' ? receiptFacts(object(value).receipt) : null,
          value: layer === 'tool' ? nativeFacts(value) : null,
          nestedContent: layer === 'tool' ? nestedTexts(value) : null,
          native: layer === 'native' ? nativeFacts(value) : null,
          dispatch: null,
        }
        if (layer === 'native') {
          remember(recentNatives, summary)
          return
        }
        // A promoted dispatch and its collect share one job id; keep the pair so
        // the frozen failure can show both without reaching for older calls.
        const receipt = summary.receipt
        if (receipt !== null && receipt.jobId !== null) {
          const prior = jobIndex.get(receipt.jobId)
          if (receipt.outcome === 'running' && prior === undefined) {
            jobIndex.set(receipt.jobId, summary)
            while (jobIndex.size > JOB_INDEX_LIMIT) jobIndex.delete(jobIndex.keys().next().value)
          } else if (prior !== undefined && receipt.outcome !== 'running'
            && prior.stage === businessStage
            && prior.receipt.nestedCallId !== null && prior.receipt.nestedCallId === receipt.nestedCallId) {
            // Same job id is not enough: a reused id without the same nested call
            // id is not this collect's dispatch, and a pair across business
            // stages would attach an unrelated native launch to the failure.
            summary.dispatch = prior
          }
        }
        remember(recentTools, summary)
      })
      return result
    },
    /** Fix the business stage the next calls belong to (a check name of the fixture). */
    setBusinessStage(stage) { businessStage = typeof stage === 'string' && stage.length > 0 ? stage : null },
    /**
     * Freeze the failing business context before any cleanup runs.
     *
     * Only calls stamped with the failing stage are eligible, so an older
     * success, an expected policy deny or a stranger-owner rejection can never
     * fill in the current failure; a missing relation stays null. The first
     * business failure wins, and a snapshot problem never replaces the original
     * error object.
     */
    freezeBusinessFailure(error) {
      if (frozenFailure !== null) return frozenFailure
      try {
        const related = recentTools.filter(row => row.stage === businessStage)
        const primary = related.length === 0 ? null : related[related.length - 1]
        // A collected call's native launch belongs to its dispatch, not to the
        // collect; without a paired dispatch the primary's own call is used.
        const nativeOwner = primary === null ? null : primary.dispatch ?? primary
        const native = nativeOwner === null ? null
          : recentNatives.filter(row => row.stage === businessStage && row.parentCallId === nativeOwner.callId).at(-1) ?? null
        frozenFailure = {
          stage: businessStage,
          error: errorSummary(error),
          tool: primary === null ? null : { ordinal: primary.ordinal, tool: primary.tool, callId: primary.callId,
            isError: primary.isError, error: primary.error },
          receipt: primary === null ? null : primary.receipt,
          native: native === null ? null : { callId: native.callId, parentCallId: native.parentCallId, ...native.native },
          value: primary === null ? null : primary.value,
          nestedContent: primary === null ? null : primary.nestedContent,
          dispatch: primary?.dispatch === null || primary?.dispatch === undefined ? null
            : { ordinal: primary.dispatch.ordinal, callId: primary.dispatch.callId, receipt: primary.dispatch.receipt },
        }
      } catch (snapshotError) {
        // Recording a failure must never masquerade as the failure.
        diagnosticFailures.push(`freeze business failure: ${snapshotError instanceof Error ? snapshotError.message : String(snapshotError)}`)
      }
      return frozenFailure
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
        // The frozen business context travels with the summary, so the uploaded
        // projection can name the stage and the calls that actually failed.
        ...frozenFailure === null ? {} : { businessFailure: frozenFailure },
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
