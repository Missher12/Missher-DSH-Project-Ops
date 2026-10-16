// Driver-side diagnostics shared by the profile smoke run and its tests. This is
// the code path the driver actually executes: command facts, phase-scoped
// fixture evidence, and the one upload document used for both outcomes.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ciDiagnosticDocument, diagnosticProjection } from './probe-evidence.mjs'

/** Phase → which fixture summary may be read, or `null` before any probe runs. */
export function phaseKind(phase) {
  if (phase === 'probe-removed' || phase === 'remove-plugin') return 'removed'
  if (phase === 'probe-installed') return 'installed'
  return null
}

/** Render one fact without turning an unknown into a zero or a false. */
function fact(value) {
  return value === undefined || value === null ? 'unknown' : String(value)
}

/** One line of driver context; always available, even when no fixture report exists. */
export function driverContext(facts) {
  if (facts === null || facts === undefined) return 'driver: no command facts recorded'
  const spawn = facts.spawnError === null || facts.spawnError === undefined
    ? ''
    : ` spawnError=${facts.spawnError.code ?? 'unknown'}`
  return `driver@${fact(facts.phase)} cmd#${fact(facts.ordinal)}: exitCode=${fact(facts.processExitCode)}`
    + ` signal=${fact(facts.processSignal)} timedOut=${fact(facts.timedOut)}${spawn}`
}

/**
 * Phase-scoped fixture evidence for the phase that just ran.
 *
 * Only a boot phase may read one, and only from its own summary and its own
 * attempt prefix; a removal failure can therefore never be answered with the
 * earlier successful install report. A run that failed before any boot reports
 * that no report exists. The summary is returned as a bounded projection and is
 * `null` when absent — callers must treat it as nullable.
 * @param directory - the run directory holding command and fixture evidence.
 * @param phase - current driver phase.
 * @returns the located evidence, or a note explaining why there is none.
 */
export function fixtureEvidenceFor(directory, phase) {
  const kind = phaseKind(phase)
  if (kind === null) return { kind: null, relativePath: null, summary: null, note: `no fixture report expected in phase ${phase}` }
  const summary = join(directory, kind === 'removed' ? 'removed.json' : 'installed.json')
  const attempts = join(directory, 'attempts')
  const candidates = []
  // A directory scan can fail (removed, permissions). That is a diagnostic fact,
  // never an exception: it must not replace the command failure it is describing.
  try {
    if (existsSync(attempts)) {
      for (const entry of readdirSync(attempts)) {
        // The attempt prefix is the phase; mkdtemp suffixes are random, so order
        // by modification time within that prefix instead of by name.
        if (!entry.startsWith(`${kind}-`)) continue
        const result = join(attempts, entry, 'result.json')
        if (existsSync(result)) candidates.push({ file: result, at: statSync(result).mtimeMs })
      }
    }
  } catch (cause) {
    return { kind, relativePath: null, summary: null,
      note: `fixture attempt scan failed for phase ${phase}: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  candidates.sort((left, right) => right.at - left.at)
  const ordered = [...candidates.map(row => row.file), ...existsSync(summary) ? [summary] : []]
  for (const file of ordered) {
    try {
      return { kind, relativePath: relative(directory, file), summary: diagnosticProjection(JSON.parse(readFileSync(file, 'utf8'))), note: null }
    } catch { /* a partially written summary is not evidence; try the next of this phase */ }
  }
  return { kind, relativePath: null, summary: null, note: `fixture produced no ${kind} report for phase ${phase}` }
}

/**
 * First-error line for a failed command.
 *
 * The fixture's own error wins when there is one, and the driver's phase/exit
 * facts are always appended. A missing report is handled explicitly instead of
 * dereferencing a null summary, so a CLI that never produced a report still
 * surfaces its own exit status.
 * @param input - evidence, command facts and the driver's own message.
 * @returns the bounded detail string for the thrown error.
 */
export function failureDetail(input) {
  const summary = input?.evidence?.summary ?? null
  const fixtureMessage = summary !== null && typeof summary.error?.message === 'string' && summary.error.message !== ''
    ? `fixture: ${summary.error.message}`
    : null
  const where = input?.evidence === null || input?.evidence === undefined
    ? 'fixture evidence: not read'
    : `fixture evidence: ${input.evidence.relativePath ?? input.evidence.note ?? 'none'}`
  return [fixtureMessage === null ? String(input?.fallback ?? 'command failed') : fixtureMessage,
    driverContext(input?.facts),
    where,
    input?.output === undefined || input.output === '' ? '' : input.output,
  ].filter(row => row !== '').join('\n')
}

/**
 * Run one driver command, recording its facts before any caller asserts.
 *
 * Facts are copied from the spawn result as they are: a missing exit code stays
 * `null` and a timeout is `true`, `false`, or `null` when the spawn error is not
 * a timeout. Writing the record is best effort and never replaces the command
 * result.
 * @param input - command, arguments, working directory, environment and phase.
 * @returns the spawn result with the recorded facts attached.
 */
export function runDriverCommand(input) {
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd, env: input.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: input.timeoutMs ?? 180000, shell: input.shell ?? false,
  })
  const ordinal = input.ordinal ?? 0
  const spawnError = result.error === undefined ? null
    : { message: result.error.message, code: result.error.code ?? null }
  const timedOut = result.error === undefined ? false : result.error.code === 'ETIMEDOUT' ? true : null
  const facts = { phase: input.phase ?? null, ordinal, executable: input.command, args: input.args, cwd: input.cwd,
    processExitCode: result.status ?? null, processSignal: result.signal ?? null, timedOut, spawnError,
    note: 'These are driver subprocess facts, not the declared task exit code or signal.' }
  try {
    writeFileSync(join(input.directory, `command-${ordinal}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { flag: 'wx' })
    writeFileSync(join(input.directory, `command-${ordinal}.json`), JSON.stringify(facts, null, 2) + '\n', { flag: 'wx' })
  } catch { /* a diagnostic write failure must never replace the command result */ }
  return { result, facts }
}

/**
 * The one upload document, for a successful or a failed run.
 *
 * The success and failure branches share it so the shape cannot drift, and the
 * fixture summary is attached to the slot its phase allows (installed for a
 * boot-installed probe, removed for a boot-removed probe).
 * @param input - run outcome, phase, evidence, facts and runtime identity.
 * @returns the bounded upload document.
 */
export function uploadDocument(input) {
  const kind = phaseKind(input?.phase ?? null)
  const summary = input?.evidence?.summary ?? null
  const original = typeof input?.original === 'string' && input.original !== '' ? input.original : null
  const fixtureMessage = summary !== null && typeof summary.error?.message === 'string' && summary.error.message !== ''
    ? `fixture: ${summary.error.message}`
    : null
  return ciDiagnosticDocument({
    passed: input?.passed === true,
    phase: input?.phase ?? null,
    platform: input?.platform,
    selectedRuntime: input?.selectedRuntime,
    fixtureEvidence: input?.evidence === null || input?.evidence === undefined
      ? null : input.evidence.relativePath ?? input.evidence.note ?? null,
    // The phase summary wins when it exists; an absent one must not discard a
    // report the caller already has (the success run passes both explicitly).
    installed: kind === 'installed' ? summary ?? input?.installed ?? null : input?.installed ?? null,
    removed: kind === 'removed' ? summary ?? input?.removed ?? null : input?.removed ?? null,
    // The fixture's own error takes precedence; the driver phase/exit facts stay
    // in the message so a report-less CLI failure is still actionable.
    firstError: fixtureMessage === null && original === null ? null : {
      message: [fixtureMessage ?? `driver: ${original ?? 'command failed'}`, driverContext(input?.facts)].join('\n'),
    },
    cleanupError: summary?.cleanupError ?? input?.cleanupError ?? null,
    cleanupErrors: [...summary?.cleanupErrors ?? [], ...input?.cleanupErrors ?? []],
    diagnosticFailures: [...summary?.diagnosticFailures ?? [], ...input?.diagnosticFailures ?? []],
  })
}
