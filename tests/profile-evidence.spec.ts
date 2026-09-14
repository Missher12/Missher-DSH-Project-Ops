import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { createProbeEvidence } from '../scripts/fixtures/probe-evidence.mjs'

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
}, 20000)

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
