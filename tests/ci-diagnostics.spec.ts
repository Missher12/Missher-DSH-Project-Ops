/**
 * Diagnostic projection and the exact CI upload document.
 *
 * These tests exercise the object that is actually uploaded
 * (`ciDiagnosticDocument`), not only the per-field projection: every string in
 * it must be scrubbed, including caller-supplied labels, phases and cleanup
 * messages, and free text must stay small.
 */
import { expect, test } from 'vitest'
import { ciDiagnosticDocument, diagnosticProjection, scrubDiagnosticText } from '../scripts/fixtures/probe-evidence.mjs'

/** Credential shapes the projection is expected to neutralise. */
const CREDENTIALS = [
  '{"api_key":"sk-live-abcdefghijklmnopqrst"}',
  'token=ghp_abcdefghijklmnopqrstuvwx',
  'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
  'https://user:s3cr3t@example.invalid/path',
  'https://example.invalid/path?token=abcd1234efgh&x=1',
  'password: hunter2hunter2',
]

const LOCATIONS = [
  'D:\\a\\Missher-DSH-Project-Ops\\Missher-DSH-Project-Ops\\.artifacts\\profile-x',
  'C:\\Users\\dev\\AppData\\Local\\Temp\\profile',
  '/home/fixture-user/projects/fixture-project/.artifacts/official-compat/profile-abc',
  '/tmp/folder with spaces/installed.json',
]

test('the frozen business snapshot survives a second projection, sanitised and whitelisted', () => {
  const source = {
    passed: false,
    businessFailure: {
      stage: 'declared-workspace-execution',
      error: { name: 'AssertionError', message: 'failed at /home/fixture-user/projects/fixture-project/x' },
      tool: { ordinal: 3, tool: 'missher_project_ops_task_run', callId: 'profile-probe-3', isError: null,
        error: { name: 'AssertionError', message: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload' } },
      receipt: { outcome: 'failed', exitCode: 1, executionMode: 'foreground', executorTool: 'pwsh', jobId: 'bash-3',
        nestedCallId: 'call-3', stderr: 'must not appear on a receipt' },
      native: { callId: 'native-3', parentCallId: 'profile-probe-3', kind: 'completed', exitCode: 1, signal: null,
        timedOut: false, aborted: null, sandbox: { denied: false, runnerFailed: null },
        stderr: 'C:\\Users\\fixture\\out.log', stdout: null },
      value: null,
      nestedContent: [`failed in /home/fixture-user/projects/fixture-project/out.log`, 'x'.repeat(400)],
      dispatch: { ordinal: 2, callId: 'call-2', receipt: { outcome: 'running', jobId: 'bash-3', nestedCallId: 'call-3', extra: 'dropped' } },
      unknownField: 'must not survive',
    },
  }
  const once = diagnosticProjection(source)
  const twice = diagnosticProjection(once)
  // Idempotent: the driver projects the fixture summary, the upload projects again.
  expect(twice).toEqual(once)
  const document = ciDiagnosticDocument({ passed: false, installed: once })
  // The snapshot is attributed to the phase it belongs to, not duplicated at the
  // top level, so the upload document has exactly one copy of it.
  expect('businessFailure' in document).toBe(false)
  const frozen = document.installed.businessFailure
  expect(frozen.stage).toBe('declared-workspace-execution')
  // The error whitelist emits all four of its keys, so an absent `code` is an
  // explicit null rather than a missing property.
  expect(frozen.tool).toEqual({ ordinal: 3, tool: 'missher_project_ops_task_run', callId: 'profile-probe-3', isError: null,
    error: { name: 'AssertionError', message: '[redacted]', code: null, infoCode: null } })
  // Each nested object keeps only its own short key list.
  expect(Object.keys(frozen.receipt).sort()).toEqual(['executionMode', 'executorTool', 'exitCode', 'jobId', 'nestedCallId', 'outcome'])
  expect(frozen.native.stderr).toBe('[path]')
  expect(JSON.stringify(frozen)).not.toContain('must not appear on a receipt')
  expect(JSON.stringify(document)).not.toContain('unknownField')
  // Bounded text: at most two blocks, each scrubbed and capped.
  expect(frozen.nestedContent).toHaveLength(2)
  expect(frozen.nestedContent[0]).toBe('failed in [path]')
  expect(frozen.nestedContent[1].length).toBeLessThanOrEqual(240)
  expect(JSON.stringify(document)).not.toContain('/home/fixture-user')
  expect(JSON.stringify(document)).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  expect(JSON.stringify(document)).not.toContain('C:\\Users')
  // The dispatch pair survives both projections with its own receipt keys.
  expect(frozen.dispatch).toMatchObject({ ordinal: 2, callId: 'call-2' })
  expect(frozen.dispatch.receipt).toEqual({ outcome: 'running', exitCode: null, executionMode: null, executorTool: null,
    jobId: 'bash-3', nestedCallId: 'call-3' })
})

test('every credential shape and machine location is neutralised in the upload', () => {
  const document = ciDiagnosticDocument({
    passed: false,
    phase: `probe-installed ${CREDENTIALS[1]}`,
    platform: { node: 'v22.20.0', os: 'linux', arch: 'x64' },
    selectedRuntime: {
      source: { kind: 'caller supplied', label: CREDENTIALS[0] },
      sdkVersion: '0.2.1-alpha.5',
      archive: { name: '@missher/dsh-project-ops', version: '0.4.0', sha256: 'a'.repeat(64), bytes: 1 },
    },
    fixtureEvidence: LOCATIONS[2],
    installed: { passed: false, phase: 'probe-installed', error: { name: 'X', message: `${CREDENTIALS[2]}\n${LOCATIONS[3]}` },
      returned: { exitCode: 1, signal: null, timedOut: false, stderr: CREDENTIALS[4], stdout: LOCATIONS[0] } },
    removed: null,
    firstError: { message: `${CREDENTIALS[3]} at ${LOCATIONS[1]}` },
    cleanupError: `${CREDENTIALS[5]} (${LOCATIONS[2]})`,
    diagnosticFailures: [`write command-3.json failed: ${CREDENTIALS[1]}`],
  })
  const text = JSON.stringify(document)
  for (const secret of ['sk-live-abcdefghijklmnopqrst', 'ghp_abcdefghijklmnopqrstuvwx', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 's3cr3t', 'abcd1234efgh', 'hunter2hunter2']) {
    expect(text).not.toContain(secret)
  }
  for (const location of ['D:\\a\\', 'C:\\Users', '/home/fixture-user', '/tmp/folder']) {
    expect(text).not.toContain(location)
  }
  expect(text).toContain('[redacted]')
  expect(text).toContain('[path]')
  // Identity fields that are not secrets survive: they are the point of the upload.
  expect(document.selectedRuntime.archive.sha256).toBe('a'.repeat(64))
  expect(document.selectedRuntime.sdkVersion).toBe('0.2.1-alpha.5')
  expect(document.installed.returned.exitCode).toBe(1)
  expect(document.installed.returned.timedOut).toBe(false)
})

test('scrubbing happens before truncation, so a cap cannot leave a prefix behind', () => {
  const secret = `ghp_${'a'.repeat(400)}`
  const text = scrubDiagnosticText(`token=${secret}`, 80)
  expect(text.length).toBeLessThanOrEqual(80)
  expect(text.startsWith(secret.slice(0, 10))).toBe(false)
  expect(text).toContain('[redacted]')
})

test('unknown values stay null and real zero/false survive in the upload document', () => {
  const document = ciDiagnosticDocument({
    passed: false,
    phase: 'probe-installed',
    platform: { node: null, os: undefined, arch: 'x64' },
    selectedRuntime: { source: {}, sdkVersion: null, archive: { name: null, version: null, sha256: 'not-a-digest', bytes: null } },
    fixtureEvidence: null,
    installed: { passed: false, returned: { exitCode: null, signal: undefined, timedOut: null } },
    firstError: null,
    cleanupError: null,
  })
  expect(document.platform.node).toBeNull()
  expect(document.platform.os).toBeNull()
  expect(document.selectedRuntime.sdkVersion).toBeNull()
  // A bogus digest is dropped rather than uploaded as an identity claim.
  expect(document.selectedRuntime.archive.sha256).toBeNull()
  expect(document.installed.returned.exitCode).toBeNull()
  expect(document.installed.returned.timedOut).toBeNull()
  expect(document.cleanupError).toBeNull()
  expect(diagnosticProjection({ returned: { exitCode: 0, timedOut: false } }).returned).toMatchObject({ exitCode: 0, timedOut: false })
})

test('free text is bounded small and only allowlisted fields are uploaded', () => {
  const document = ciDiagnosticDocument({
    passed: true,
    phase: 'probe-removed',
    platform: { node: 'v22.20.0', os: 'linux', arch: 'x64' },
    selectedRuntime: { source: { kind: 'checkout', label: 'checkout' }, sdkVersion: '0.2.1-alpha.5',
      archive: { name: '@missher/dsh-project-ops', version: '0.4.0', sha256: null, bytes: null } },
    installed: { returned: { stdout: 'x'.repeat(2000), stderr: 'y'.repeat(2000), callId: 'must-not-be-uploaded' } },
    removed: null,
    firstError: { message: 'z'.repeat(2000) },
    cleanupError: 'w'.repeat(2000),
  })
  const text = JSON.stringify(document)
  expect(document.installed.returned.stdout.length).toBeLessThanOrEqual(240)
  expect(document.firstError.message.length).toBeLessThanOrEqual(240)
  expect(document.cleanupError.length).toBeLessThanOrEqual(240)
  expect(text).not.toContain('must-not-be-uploaded')
  expect(Object.keys(document).sort()).toEqual([
    'cleanupError', 'cleanupErrors', 'diagnosticFailures', 'firstError', 'fixtureEvidence', 'installed', 'passed', 'phase', 'platform', 'removed', 'selectedRuntime',
  ])
})

test('a malformed input still yields a document rather than throwing', () => {
  for (const value of [undefined, null, 'text', 42, []]) {
    const document = ciDiagnosticDocument(value)
    expect(document.passed).toBe(false)
    expect(document.installed).toBeNull()
    expect(document.firstError).toBeNull()
  }
})
