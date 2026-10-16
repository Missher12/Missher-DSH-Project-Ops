import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { createProbeEvidence } from '../scripts/fixtures/probe-evidence.mjs'
import { fixtureEvidenceFor, uploadDocument } from '../scripts/fixtures/driver-diagnostics.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const evidenceRoot = join(root, '.artifacts/r7-instrumentation')
mkdirSync(evidenceRoot, { recursive: true })
const directory = mkdtempSync(join(evidenceRoot, 'test-'))
const execute = (report: string, mode?: string) => spawnSync(process.execPath,
  [join(root, 'tests/fixtures/profile-evidence-failure.mjs'), report, ...mode ? [mode] : []],
  { cwd: root, encoding: 'utf8', timeout: 15000 })
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
}, 35000)

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
