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

/** Save each invocation before its caller can assert on the result; retain errors without changing them. */
export function createProbeEvidence(config) {
  const parent = join(dirname(config.report), 'attempts')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(join(parent, config.removed ? 'removed-' : 'installed-'))
  let sequence = 0
  const save = (filename, value) => writeFileSync(join(directory, filename), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  const record = (kind, value) => save(`${String(sequence++).padStart(4, '0')}-${kind}.json`,
    { kind, recordedAt: new Date().toISOString(), ...value })
  record('start', { runtime: { node: process.version, executable: process.execPath,
    platform: process.platform, arch: process.arch, processCwd: process.cwd() },
    sessionWorkspace: config.workspace ?? unavailable, selectedHost: config.hostEvidence ?? unavailable,
    nativeProcessRuntime: unavailable, intendedSummary: config.report })
  return {
    directory, record,
    recordError(kind, error) { record(kind, { error: errorSummary(error) }) },
    async observe(layer, details, invoke) {
      record(`${layer}-call`, details)
      let result
      try { result = await invoke() }
      catch (error) {
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
        record('probe-error', { error: errorSummary(error) })
        result = { passed: false, error: errorSummary(error) }
      }
      const report = { ...result, attemptDirectory: directory }
      save('result.json', report)
      try { writeFileSync(config.report, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }) }
      catch (error) {
        // The first summary belongs to the first attempt; later attempts retain their own result.json.
        if (error.code !== 'EEXIST') throw error
      }
      return report
    },
  }
}
