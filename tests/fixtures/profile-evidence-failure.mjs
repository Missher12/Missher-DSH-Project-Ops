// Instrumentation-only synthetic host; the child process really exits 7. Not a Harness acceptance run.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { apply } from '../../scripts/fixtures/official-profile.mjs'

const report = process.argv[2]
let start
let finish
const done = new Promise(resolve => { finish = resolve })
let native = { name: 'bash', async execute() {
  if (process.argv[3] === 'throw') throw new Error('intentional native execution error')
  const child = spawnSync(process.execPath, ['-e', 'console.error("intentional fixture exit"); process.exit(7)'], {
    cwd: dirname(report), encoding: 'utf8', timeout: 5000,
  })
  if (child.error) throw child.error
  return { exitCode: child.status, signal: child.signal, stderr: child.stderr }
} }
const scopedTools = { register(tool) { const previous = native; native = tool; return () => { native = previous } } }
const ctx = {
  get() { return undefined },
  effect(fn) { fn() },
  appReady: { onReady(fn) { start = fn } },
  appExit(code) { finish(code) },
  agents: {
    async create() { return { agent: { ctx: { tools: scopedTools } }, async dispose() {} } },
    withInitiator(_agent, fn) { return fn() },
  },
  tools: {
    schemas: () => Array.from({ length: 9 }, (_, i) => ({ name: `missher_project_ops_${i}` })),
    get: () => native,
    async execute(exec) {
      let value
      if (exec.name.endsWith('document_write')) { writeFileSync(join(dirname(report), 'fixture-PLAN.md'), 'instrumentation fixture'); value = { planPath: 'fixture-PLAN.md' } }
      else if (exec.name.endsWith('doctor')) value = { sourceSnapshot: true, foreground: true }
      else if (exec.name.endsWith('task_plan')) value = { tasks: [{ id: 'package@packages/app:verify', manifestDigest: 'fixture' }] }
      else {
        const returned = await native.execute({ workdir: dirname(report) }, { callId: 'synthetic-native-call' })
        value = { receipt: { outcome: 'failed', exitCode: returned.exitCode } }
      }
      return { isError: false, value, content: [] }
    },
  },
  systemPrompt: { async assemble() { return { sections: [{ name: 'missher-project-ops:agent-guidance' }] } } },
}
apply(ctx, { report, workspace: dirname(report) })
start()
process.exitCode = await done
