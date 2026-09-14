// Test-only consumer loaded by the official dsh Profile; never shipped in the plugin archive.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createProbeEvidence } from './probe-evidence.mjs'

export const name = 'project-ops-official-profile-probe'
export const inject = ['appReady', 'appExit', 'agents', 'agentLoop', 'tools', 'jobs', 'systemPrompt']

export function apply(ctx, config) {
  const abort = new AbortController()
  let pending
  ctx.effect(() => ctx.appReady.onReady(() => {
    pending = createProbeEvidence(config).run(evidence => probe(ctx, config, abort.signal, evidence))
    void pending.then(report => {
      ctx.appExit(report.passed ? 0 : 1)
    }, error => {
      console.error('Profile evidence could not be persisted:', error)
      ctx.appExit(1)
    })
  }))
  ctx.effect(() => async () => { abort.abort(); await pending?.catch(() => {}) })
}

async function probe(ctx, config, signal, evidence) {
  const names = ctx.tools.schemas().map(tool => tool.name).filter(name => name.startsWith('missher_project_ops_')).sort()
  const prompt = await ctx.systemPrompt.assemble()
  evidence.record('activation', { tools: names, servicePresent: ctx.get('projectOps') !== undefined,
    guidance: prompt.sections.some(section => section.name === 'missher-project-ops:agent-guidance') })
  if (config.removed) {
    assert.deepEqual(names, [])
    assert.equal(ctx.get('projectOps'), undefined)
    assert.equal(prompt.sections.some(section => section.name === 'missher-project-ops:agent-guidance'), false)
    return { passed: true, phase: 'removed', tools: [], guidance: false,
      runtime: { node: process.version, platform: process.platform, arch: process.arch } }
  }
  assert.equal(names.length, 7)
  assert(prompt.sections.some(section => section.name === 'missher-project-ops:agent-guidance'))
  const handles = []
  const outstanding = new Set()
  const create = async sessionId => {
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: config.workspace },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash' } })
    handles.push(handle)
    return handle.agent
  }
  const owner = await create('project-ops-profile-owner')
  const stranger = await create('project-ops-profile-stranger')
  const shell = process.platform === 'win32' ? 'pwsh' : 'bash'
  const originalShell = ctx.tools.get(shell, owner)
  const nativeShell = { ...originalShell, execute: (args, exec) => evidence.observe('native', {
    tool: shell, callId: exec.callId ?? 'unavailable', requestedWorkdir: args.workdir ?? 'unavailable',
  }, () => originalShell.execute(args, exec)) }
  const removeNativeObserver = owner.ctx.tools.register(nativeShell)
  let sequence = 0
  const result = (name, args, agent = owner) => {
    const callId = ToolCallId(`profile-probe-${++sequence}`)
    return evidence.observe('tool', { tool: name, callId, taskId: args.taskId ?? 'unavailable',
      requestedWorkdir: args.workdir ?? 'unavailable' }, () => ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      name, arguments: args, agent, callId, signal,
    })))
  }
  const call = async (name, args, agent = owner) => {
    const response = await result(name, args, agent)
    assert.equal(response.isError, false, JSON.stringify(response.content))
    return response.value
  }
  const checks = []
  try {
    const doctor = await call('missher_project_ops_doctor', {})
    assert.equal(doctor.sourceSnapshot, true)
    assert.equal(doctor.foreground, true)
    const planArgs = { changedFiles: ['packages/app/input.js'], goal: 'verify' }
    const plan = await call('missher_project_ops_task_plan', planArgs)
    const task = plan.tasks.find(row => row.id === 'package@packages/app:verify')
    assert(task)
    const runArgs = { taskId: task.id, manifestDigest: task.manifestDigest }
    const ran = await call('missher_project_ops_task_run', runArgs)
    assert.equal(ran.receipt.outcome, 'succeeded')
    const verifiedFile = existsSync(join(config.workspace, 'packages/app/.output/verified'))
    evidence.record('verified-file', { exists: verifiedFile })
    assert(verifiedFile)
    const gateArgs = { ...planArgs, planDigest: plan.planDigest, receipts: [ran.receipt] }
    assert.equal((await call('missher_project_ops_verification_gate', gateArgs)).verdict, 'passed')
    checks.push('declared-workspace-execution', 'verification-passed')

    // Wrap the already-visible official shell definition in this Agent's scope; execute its real body.
    const message = createUserMessage({ content: [{ type: 'text', text: 'Profile fixture context.' }],
      source: { kind: 'plugin', plugin: name } })
    const removeWrapper = owner.ctx.tools.register({ ...nativeShell, async execute(args, exec) {
      const value = await nativeShell.execute(args, exec)
      exec.deferContext(message)
      exec.concludeTurn()
      return value
    } })
    const forwarded = await result('missher_project_ops_task_run', runArgs)
    removeWrapper()
    assert.equal(forwarded.isError, false)
    assert.deepEqual(forwarded.additionalContexts, [message])
    assert.equal(forwarded.concludesTurn, true)
    checks.push('nested-context-and-conclusion')

    const reject = owner.ctx.on('tools/pre-execute', (exec, next) => exec.name === shell
      ? { kind: 'deny', reason: 'Profile fixture denies the next native shell call.' } : next())
    const denied = await call('missher_project_ops_task_run', runArgs)
    reject()
    assert.notEqual(denied.receipt.outcome, 'succeeded')
    assert.equal((await call('missher_project_ops_verification_gate', gateArgs)).verdict, 'stale')
    checks.push('native-policy-denied', 'old-success-cannot-hide-new-failure')

    const listed = await call('missher_project_ops_task_list', {})
    const long = listed.tasks.find(task => task.name === 'long')
    const running = await call('missher_project_ops_task_run', {
      taskId: long.id, manifestDigest: long.manifestDigest, mode: 'auto', waitMs: 1,
    })
    assert.equal(running.receipt.outcome, 'running')
    outstanding.add(running.receipt.jobId)
    const pidFile = join(config.workspace, 'packages/app/.output/pid')
    const deadline = Date.now() + 10000
    while (!existsSync(pidFile) && Date.now() < deadline) await delay(25, undefined, { signal })
    evidence.record('background-readiness', { pidFile, exists: existsSync(pidFile) })
    assert(existsSync(pidFile), 'background producer never became ready')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    evidence.record('background-pid', { pid })
    assert(Number.isInteger(pid) && pid > 0)
    assert.equal((await result('job_kill', { job_id: running.receipt.jobId }, stranger)).isError, true)
    await call('job_kill', { job_id: running.receipt.jobId })
    const receipt = running.receipt
    const collected = await call('missher_project_ops_task_collect', {
      taskId: receipt.taskId, manifestDigest: receipt.manifestDigest, jobId: receipt.jobId,
      nestedCallId: receipt.nestedCallId, startedAt: receipt.startedAt, waitMs: 10000,
    })
    assert.equal(collected.receipt.outcome, 'aborted')
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    outstanding.delete(receipt.jobId)
    checks.push('background-wait', 'foreign-owner-denied', 'native-cancel-and-process-exit')

    let timeoutResult
    const removeTimeoutObserver = owner.ctx.tools.register({ ...nativeShell, async execute(args, exec) {
      timeoutResult = await nativeShell.execute(args, exec)
      return timeoutResult
    } })
    const timed = await call('missher_project_ops_task_run', { taskId: long.id, manifestDigest: long.manifestDigest })
    removeTimeoutObserver()
    assert.equal(timeoutResult.timedOut, true)
    // The unchanged receipt core classifies a termination signal as aborted, including timeout kills.
    assert(['failed', 'aborted'].includes(timed.receipt.outcome))
    checks.push('foreground-timeout')
    writeFileSync(join(config.workspace, 'packages/app/input.js'), 'export const changed = true\n')
    assert.equal((await call('missher_project_ops_verification_gate', gateArgs)).verdict, 'stale')
    checks.push('source-edit-invalidates-receipt')
    return { passed: true, phase: 'installed', tools: names, guidance: true, checks,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      timeout: { timedOut: timeoutResult.timedOut, signal: timeoutResult.signal, receiptOutcome: timed.receipt.outcome },
      modelProjection: { contexts: forwarded.additionalContexts.map(row => ({ role: row.role, source: row.source, content: row.content })),
        concludesTurn: forwarded.concludesTurn, outcome: forwarded.value.receipt.outcome } }
  } catch (error) {
    evidence.recordError('check-error', error)
    throw error
  } finally {
    removeNativeObserver()
    for (const id of outstanding) {
      ctx.jobs.kill(id, owner)
      await ctx.jobs.wait(id, 10000, owner)
    }
    for (const handle of handles.reverse()) await handle.dispose()
  }
}
