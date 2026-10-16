/**
 * The driver chain the profile smoke actually runs.
 *
 * These tests call the same functions `scripts/smoke-profile.mjs` calls, driving
 * them with a synthetic CLI (`node -e`) in an isolated temporary root: no real
 * Host, no profile, no network. They pin the two failure modes the review found:
 * a report-less CLI failure must still surface its own exit status (never a
 * TypeError over the original error), and a removal failure must never be
 * answered with the earlier successful install report.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { failureDetail, fixtureEvidenceFor, runDriverCommand, uploadDocument } from '../scripts/fixtures/driver-diagnostics.mjs'

const roots: string[] = []
function runRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'project-ops-driver-'))
  roots.push(directory)
  return directory
}
afterAll(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

interface DriveResult {
  result: { status: number | null }
  facts: Record<string, unknown> & { processExitCode: number | null, processSignal: string | null, timedOut: boolean | null, spawnError: { code?: string } | null, phase: string | null }
}

/** Run one synthetic command through the driver chain. */
function drive(directory: string, phase: string, script: string, options: { ordinal?: number, timeoutMs?: number } = {}): DriveResult {
  return runDriverCommand({ command: process.execPath, args: ['-e', script], cwd: directory, env: process.env,
    directory, phase, ordinal: options.ordinal ?? 0, timeoutMs: options.timeoutMs ?? 10000 }) as DriveResult
}

test('a report-less CLI failure keeps its own exit status instead of dereferencing a missing report', () => {
  const directory = runRoot()
  const { result, facts } = drive(directory, 'install-archive', 'process.exit(7)')
  expect(result.status).toBe(7)
  expect(facts.processExitCode).toBe(7)
  expect(facts.processSignal).toBeNull()
  expect(facts.timedOut).toBe(false)
  expect(facts.spawnError).toBeNull()
  expect(facts.phase).toBe('install-archive')

  const evidence = fixtureEvidenceFor(directory, 'install-archive')
  expect(evidence.summary).toBeNull()
  expect(evidence.relativePath).toBeNull()
  expect(evidence.note).toContain('no fixture report expected')

  // The pre-fix bug: `evidence.summary.error` on a null summary replaced the
  // command failure with a TypeError. Both calls below must survive it.
  const detail = failureDetail({ evidence, facts, fallback: 'node failed', output: '' })
  expect(detail).toContain('exitCode=7')
  expect(detail).toContain('install-archive')
  expect(detail).not.toContain('TypeError')

  const document = uploadDocument({ passed: false, phase: 'install-archive', evidence, facts,
    original: detail, selectedRuntime: { source: { kind: 'caller supplied', label: 'lab' }, sdkVersion: '0.2.1-alpha.5' } })
  expect(document.firstError.message).toContain('exitCode=7')
  expect(document.installed).toBeNull()
  expect(document.removed).toBeNull()
})

test('a timeout is reported as true with an unknown exit code, not as zero', () => {
  const directory = runRoot()
  const { facts } = drive(directory, 'probe-installed', 'setTimeout(() => {}, 5000)', { timeoutMs: 250 })
  expect(facts.timedOut).toBe(true)
  // Unknown stays null: a killed child has no exit status to report.
  expect(facts.processExitCode).toBeNull()
  expect(facts.spawnError?.code).toBe('ETIMEDOUT')
})

test('an existing fixture report is preferred, and the driver line is still included', () => {
  const directory = runRoot()
  writeFileSync(join(directory, 'installed.json'), JSON.stringify({
    passed: false, error: { name: 'ProbeFailure', message: 'probe exploded at /home/fixture-user/projects/fixture-project/private/x.json' },
    returned: { exitCode: 1, signal: null, timedOut: false },
  }))
  const { facts } = drive(directory, 'probe-installed', 'process.exit(1)')
  const evidence = fixtureEvidenceFor(directory, 'probe-installed')
  expect(evidence.relativePath).toBe('installed.json')
  const document = uploadDocument({ passed: false, phase: 'probe-installed', evidence, facts, original: 'node failed' })
  expect(document.installed.error.message).toContain('probe exploded')
  expect(document.removed).toBeNull()
  // The fixture error leads; the driver phase/exit facts follow.
  expect(document.firstError.message.startsWith('fixture: probe exploded')).toBe(true)
  expect(document.firstError.message).toContain('exitCode=1')
  // The location inside the fixture message is scrubbed on the way out.
  expect(JSON.stringify(document)).not.toContain('/home/fixture-user')
})

test('a removal failure never reads the earlier install report', () => {
  const directory = runRoot()
  writeFileSync(join(directory, 'installed.json'), JSON.stringify({ passed: true, returned: { exitCode: 0 } }))
  mkdirSync(join(directory, 'attempts', 'installed-aaa'), { recursive: true })
  writeFileSync(join(directory, 'attempts', 'installed-aaa', 'result.json'), JSON.stringify({ passed: true }))
  mkdirSync(join(directory, 'attempts', 'removed-bbb'), { recursive: true })
  writeFileSync(join(directory, 'attempts', 'removed-bbb', 'result.json'), JSON.stringify({
    passed: false, error: { name: 'ProbeFailure', message: 'removal probe failed' }, returned: { exitCode: 1 },
  }))

  // The removal phase reads its own prefix, not the install success.
  const removed = fixtureEvidenceFor(directory, 'remove-plugin')
  expect(removed.kind).toBe('removed')
  expect(removed.relativePath).toBe(join('attempts', 'removed-bbb', 'result.json'))
  const document = uploadDocument({ passed: false, phase: 'remove-plugin', evidence: removed,
    facts: { phase: 'remove-plugin', ordinal: 3, processExitCode: 1, processSignal: null, timedOut: false, spawnError: null },
    original: 'removal command failed' })
  expect(document.removed.error.message).toContain('removal probe failed')
  expect(document.installed).toBeNull()
  expect(document.firstError.message.startsWith('fixture: removal probe failed')).toBe(true)

  // Before any boot there is nothing to read at all.
  const early = fixtureEvidenceFor(directory, 'initialize-profile')
  expect(early.kind).toBeNull()
  expect(early.summary).toBeNull()
})

test('a diagnostic write failure does not replace the command result', () => {
  // The record directory does not exist, so every write fails; the command facts
  // must still come back intact.
  const directory = join(runRoot(), 'missing-directory')
  const { result, facts } = runDriverCommand({ command: process.execPath, args: ['-e', 'process.exit(3)'],
    cwd: tmpdir(), env: process.env, directory, phase: 'install-archive', ordinal: 0 })
  expect(result.status).toBe(3)
  expect(facts.processExitCode).toBe(3)
})

test('fixture cleanup and diagnostic failures reach the uploaded document as arrays', () => {
  const directory = runRoot()
  writeFileSync(join(directory, 'installed.json'), JSON.stringify({
    passed: false,
    error: { name: 'ProbeFailure', message: 'business check failed' },
    cleanupErrors: ['dispose agent handle: already disposed', 'kill job bash-1: job already finished'],
    diagnosticFailures: ['write command-3.json: EACCES'],
  }))
  const { facts } = drive(directory, 'probe-installed', 'process.exit(1)')
  const document = uploadDocument({ passed: false, phase: 'probe-installed',
    evidence: fixtureEvidenceFor(directory, 'probe-installed'), facts, original: 'node failed' })
  // The plural field has to survive projection and upload; a singular-only
  // mapping would silently drop the second cleanup failure.
  expect(document.cleanupErrors).toEqual([
    'dispose agent handle: already disposed',
    'kill job bash-1: job already finished',
  ])
  expect(document.diagnosticFailures).toEqual(['write command-3.json: EACCES'])
  expect(document.installed?.cleanupErrors).toHaveLength(2)
  // The fixture's own business error stays the first error.
  expect(String(document.firstError?.message)).toContain('business check failed')
})

test('a later business failure is frozen even after an expected rejection, an older success and a cleanup error', () => {
  const directory = runRoot()
  // The stage names come from the fixture's own check names; the snapshot is the
  // one frozen by the real recorder, replayed here through both projections.
  writeFileSync(join(directory, 'installed.json'), JSON.stringify({
    passed: false,
    error: { name: 'AssertionError', message: 'config-change-baseline: actual failed, expected succeeded' },
    cleanupErrors: ['dispose agent handle: already disposed'],
    // The frozen snapshot names the failing stage's own call, not the earlier
    // successful run and not the deny that was expected to fail.
    businessFailure: {
      stage: 'config-change-baseline',
      error: { name: 'AssertionError', message: 'actual failed, expected succeeded' },
      tool: { ordinal: 9, tool: 'missher_project_ops_task_run', callId: 'profile-probe-9', isError: null,
        error: { name: 'AssertionError', message: 'actual failed, expected succeeded' } },
      receipt: { outcome: 'failed', exitCode: 1, executionMode: 'foreground', executorTool: 'bash', jobId: null, nestedCallId: 'call-9' },
      native: { callId: 'native-9', parentCallId: 'profile-probe-9', kind: 'completed', exitCode: 1, signal: null,
        timedOut: false, aborted: null, sandbox: { denied: false, runnerFailed: null }, stderr: 'verify failed', stdout: null },
      value: null,
      nestedContent: ['verify script exited 1'],
      dispatch: null,
    },
  }))
  const { facts } = drive(directory, 'probe-installed', 'process.exit(1)')
  const document = uploadDocument({ passed: false, phase: 'probe-installed',
    evidence: fixtureEvidenceFor(directory, 'probe-installed'), facts, original: 'node failed' })
  expect(document.installed.businessFailure.stage).toBe('config-change-baseline')
  expect(document.installed.businessFailure.tool.ordinal).toBe(9)
  expect(document.installed.businessFailure.tool.callId).toBe('profile-probe-9')
  expect(document.installed.businessFailure.receipt).toMatchObject({ outcome: 'failed', exitCode: 1, executorTool: 'bash' })
  expect(document.installed.businessFailure.native).toMatchObject({ callId: 'native-9', exitCode: 1, stderr: 'verify failed' })
  expect(document.installed.businessFailure.nestedContent).toEqual(['verify script exited 1'])
  // The earlier expected rejection cannot appear as this failure's context, and
  // the cleanup problem stays in its own field.
  expect(JSON.stringify(document.installed.businessFailure)).not.toContain('native-policy-denied')
  expect(document.cleanupErrors).toEqual(['dispose agent handle: already disposed'])
  expect(document.firstError.message.startsWith('fixture:')).toBe(true)
  // A second projection of the same summary is stable.
  expect(document.installed.businessFailure).toEqual(fixtureEvidenceFor(directory, 'probe-installed').summary.businessFailure)
})

test('a failure without a related native call reports null rather than an older launch', () => {
  const directory = runRoot()
  writeFileSync(join(directory, 'installed.json'), JSON.stringify({
    passed: false,
    businessFailure: { stage: 'source-change-baseline', error: { name: 'AssertionError', message: 'expected passed' },
      tool: null, receipt: null, native: null, value: null, nestedContent: null, dispatch: null },
  }))
  const { facts } = drive(directory, 'probe-installed', 'process.exit(1)')
  const document = uploadDocument({ passed: false, phase: 'probe-installed',
    evidence: fixtureEvidenceFor(directory, 'probe-installed'), facts, original: 'node failed' })
  expect(document.installed.businessFailure.stage).toBe('source-change-baseline')
  expect(document.installed.businessFailure.tool).toBeNull()
  expect(document.installed.businessFailure.receipt).toBeNull()
  expect(document.installed.businessFailure.native).toBeNull()
  expect(document.installed.businessFailure.nestedContent).toBeNull()
})

test('the success and failure branches produce the same document shape', () => {
  const directory = runRoot()
  const { facts } = drive(directory, 'probe-removed', 'process.exit(0)')
  const evidence = fixtureEvidenceFor(directory, 'probe-removed')
  const success = uploadDocument({ passed: true, phase: 'probe-removed', evidence, facts, original: null,
    installed: { passed: true, returned: { exitCode: 0 } }, removed: { passed: true, returned: { exitCode: 0 } } })
  const failure = uploadDocument({ passed: false, phase: 'probe-removed', evidence, facts, original: 'node failed' })
  expect(Object.keys(success).sort()).toEqual(Object.keys(failure).sort())
  expect(success.passed).toBe(true)
  // Both explicit reports survive even though this phase produced no summary:
  // an absent summary must not silently empty the slot the driver filled.
  expect(success.installed.passed).toBe(true)
  expect(success.removed.passed).toBe(true)
  expect(success.removed.returned.exitCode).toBe(0)
  expect(success.firstError).toBeNull()
  expect(failure.passed).toBe(false)
})

test('the chain reports a spawn error it cannot run, without inventing an exit code', () => {
  const directory = runRoot()
  const { result, facts } = runDriverCommand({ command: join(directory, 'does-not-exist'), args: [],
    cwd: directory, env: process.env, directory, phase: 'install-archive', ordinal: 1 })
  expect(result.error).toBeDefined()
  expect(facts.processExitCode).toBeNull()
  expect(facts.spawnError).not.toBeNull()
  expect(spawnSync(process.execPath, ['-e', 'process.exit(0)']).status).toBe(0)
})
