// Validation host only. This native executor is not shipped as a plugin fallback.
import { execFile } from 'node:child_process'
import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from 'cordis'

// The driver passes the package name it verified from the archive manifest, so
// this fixture never hardcodes (or guesses) a package name or scope.
const packageName = process.env.PROJECT_OPS_PACKAGE_NAME
if (typeof packageName !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
  throw new Error('PROJECT_OPS_PACKAGE_NAME must be set to the verified archive package name')
}
const ProjectOps = await import(`${packageName}/cordis`)

const workspace = process.argv[2]
const run = promisify(execFile)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
await mkdir(workspace, { recursive: true })
await writeFile(join(workspace, 'package.json'), JSON.stringify({ packageManager: 'npm@10', scripts: { test: 'node -e "console.log(123)"' } }))
await writeFile(join(workspace, 'input.js'), 'export const n = 1\n')
const signal = new AbortController().signal
const reader = {
  async readCandidate(name) { try { return await readFile(join(workspace, name)) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
  async lockfiles() { return [] },
  async listDirectories(path) { return (await readdir(join(workspace, path), { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name) },
}
const sourceReader = {
  async entries(path) { return (await readdir(join(workspace, path), { withFileTypes: true })).map(row => ({ name: row.name, type: row.isFile() ? 'file' : row.isDirectory() ? 'directory' : 'unsupported' })) },
  async read(path, maxBytes) { const stat = await lstat(join(workspace, path)); if (!stat.isFile() || stat.size > maxBytes) throw new Error('unsupported input'); return readFile(join(workspace, path)) },
}
const tools = new Map()
let policyDenied = false
let dispatches = 0
const host = {
  apiVersion: 1,
  signal: () => signal,
  scope: call => ({ identity: `${call.owner}:${workspace}`, reader, snapshot: abort => ProjectOps.sourceSnapshot(sourceReader, abort) }),
  capabilities: () => ({ host: 'validation-cordis-host', version: '1', foreground: true, background: false, cancellation: true }),
  async execute(task, args, call) {
    assert(call.owner === 'owner', 'native owner denied')
    assert(task.invocation.kind === 'package' && task.invocation.manager === 'npm', 'unsupported declared invocation')
    assert(args.mode !== 'background', 'no native background support')
    const startedAt = new Date().toISOString()
    let outcome = 'blocked'; let output = ''
    if (!policyDenied) {
      dispatches++
      const result = await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', task.invocation.script], {
        cwd: workspace, signal, timeout: 10000, maxBuffer: 1024 * 1024,
        shell: process.platform === 'win32',
      })
      output = result.stdout
      outcome = 'succeeded'
    }
    return { nestedContent: [{ type: 'text', text: output }], receipt: { receiptVersion: 2, taskId: task.id, source: task.source,
      workspace: task.workspace, purpose: task.purpose, manifestDigest: task.manifestDigest,
      executionMode: 'foreground', executorTool: 'validation-native-exec', nestedCallId: `native-${dispatches}`, startedAt,
      durationMs: Date.now() - Date.parse(startedAt), outcome, ...outcome === 'succeeded' ? { exitCode: 0 } : {} } }
  },
  bind(service) {
    tools.set('task_plan', (call, args) => service.plan(call, args))
    tools.set('task_run', (call, args) => service.run(call, args))
    tools.set('gate', (call, args) => service.gate(call, args))
    return () => tools.clear()
  },
}
const ctx = new Context()
const adapter = await ctx.plugin(inner => { inner.provide('projectOpsHost', host) })
const plugin = await ctx.plugin(ProjectOps)
try {
  assert(tools.size === 3, 'adapter did not expose native tools')
  const owner = { owner: 'owner' }
  const args = { changedFiles: ['input.js'], goal: 'verify' }
  const plan = await tools.get('task_plan')(owner, args)
  const task = plan.tasks[0]
  const result = await tools.get('task_run')(owner, { taskId: task.id, manifestDigest: task.manifestDigest })
  result.receipt = Object.fromEntries(Object.entries(result.receipt).reverse())
  assert(result.receipt.outcome === 'succeeded' && dispatches === 1, 'native task did not execute exactly once')
  assert((await tools.get('gate')(owner, { ...args, planDigest: plan.planDigest, receipts: [result.receipt] })).verdict === 'passed', 'bound evidence did not pass')
  await writeFile(join(workspace, 'input.js'), 'export const n = 2\n')
  assert((await tools.get('gate')(owner, { ...args, planDigest: plan.planDigest, receipts: [result.receipt] })).verdict === 'stale', 'source edit did not invalidate receipt')
  policyDenied = true
  const denied = await tools.get('task_run')(owner, { taskId: task.id, manifestDigest: task.manifestDigest })
  assert(denied.receipt.outcome === 'blocked' && dispatches === 1, 'host denial was bypassed')
  const service = ctx.get('projectOps')
  await plugin.dispose()
  assert(!ctx.get('projectOps') && tools.size === 0, 'service or tools survived disposal')
  let disposed = false
  try { await service.list(owner) } catch { disposed = true }
  assert(disposed, 'disposed service remained callable')
  const reloaded = await ctx.plugin(ProjectOps)
  assert((await tools.get('gate')(owner, { ...args, planDigest: plan.planDigest, receipts: [result.receipt] })).verdict === 'stale', 'reload accepted old execution')
  await reloaded.dispose()
  console.log('portable-cordis: PASS real Cordis 4.0.0-rc.9, no Harness dependencies, native fixture execution, source freshness, policy denial, disposal/reload')
} finally {
  await plugin.dispose()
  await adapter.dispose()
}
