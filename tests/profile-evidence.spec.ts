import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { createProbeEvidence } from '../scripts/fixtures/probe-evidence.mjs'
import { fixtureEvidenceFor, uploadDocument } from '../scripts/fixtures/driver-diagnostics.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const evidenceRoot = join(root, '.artifacts/r7-instrumentation')
mkdirSync(evidenceRoot, { recursive: true })
const directory = mkdtempSync(join(evidenceRoot, 'test-'))
const execute = (report: string, mode?: string, timeout = 15000) => spawnSync(process.execPath,
  [join(root, 'tests/fixtures/profile-evidence-failure.mjs'), report, ...mode ? [mode] : []],
  { cwd: root, encoding: 'utf8', timeout })
const records = (attempt: string) => readdirSync(attempt).filter(file => /^\d+-/u.test(file))
  .sort().map(file => JSON.parse(readFileSync(join(attempt, file), 'utf8')))

test('retains native exit evidence before a failing assertion and never overwrites prior attempts', () => {
  const report = join(directory, 'installed.json')
  expect(execute(report).status).toBe(1)
  const firstReport = readFileSync(report, 'utf8')
  const first = JSON.parse(firstReport)
  expect(first.passed).toBe(false)
  expect(first.error.name).toBe('AssertionError')
  const before = records(first.attemptDirectory)
  const native = before.find(row => row.kind === 'native-return')
  expect(native.returned.exitCode).toBe(7)
  expect(native.returned.signal).toBeNull()
  expect(native.returned.timedOut).toBe('unavailable')
  expect(native.returned.workdir).toBe('unavailable')
  expect(native.requestedWorkdir).toBe(directory)
  expect(native.returned.stderr).toContain('intentional fixture exit')
  expect(before.find(row => row.kind === 'tool-return' && row.tool === 'missher_project_ops_task_run')
    .returned.receipt.exitCode).toBe(7)
  expect(before.at(-1).kind).toBe('probe-error')
  expect(before[0].runtime.node).toBe(process.version)
  expect(before[0].selectedHost).toBe('unavailable')
  const firstBytes = readdirSync(first.attemptDirectory).map(file => [file, readFileSync(join(first.attemptDirectory, file), 'utf8')])
  expect(execute(report).status).toBe(1)
  expect(readFileSync(report, 'utf8')).toBe(firstReport)
  expect(readdirSync(join(directory, 'attempts'))).toHaveLength(2)
  for (const [file, text] of firstBytes) expect(readFileSync(join(first.attemptDirectory, file), 'utf8')).toBe(text)
}, 35000)

test('the frozen business context reaches the final upload, not just the attempt records', () => {
  const report = join(directory, 'nested-installed.json')
  expect(execute(report, 'nested').status).toBe(1)
  const fixture = JSON.parse(readFileSync(report, 'utf8'))
  // The fixture summary carries the frozen snapshot with the failing stage.
  expect(fixture.businessFailure.stage).toBe('declared-workspace-execution')
  expect(fixture.businessFailure.receipt).toMatchObject({ outcome: 'failed', exitCode: 7 })
  expect(fixture.businessFailure.tool).toMatchObject({ tool: 'missher_project_ops_task_run', isError: false })
  expect(Number.isInteger(fixture.businessFailure.tool.ordinal)).toBe(true)
  expect(fixture.businessFailure.tool.callId).toBe(`profile-probe-${fixture.businessFailure.tool.ordinal}`)

  // The real driver chain: fixture summary -> projection -> upload document. The
  // summary is written as `installed.json` in this test's own directory, so the
  // driver reads this fixture and not another test's attempt.
  const uploadDir = join(directory, 'nested-upload')
  mkdirSync(uploadDir, { recursive: true })
  writeFileSync(join(uploadDir, 'installed.json'), JSON.stringify(fixture))
  const evidence = fixtureEvidenceFor(uploadDir, 'probe-installed')
  expect(evidence.relativePath).toBe('installed.json')
  const document = uploadDocument({ passed: false, phase: 'probe-installed', evidence,
    facts: { phase: 'probe-installed' }, original: 'node failed' })
  const frozen = document.installed.businessFailure
  expect(frozen).not.toBeNull()
  expect(frozen.stage).toBe('declared-workspace-execution')
  expect(frozen.receipt).toMatchObject({ outcome: 'failed', exitCode: 7, executionMode: null, jobId: null })
  expect(frozen.tool.ordinal).toBe(fixture.businessFailure.tool.ordinal)
  expect(frozen.tool.callId).toBe(fixture.businessFailure.tool.callId)
  // The native shell call that produced the failure, paired to its tool call.
  expect(frozen.native).toMatchObject({ callId: 'synthetic-native-call', exitCode: 7, timedOut: null })
  expect(frozen.native.parentCallId).toBe(frozen.tool.callId)
  expect(frozen.native.stderr).toContain('intentional fixture exit')
  // Only the first two nested blocks survive, scrubbed and capped.
  expect(frozen.nestedContent).toHaveLength(2)
  expect(frozen.nestedContent[1]).toBe('second bounded block')
  expect(JSON.stringify(frozen.nestedContent)).not.toContain('third block')
  const frozenText = JSON.stringify(document)
  expect(frozenText).not.toContain('/home/fixture-user')
  expect(frozenText).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  expect(frozenText).toContain('[path]')
  for (const block of frozen.nestedContent) expect(block.length).toBeLessThanOrEqual(240)
  // A second projection of the same object is stable: the driver projects once
  // and the upload document projects again.
  expect(document.installed.businessFailure).toEqual(fixtureEvidenceFor(uploadDir, 'probe-installed').summary.businessFailure)
  // The synthetic child of this `nested` mode declares linux as its own test
  // platform (see tests/fixtures/profile-evidence-failure.mjs), so this case is an
  // explicit non-Windows scenario on any CI host: the diagnostic is reported as
  // skipped and never called at all.
  expect(fixture.startupDiagnostic.result).toBe('skipped-not-windows')
  expect(fixture.startupDiagnostic.attempted).toBe(false)
  expect(existsSync(join(directory, 'nested-installed.json.diag-calls.json'))).toBe(false)
}, 35000)

test('the canonical Host stream shape keeps long stderr text up to its own cap', () => {
  const report = join(directory, 'object-stream.json')
  expect(execute(report, 'object-stream').status).toBe(1)
  const fixture = JSON.parse(readFileSync(report, 'utf8'))
  const frozenStderr = fixture.businessFailure.native.stderr
  // The Host reports `{ text, truncated, spillPath? }`; the text is kept and the
  // metadata is not. This synthetic sample is longer than the cap even after
  // scrubbing, so an exact-length assertion proves the cap really applied rather
  // than merely allowing a short string through.
  expect(typeof frozenStderr).toBe('string')
  expect(frozenStderr.length).toBe(1024)
  // The marker exists only to prove long text survives; it is not a claim about
  // where any real failure's cause sits.
  expect(frozenStderr).toContain('LONG-TEXT-MARKER')
  expect(fixture.businessFailure.native.stdout.length).toBeLessThanOrEqual(240)

  const uploadDir = join(directory, 'object-stream-upload')
  mkdirSync(uploadDir, { recursive: true })
  writeFileSync(join(uploadDir, 'installed.json'), JSON.stringify(fixture))
  const summary = fixtureEvidenceFor(uploadDir, 'probe-installed')
  const document = uploadDocument({ passed: false, phase: 'probe-installed', evidence: summary,
    facts: { phase: 'probe-installed' }, original: 'node failed' })
  const native = document.installed.businessFailure.native
  // The same text survives the driver projection and the upload projection, and
  // the cap is still exactly the stderr budget.
  expect(native.stderr).toBe(summary.summary.businessFailure.native.stderr)
  expect(native.stderr.length).toBe(1024)
  expect(native.stderr).toContain('LONG-TEXT-MARKER')
  expect(native.stdout.length).toBeLessThanOrEqual(240)
  // Scrubbing happens before the cap, so the boundary cannot leak either shape.
  expect(native.stderr).not.toContain('/home/fixture-user')
  expect(native.stderr).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  expect(native.stderr).toContain('[path]')
  expect(native.stderr).toContain('[redacted]')
  const uploaded = JSON.stringify(document)
  expect(uploaded).not.toContain('spillPath')
  expect(uploaded).not.toContain('spill.txt')
  expect(uploaded).not.toContain('truncated')
}, 35000)

/** Run one synthetic Windows mode through the real apply chain. */
function runWindowMode(name: string, childTimeoutMs = 15000) {
  const report = join(directory, `${name}.json`)
  expect(execute(report, name, childTimeoutMs).status).toBe(1)
  const summary = JSON.parse(readFileSync(report, 'utf8'))
  const calls = JSON.parse(readFileSync(join(directory, `${name}.json.diag-calls.json`), 'utf8'))
  return { report, summary, calls }
}

test('the Windows startup diagnostic runs once, on the same agent and the failed workdir, and never changes the first failure', () => {
  const { report, summary, calls } = runWindowMode('win-diag')
  // The original business failure is intact: same stage, same tool, still exit 7.
  expect(summary.passed).toBe(false)
  expect(summary.error.name).toBe('AssertionError')
  expect(summary.businessFailure.stage).toBe('declared-workspace-execution')
  expect(summary.businessFailure.tool.tool).toBe('missher_project_ops_task_run')
  expect(summary.businessFailure.receipt.exitCode).toBe(7)
  // Exactly one diagnostic call, same owner agent, same workdir as the failure.
  expect(calls.diagnostic).toHaveLength(1)
  expect(calls.diagnostic[0].agentIsOwner).toBe(true)
  expect(calls.diagnostic[0].workdir).toBe(join(dirname(report), 'packages', 'app'))
  expect(summary.startupDiagnostic.result).toBe('ok')
  expect(summary.startupDiagnostic.platform).toBe('win32')
  // The diagnostic repeated the failure's own directory (packages/app), which is
  // not the workspace root.
  expect(calls.diagnostic[0].workdir).toBe(join(dirname(report), 'packages', 'app'))
  expect(calls.diagnostic[0].workdir).not.toBe(dirname(report))
  expect(summary.startupDiagnostic.workdirClass).toBe('packages-app')
  expect(summary.startupDiagnostic.data.npm).toMatchObject({ type: 'ExternalScript', shim: 'npm.ps1',
    rule: 'block-match-sibling-exe' })
  expect(summary.startupDiagnostic.data.candidate).toMatchObject({ basename: 'node.exe',
    matchesHostExecPath: true, exists: true, isFile: true, readable: true })
  expect(summary.startupDiagnostic.data.start.error).toMatchObject({ win32: true, type: 'Win32Exception',
    nativeErrorCode: 5 })
  // The same mock error still reports code 5, and its bounded throw site survives
  // both projection layers: illegal names and repeats are dropped, not fabricated.
  expect(summary.startupDiagnostic.data.start.error.site).toEqual({
    targetSite: 'CreatePipeWithSecurityAttributes',
    processMethods: ['StartCore', 'CreatePipeWithSecurityAttributes', 'CreatePipe'],
  })
})

test('diagnostic throw, promoted job and late job all keep the first failure and really clean up', () => {
  const thrown = runWindowMode('win-diag-throw')
  expect(thrown.summary.startupDiagnostic.result).toBe('throw')
  expect(thrown.summary.businessFailure.tool.tool).toBe('missher_project_ops_task_run')
  expect(thrown.summary.businessFailure.receipt.exitCode).toBe(7)
  expect(thrown.summary.startupDiagnostic.notes.join(' ')).toContain('diagnostic transport exploded')

  const job = runWindowMode('win-diag-job')
  expect(job.summary.startupDiagnostic.result).toBe('promoted')
  expect(job.summary.startupDiagnostic.job).toMatchObject({ promoted: true, killed: true, waited: true, terminal: true })
  // A real kill/wait through the owner session, not merely a set entry.
  expect(job.calls.jobs.filter(row => row.id === 'synthetic-job-1').map(row => row.op).sort()).toEqual(['kill', 'wait'])
  expect(job.calls.jobs.every(row => row.caller === 'synthetic-owner-session')).toBe(true)
  expect(job.summary.businessFailure.receipt.exitCode).toBe(7)

  // The late job resolves after the hard deadline: the summary is already written,
  // so cleanup is proven by the independent calls file, which the child can only
  // write after the late handler actually issued kill and wait. The summary says
  // the cleanup was unproven rather than claiming it settled.
  const late = runWindowMode('win-diag-late-job', 40000)
  expect(late.summary.startupDiagnostic.result).toBe('timeout')
  expect(late.summary.startupDiagnostic.notes.join(' ')).toContain('unproven')
  expect(late.calls.jobs.filter(row => row.id === 'synthetic-late-job').map(row => row.op).sort()).toEqual(['kill', 'wait'])
  expect(late.calls.jobs.filter(row => row.id === 'synthetic-late-job').every(row => row.caller === 'synthetic-owner-session')).toBe(true)
  expect(late.summary.businessFailure.receipt.exitCode).toBe(7)
}, 90000)

test('malformed, oversized and unsupported diagnostic payloads are classified without touching the business failure', () => {
  for (const [name, expected] of [['win-diag-badjson', 'invalid-json'], ['win-diag-oversize', 'oversized'],
    ['win-diag-unsupported', 'unsupported-protocol']] as const) {
    const { summary } = runWindowMode(name)
    expect(summary.startupDiagnostic.result).toBe(expected)
    expect(summary.startupDiagnostic.data).toBeNull()
    expect(summary.businessFailure.tool.tool).toBe('missher_project_ops_task_run')
    expect(summary.businessFailure.receipt.exitCode).toBe(7)
  }
})

test('records a thrown native error before unwinding without fabricating exit information', () => {
  const report = join(directory, 'thrown.json')
  expect(execute(report, 'throw').status).toBe(1)
  const result = JSON.parse(readFileSync(report, 'utf8'))
  const rows = records(result.attemptDirectory)
  const native = rows.find(row => row.kind === 'native-error')
  expect(native.error.message).toContain('intentional native execution error')
  expect(native.returned.exitCode).toBe('unavailable')
  expect(native.returned.signal).toBe('unavailable')
  expect(native.returned.timedOut).toBe('unavailable')
  expect(rows.some(row => row.kind === 'tool-error')).toBe(true)
  expect(rows.at(-1).kind).toBe('probe-error')
  // A thrown native error has no exit information to report, and the frozen
  // snapshot must not invent one.
  expect(result.businessFailure.native.exitCode).toBeNull()
  expect(result.businessFailure.native.signal).toBeNull()
  expect(result.businessFailure.native.timedOut).toBeNull()
  // And the same facts must survive the final upload, not only the raw record:
  // the throwing call is the one named, and its unknown facts stay null.
  const throwDir = join(directory, 'throw-upload')
  mkdirSync(throwDir, { recursive: true })
  writeFileSync(join(throwDir, 'installed.json'), JSON.stringify(result))
  const document = uploadDocument({ passed: false, phase: 'probe-installed',
    evidence: fixtureEvidenceFor(throwDir, 'probe-installed'), facts: { phase: 'probe-installed' }, original: 'node failed' })
  expect(document.installed.businessFailure.error.message).toContain('intentional native execution error')
  expect(document.installed.businessFailure.tool.tool).toBe('missher_project_ops_task_run')
  expect(document.installed.businessFailure.tool.isError).toBeNull()
  expect(document.installed.businessFailure.native.exitCode).toBeNull()
  expect(document.installed.businessFailure.receipt).toBeNull()
}, 20000)

test('a collected call keeps its dispatch paired, and only when the nested call matches', async () => {
  const report = join(directory, 'dispatch.json')
  const evidence = createProbeEvidence({ report })
  const stages = { stage: 'foreground-promotion-retains-native-job' }
  evidence.setBusinessStage(stages.stage)
  const dispatchReceipt = { outcome: 'running', executionMode: 'background', executorTool: 'bash', jobId: 'bash-7', nestedCallId: 'call-7' }
  // The native launch belongs to the dispatch call, not to the later collect.
  await evidence.observe('native', { tool: 'bash', callId: 'native-7', parentCallId: 'call-7' },
    async () => ({ kind: 'promoted', exitCode: null, stderr: 'started' }))
  await evidence.observe('tool', { tool: 'missher_project_ops_task_run', callId: 'call-7', ordinal: 1 },
    async () => ({ isError: false, value: { receipt: dispatchReceipt } }))
  const collectReceipt = { outcome: 'failed', exitCode: 7, executionMode: 'background', executorTool: 'bash', jobId: 'bash-7', nestedCallId: 'call-7' }
  await evidence.observe('tool', { tool: 'missher_project_ops_task_collect', callId: 'call-8', ordinal: 2 },
    async () => ({ isError: false, value: { receipt: collectReceipt, nestedContent: [{ type: 'text', text: 'collect failed' }] } }))
  const frozen = evidence.freezeBusinessFailure(new Error('collected task failed'))
  expect(frozen.tool).toMatchObject({ ordinal: 2, tool: 'missher_project_ops_task_collect' })
  expect(frozen.receipt).toMatchObject({ outcome: 'failed', exitCode: 7 })
  expect(frozen.dispatch).toMatchObject({ ordinal: 1, callId: 'call-7' })
  expect(frozen.dispatch.receipt.jobId).toBe('bash-7')
  // The native evidence is the dispatch's launch, found through the paired call.
  expect(frozen.native).toMatchObject({ callId: 'native-7', parentCallId: 'call-7', kind: 'promoted' })

  // Same job id but a different nested call id is not this collect's dispatch.
  const other = createProbeEvidence({ report: join(directory, 'dispatch-mismatch.json') })
  other.setBusinessStage(stages.stage)
  await other.observe('tool', { tool: 'missher_project_ops_task_run', callId: 'call-a', ordinal: 1 },
    async () => ({ isError: false, value: { receipt: { ...dispatchReceipt, nestedCallId: 'call-a' } } }))
  await other.observe('tool', { tool: 'missher_project_ops_task_collect', callId: 'call-b', ordinal: 2 },
    async () => ({ isError: false, value: { receipt: { ...collectReceipt, nestedCallId: 'call-b' } } }))
  expect(other.freezeBusinessFailure(new Error('collected task failed')).dispatch).toBeNull()

  // The frozen snapshot survives the two upload projections.
  const dispatchDir = join(directory, 'dispatch-upload')
  mkdirSync(dispatchDir, { recursive: true })
  writeFileSync(join(dispatchDir, 'installed.json'),
    JSON.stringify({ passed: false, businessFailure: frozen, error: { name: 'AssertionError', message: 'collected task failed' } }))
  const document = uploadDocument({ passed: false, phase: 'probe-installed',
    evidence: fixtureEvidenceFor(dispatchDir, 'probe-installed'), facts: { phase: 'probe-installed' }, original: 'node failed' })
  expect(document.installed.businessFailure.dispatch).toMatchObject({ ordinal: 1, callId: 'call-7' })
  expect(document.installed.businessFailure.dispatch.receipt.jobId).toBe('bash-7')
  expect(document.installed.businessFailure.native.kind).toBe('promoted')
  expect(document.installed.businessFailure.nestedContent).toEqual(['collect failed'])
}, 20000)

test('a throwing diagnostic accessor is recorded without changing the returned result', async () => {
  const report = join(directory, 'guard.json')
  const evidence = createProbeEvidence({ report })
  // The accessor exists only for a diagnostic field: reading it must never
  // replace the result the product already produced.
  const value: Record<string, unknown> = { receipt: { outcome: 'failed', exitCode: 7 } }
  Object.defineProperty(value, 'nestedContent', {
    enumerable: true,
    get() { throw new Error('diagnostic accessor exploded') },
  })
  const result = { isError: false, value }
  expect(await evidence.observe('tool', { tool: 'synthetic_guard', callId: 'call-guard', ordinal: 1 },
    async () => result)).toBe(result)
  expect(result.value).toBe(value)
  expect(evidence.diagnosticFailures.some(row => row.includes('remember tool call'))).toBe(true)
  expect(evidence.diagnosticFailures.some(row => row.includes('diagnostic accessor exploded'))).toBe(true)

  // The native layer behaves the same way, and its raw value is still returned.
  const nativeValue: Record<string, unknown> = { exitCode: 1 }
  Object.defineProperty(nativeValue, 'stderr', {
    enumerable: true,
    get() { throw new Error('native accessor exploded') },
  })
  expect(await evidence.observe('native', { tool: 'bash', callId: 'call-guard-native' },
    async () => nativeValue)).toBe(nativeValue)
  expect(evidence.diagnosticFailures.some(row => row.includes('remember native call'))).toBe(true)
  expect(evidence.diagnosticFailures.some(row => row.includes('native accessor exploded'))).toBe(true)

  // The canonical stream shape reads `.text`: when that accessor throws, the call
  // still returns its own value and only a diagnostic failure is recorded.
  const streamValue: Record<string, unknown> = { exitCode: 1 }
  Object.defineProperty(streamValue, 'stderr', {
    enumerable: true,
    get() { return { get text() { throw new Error('stream accessor exploded') } } },
  })
  expect(await evidence.observe('native', { tool: 'bash', callId: 'call-guard-stream' },
    async () => streamValue)).toBe(streamValue)
  expect(evidence.diagnosticFailures.some(row => row.includes('remember native call'))).toBe(true)
  expect(evidence.diagnosticFailures.some(row => row.includes('stream accessor exploded'))).toBe(true)
})

test('keeps actual zero and false values and preserves an earlier summary when a diagnostic passes', async () => {
  const report = join(directory, 'diagnostic.json')
  const first = createProbeEvidence({ report })
  await first.run(async () => { throw new Error('original evidence') })
  const original = readFileSync(report, 'utf8')
  const host = { installation: { root: 'synthetic-selected-project' } }
  const next = createProbeEvidence({ report, hostEvidence: host })
  await next.run(async evidence => {
    const value = { exitCode: 0, timedOut: false, signal: null, workdir: 'reported-by-fixture', stdout: 'x'.repeat(4096) }
    expect(await evidence.observe('native', { tool: 'synthetic' }, async () => value)).toBe(value)
    return { passed: true }
  })
  expect(readFileSync(report, 'utf8')).toBe(original)
  expect(JSON.parse(readFileSync(join(next.directory, 'result.json'), 'utf8')).passed).toBe(true)
  const rows = records(next.directory)
  expect(rows[0].selectedHost).toEqual(host)
  expect(rows.find(row => row.kind === 'native-return').returned).toMatchObject({
    exitCode: 0, timedOut: false, signal: null, workdir: 'reported-by-fixture', stdout: 'x'.repeat(2048),
  })
})
