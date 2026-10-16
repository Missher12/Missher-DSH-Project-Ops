// Instrumentation-only synthetic host; the child process really exits 7. Not a Harness acceptance run.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { apply } from '../../scripts/fixtures/official-profile.mjs'

const report = process.argv[2]
// Test-only knobs. This synthetic child always declares its own platform instead
// of inheriting the machine it runs on: `win-diag*` modes behave as win32 so the
// fixture's Windows diagnostic path is reachable anywhere, and every other mode
// behaves as linux so the non-Windows skip path stays deterministic on a Windows
// CI host as well. This is the fixture's synthesized test platform only — neither
// the product nor the fixture carries a platform switch, and a real Host is never
// affected.
const mode = process.argv[3] ?? ''
const winMode = mode.startsWith('win-diag')
Object.defineProperty(process, 'platform', { value: winMode ? 'win32' : 'linux', configurable: true })
const calls = { diagnostic: [], jobs: [] }
const callsPath = join(dirname(report), `${basename(report)}.diag-calls.json`)
const flush = () => { try { writeFileSync(callsPath, JSON.stringify(calls, null, 2)) } catch { /* evidence only */ } }
let firstAgent
let start
let finish
const done = new Promise(resolve => { finish = resolve })
// The directory the failed native call ran in. `win-diag` modes use the task's own
// directory (packages/app), which is deliberately different from the workspace
// root, so the fixture's workdir classification is exercised faithfully.
const nativeCwd = winMode ? join(dirname(report), 'packages', 'app') : dirname(report)
if (winMode) mkdirSync(nativeCwd, { recursive: true })
let native = { name: 'bash', async execute() {
  if (mode === 'throw') throw new Error('intentional native execution error')
  const child = spawnSync(process.execPath, ['-e', 'console.error("intentional fixture exit"); process.exit(7)'], {
    cwd: nativeCwd, encoding: 'utf8', timeout: 5000,
  })
  if (child.error) throw child.error
  // `object-stream` mode: the Host's canonical shell result reports each stream as
  // `{ text, truncated, spillPath? }`. The long synthetic text only exercises the
  // bounded forensic budget and the scrubbing order — it is NOT a claim that the
  // real Windows root cause sits at any particular offset. The separator `|`
  // keeps the path replacement from swallowing the credential that follows it,
  // and the spill path must never reach the upload.
  if (process.argv[3] === 'object-stream') {
    const stderrText = `${'a'.repeat(600)}${'b'.repeat(300)}LONG-TEXT-MARKER`
      + ' | /home/fixture-user/projects/fixture-project/private/pwsh.log'
      + ' | Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload'
      + ` | ${'c'.repeat(400)}`
    return { exitCode: child.status, signal: child.signal,
      stderr: { text: stderrText, truncated: true,
        spillPath: '/home/fixture-user/projects/fixture-project/private/spill.txt' },
      stdout: { text: 'o'.repeat(400), truncated: false } }
  }
  return { exitCode: child.status, signal: child.signal, stderr: child.stderr }
} }
const scopedTools = { register(tool) { const previous = native; native = tool; return () => { native = previous } } }
const ctx = {
  get() { return undefined },
  effect(fn) { fn() },
  appReady: { onReady(fn) { start = fn } },
  appExit(code) { finish(code) },
  agents: {
    async create() {
      const owner = firstAgent === undefined
      const agent = { id: `synthetic-${owner ? 'owner' : 'other'}`,
        session: { id: owner ? 'synthetic-owner-session' : 'synthetic-other-session' },
        ctx: { tools: scopedTools } }
      if (owner) firstAgent = agent
      return { agent, async dispose() {} }
    },
    withInitiator(_agent, fn) { return fn() },
  },
  jobs: {
    kill(id, caller) { calls.jobs.push({ op: 'kill', id, caller: caller ?? null }); flush(); return { ok: true } },
    async wait(id, ms, caller) {
      calls.jobs.push({ op: 'wait', id, caller: caller ?? null }); flush()
      return { id, status: 'killed' }
    },
    get(id) { return { id, status: 'killed' } },
  },
  tools: {
    schemas: () => Array.from({ length: 9 }, (_, i) => ({ name: `missher_project_ops_${i}` })),
    get: () => native,
    async execute(exec) {
      let value
      if (String(exec.callId) === 'profile-probe-startup-diagnostic') {
        // The diagnostic asks the same tool boundary for a bounded probe; this
        // synthetic host answers per mode and records what it was asked for.
        calls.diagnostic.push({ callId: String(exec.callId), workdir: exec.arguments?.workdir ?? null,
          agentIsOwner: exec.agent === firstAgent, commandLength: String(exec.arguments?.command ?? '').length })
        flush()
        if (mode === 'win-diag-throw') throw new Error('diagnostic transport exploded')
        if (mode === 'win-diag-job') return { isError: false, value: { jobId: 'synthetic-job-1', kind: 'promoted' }, content: [] }
        if (mode === 'win-diag-late-job') {
          // Resolves after the fixture's hard deadline, so only the late handler
          // can clean the job up.
          await new Promise(resolve => setTimeout(resolve, 21000))
          return { isError: false, value: { jobId: 'synthetic-late-job', kind: 'promoted' }, content: [] }
        }
        const payload = { protocol: 1,
          powershell: { version: '7.4.6', edition: 'Core', dotnet: '8.0.10' },
          npm: { type: 'ExternalScript', shim: 'npm.ps1', rule: 'block-match-sibling-exe', prefixLines: 11 },
          candidate: { basename: 'node.exe', source: 'shim-sibling-exe', pathDigest: 'a'.repeat(64),
            matchesHostExecPath: true, exists: true, isFile: true, readable: true },
          cwd: { expectedMatches: true, accessible: true },
          start: { attempted: true, started: false, exitCode: null, stdoutLength: null, stderrLength: null,
            timedOut: false, killed: null, cleanupSettled: null, skippedReason: null,
            error: { win32: true, type: 'Win32Exception', nativeErrorCode: 5, hresult: -2147467259,
              message: `denied at /home/fixture-user/projects/fixture-project/node.exe ${'m'.repeat(600)}`,
              // The same exception's bounded throw site: an illegal name and a repeat are
              // present on purpose, and must not survive the two projections.
              site: { targetSite: 'CreatePipeWithSecurityAttributes',
                processMethods: ['StartCore', 'CreatePipeWithSecurityAttributes', 'CreatePipe',
                  'NotARealProcessMethod', 'StartCore', 'CreateExceptionForErrorStartingProcess'] } } } }
        const marker = 'PROJECT_OPS_STARTUP_DIAGNOSTIC='
        const line = mode === 'win-diag-badjson' ? `${marker}{not json`
          : mode === 'win-diag-oversize' ? `${marker}${'x'.repeat(9000)}`
            : mode === 'win-diag-unsupported' ? `${marker}{"protocol":2}`
              : `${marker}${JSON.stringify(payload)}`
        return { isError: false, value: { exitCode: 0, stdout: line }, content: [] }
      }
      if (exec.name.endsWith('document_write')) { writeFileSync(join(dirname(report), 'fixture-PLAN.md'), 'instrumentation fixture'); value = { planPath: 'fixture-PLAN.md' } }
      else if (exec.name.endsWith('doctor')) value = { sourceSnapshot: true, foreground: true }
      else if (exec.name.endsWith('task_plan')) value = { tasks: [{ id: 'package@packages/app:verify', manifestDigest: 'fixture' }] }
      else {
        const returned = await native.execute({ workdir: nativeCwd }, { callId: 'synthetic-native-call' })
        value = { receipt: { outcome: 'failed', exitCode: returned.exitCode } }
        // `nested` mode: the product's real shell/Jobs error text lives in
        // value.nestedContent. Two blocks are kept and capped; the third block and
        // any credential or machine path inside them must not survive the upload.
        if (process.argv[3] === 'nested') {
          value.nestedContent = [
            { type: 'text', text: `shell failed at /home/fixture-user/projects/fixture-project/private/out.log\nAuthorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload` },
            { type: 'text', text: 'second bounded block' },
            { type: 'text', text: 'third block must be dropped' },
          ]
        }
      }
      return { isError: false, value, content: [] }
    },
  },
  systemPrompt: { async assemble() { return { sections: [{ name: 'missher-project-ops:agent-guidance' }] } } },
}
apply(ctx, { report, workspace: dirname(report) })
start()
process.exitCode = await done
