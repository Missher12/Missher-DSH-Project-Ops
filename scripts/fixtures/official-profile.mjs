// Test-only consumer loaded by the official dsh Profile; never shipped in the plugin archive.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createProbeEvidence, runGuardedCleanup, settleRun } from './probe-evidence.mjs'

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
  evidence.setBusinessStage('activation')
  assert.equal(names.length, 9)
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
  let afterNative = () => {}
  // The tool call the native shell call was dispatched from; the evidence pair
  // needs that relation, and a driver-side ordinal is not a substitute for it.
  let enclosingToolCallId
  const nativeShell = { ...originalShell, async execute(args, exec) {
    const value = await evidence.observe('native', {
      tool: shell, callId: exec.callId ?? 'unavailable',
      parentCallId: enclosingToolCallId ?? 'unavailable', requestedWorkdir: args.workdir ?? 'unavailable',
    }, () => originalShell.execute(args, exec))
    afterNative(value, exec)
    return value
  } }
  const removeNativeObserver = owner.ctx.tools.register(nativeShell)
  let sequence = 0
  const result = (name, args, agent = owner) => {
    // The ordinal is this fixture's own call counter, so a tool call can be
    // named without borrowing any driver-side number.
    const ordinal = ++sequence
    const callId = ToolCallId(`profile-probe-${ordinal}`)
    enclosingToolCallId = callId
    return evidence.observe('tool', { tool: name, callId, ordinal, taskId: args.taskId ?? 'unavailable',
      requestedWorkdir: args.workdir ?? 'unavailable' }, () => ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      name, arguments: args, agent, callId, signal,
    }))).finally(() => { enclosingToolCallId = undefined })
  }
  const call = async (name, args, agent = owner) => {
    const response = await result(name, args, agent)
    assert.equal(response.isError, false, JSON.stringify(response.content))
    return response.value
  }
  const checks = []
  /** First business exception; cleanup must never replace it. */
  let failure
  /** Success value, settled only after cleanup has run. `result` above is the call helper. */
  let probeReport
  try {
    const development = await call('missher_project_ops_document_write', { action: 'begin', slug: 'profile-acceptance', data: { title: 'Profile acceptance', requirements: 'Real Host document persistence', design: 'Native filesystem', steps: ['write', 'review'], acceptance: ['files on disk'], progress: 'started' } })
    assert(existsSync(join(config.workspace, development.planPath)))
    checks.push('development-plan-real-file')
    const doctor = await call('missher_project_ops_doctor', {})
    assert.equal(doctor.sourceSnapshot, true)
    assert.equal(doctor.foreground, true)
    evidence.setBusinessStage('task-planning')
    const planArgs = { changedFiles: ['packages/app/input.js'], goal: 'verify' }
    const plan = await call('missher_project_ops_task_plan', planArgs)
    const task = plan.tasks.find(row => row.id === 'package@packages/app:verify')
    assert(task)
    const runArgs = { taskId: task.id, manifestDigest: task.manifestDigest }
    evidence.setBusinessStage('declared-workspace-execution')
    let ran = await call('missher_project_ops_task_run', runArgs)
    if (ran.receipt.outcome === 'running') {
      outstanding.add(ran.receipt.jobId)
      const r = ran.receipt
      ran = await call('missher_project_ops_task_collect', { taskId: r.taskId, manifestDigest: r.manifestDigest, jobId: r.jobId, nestedCallId: r.nestedCallId, startedAt: r.startedAt, waitMs: 10000 })
      outstanding.delete(r.jobId)
    }
    assert.equal(ran.receipt.outcome, 'succeeded')
    const verifiedFile = existsSync(join(config.workspace, 'packages/app/.output/verified'))
    evidence.record('verified-file', { exists: verifiedFile })
    assert(verifiedFile)
    const gateArgs = { ...planArgs, planDigest: plan.planDigest, receipts: [ran.receipt] }
    assert.equal((await call('missher_project_ops_verification_gate', gateArgs)).verdict, 'passed')
    checks.push('declared-workspace-execution', 'verification-passed')
    evidence.setBusinessStage('development-ready-real-file')
    const delivery = await call('missher_project_ops_document_write', { action: 'finish', taskId: development.taskId, expectedRevision: development.revision, verification: gateArgs, data: { implementation: 'Profile writes PLAN and READY', checks: [{ criterion: 'files on disk', status: 'reported-pass', evidence: 'Node filesystem read-back in isolated workspace' }], artifacts: [development.planPath], git: 'not committed', release: 'not released', installation: 'isolated profile only', limitations: ['No real model or native Desktop'], rollback: 'remove isolated profile' } })
    assert(delivery.readyValid)
    assert(delivery.verification.includes('passed'))
    assert(readFileSync(join(config.workspace, delivery.readyPath), 'utf8').includes('not released'))
    assert.equal((await result('missher_project_ops_document_write', { action: 'update', taskId: development.taskId, expectedRevision: delivery.revision, data: {} }, stranger)).isError, true)
    checks.push('development-ready-real-file', 'development-session-fence')

    // Wrap the already-visible official shell definition in this Agent's scope; execute its real body.
    const message = createUserMessage({ content: [{ type: 'text', text: 'Profile fixture context.' }],
      source: { kind: 'plugin', plugin: name } })
    evidence.setBusinessStage('nested-context-and-conclusion')
    afterNative = (_value, exec) => { exec.deferContext(message); exec.concludeTurn() }
    const forwarded = await result('missher_project_ops_task_run', runArgs)
    afterNative = () => {}
    assert.equal(forwarded.isError, false)
    assert.deepEqual(forwarded.additionalContexts, [message])
    assert.equal(forwarded.concludesTurn, true)
    let forwardedOutcome = forwarded.value.receipt.outcome
    if (forwardedOutcome === 'running') {
      const r = forwarded.value.receipt
      outstanding.add(r.jobId)
      forwardedOutcome = (await call('missher_project_ops_task_collect', { taskId: r.taskId, manifestDigest: r.manifestDigest, jobId: r.jobId, nestedCallId: r.nestedCallId, startedAt: r.startedAt, waitMs: 10000 })).receipt.outcome
      outstanding.delete(r.jobId)
    }
    assert.equal(forwardedOutcome, 'succeeded')
    checks.push('nested-context-and-conclusion')

    // Remove the marker the earlier successful run really produced, so the deny
    // is proven by the native side effect staying absent — an outcome field
    // alone could not distinguish "denied" from "ran and failed differently".
    const verifyMarker = join(config.workspace, 'packages/app/.output/verified')
    assert(existsSync(verifyMarker))
    rmSync(verifyMarker, { force: true })
    assert(!existsSync(verifyMarker))
    evidence.setBusinessStage('native-policy-denied')
    const reject = owner.ctx.on('tools/pre-execute', (exec, next) => exec.name === shell
      ? { kind: 'deny', reason: 'Profile fixture denies the next native shell call.' } : next())
    const denied = await call('missher_project_ops_task_run', runArgs)
    reject()
    assert.notEqual(denied.receipt.outcome, 'succeeded')
    assert(!existsSync(verifyMarker), 'the denied native call still produced its marker')
    assert.equal((await call('missher_project_ops_verification_gate', gateArgs)).verdict, 'stale')
    checks.push('native-policy-denied', 'denied-call-produced-no-side-effect', 'old-success-cannot-hide-new-failure')

    evidence.setBusinessStage('background-wait')
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
    const heartbeat = join(config.workspace, 'packages/app/.output/heartbeat')
    const settledHeartbeat = existsSync(heartbeat) ? readFileSync(heartbeat, 'utf8') : 'absent'
    await delay(300, undefined, { signal })
    assert.equal(existsSync(heartbeat) ? readFileSync(heartbeat, 'utf8') : 'absent', settledHeartbeat)
    evidence.record('cancelled-producer-heartbeat', { stoppedAcrossMs: 300, namespacePid: pid, hostPidProbe: 'not-applicable: sandbox PID namespaces' })
    outstanding.delete(receipt.jobId)
    checks.push('background-wait', 'foreign-owner-denied', 'native-cancel-settled-and-heartbeat-stopped')

    evidence.setBusinessStage('foreground-promotion-retains-native-job')
    let timeoutResult
    afterNative = value => { timeoutResult = value }
    // Explicit foreground: promotion must come from the Host's own foreground
    // timeout, not from the background-first `auto` path.
    const timeoutRequest = { taskId: long.id, manifestDigest: long.manifestDigest, mode: 'foreground' }
    const timed = await call('missher_project_ops_task_run', timeoutRequest)
    afterNative = () => {}
    assert.equal(timeoutResult.kind, 'promoted')
    assert.equal(timed.receipt.outcome, 'running')
    assert.equal(timed.receipt.executionMode, 'background')
    outstanding.add(timed.receipt.jobId)
    await call('job_kill', { job_id: timed.receipt.jobId })
    const promoted = timed.receipt
    const stopped = await call('missher_project_ops_task_collect', { taskId: promoted.taskId, manifestDigest: promoted.manifestDigest, jobId: promoted.jobId, nestedCallId: promoted.nestedCallId, startedAt: promoted.startedAt, waitMs: 10000 })
    assert.equal(stopped.receipt.outcome, 'aborted')
    outstanding.delete(promoted.jobId)
    checks.push('foreground-promotion-retains-native-job', 'promoted-job-cancelled')
    // Two independent invalidations, each with its OWN fresh baseline. Sharing
    // one baseline would make the second assertion true for the first reason
    // already, which is a false positive rather than coverage.
    /**
     * Run one planned task and settle it to a terminal receipt (auto may promote).
     * The task is mandatory: falling back to an earlier plan's task would let a
     * disappeared task keep producing receipts against a plan nobody re-read.
     */
    const runToTerminal = async target => {
      const dispatched = await call('missher_project_ops_task_run', { taskId: target.id, manifestDigest: target.manifestDigest })
      if (dispatched.receipt.outcome !== 'running') return dispatched.receipt
      const job = dispatched.receipt
      outstanding.add(job.jobId)
      const settled = (await call('missher_project_ops_task_collect', { taskId: job.taskId, manifestDigest: job.manifestDigest,
        jobId: job.jobId, nestedCallId: job.nestedCallId, startedAt: job.startedAt, waitMs: 10000 })).receipt
      outstanding.delete(job.jobId)
      return settled
    }

    // (1) source invalidation: a fresh receipt and a passed gate, then one edit.
    // The plan is re-read here: writing PLAN/READY already changed the source
    // tree, so the first plan's digest would fail the baseline gate for a reason
    // that has nothing to do with the edit under test.
    evidence.setBusinessStage('source-change-baseline')
    const sourcePlan = await call('missher_project_ops_task_plan', planArgs)
    const sourceTask = sourcePlan.tasks.find(row => row.id === task.id)
    assert(sourceTask !== undefined, 'the verify task is missing from the re-read plan before the source-change baseline')
    const sourceReceipt = await runToTerminal(sourceTask)
    assert.equal(sourceReceipt.outcome, 'succeeded')
    const sourceGateArgs = { ...planArgs, planDigest: sourcePlan.planDigest, receipts: [sourceReceipt] }
    assert.equal((await call('missher_project_ops_verification_gate', sourceGateArgs)).verdict, 'passed')
    checks.push('fresh-receipt-passes-before-source-change')
    writeFileSync(join(config.workspace, 'packages/app/input.js'), 'export const changed = true\n')
    const sourceStale = await call('missher_project_ops_verification_gate', sourceGateArgs)
    assert.equal(sourceStale.verdict, 'stale')
    assert(sourceStale.reasonCodes.includes('plan-digest-mismatch'))
    checks.push('source-edit-invalidates-receipt')

    // (2) configuration invalidation: restore the source, re-plan and re-run to a
    // new fresh receipt first — the previous one is already stale by now.
    writeFileSync(join(config.workspace, 'packages/app/input.js'), 'export const changed = false\n')
    evidence.setBusinessStage('config-change-baseline')
    const replanned = await call('missher_project_ops_task_plan', planArgs)
    const replannedTask = replanned.tasks.find(row => row.id === task.id)
    assert(replannedTask !== undefined, 'the verify task is missing from the re-read plan before the config-change baseline')
    const configReceipt = await runToTerminal(replannedTask)
    assert.equal(configReceipt.outcome, 'succeeded')
    const configGateArgs = { ...planArgs, planDigest: replanned.planDigest, receipts: [configReceipt] }
    assert.equal((await call('missher_project_ops_verification_gate', configGateArgs)).verdict, 'passed')
    checks.push('fresh-receipt-passes-before-config-change')
    // The configuration file the snapshot covers (`.npmrc`), not the task's own
    // manifest: the receipt must go stale because the authorized input tree it
    // was produced against changed.
    writeFileSync(join(config.workspace, '.npmrc'), 'ignore-scripts=true\n')
    const configStale = await call('missher_project_ops_verification_gate', configGateArgs)
    assert.equal(configStale.verdict, 'stale')
    assert(configStale.reasonCodes.includes('execution-evidence-stale'))
    checks.push('config-snapshot-invalidates-a-fresh-receipt')

    probeReport = { passed: true, phase: 'installed', tools: names, guidance: true, checks,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      timeout: { requestedMode: timeoutRequest.mode, kind: timeoutResult.kind, receiptOutcome: timed.receipt.outcome },
      modelProjection: { contexts: forwarded.additionalContexts.map(row => ({ role: row.role, source: row.source, content: row.content })),
        concludesTurn: forwarded.concludesTurn, outcome: forwardedOutcome } }
  } catch (error) {
    // Freeze first: cleanup runs in `finally` and may produce activity of its
    // own, and an expected deny/rejection earlier in the run must not be read as
    // this failure's context.
    evidence.freezeBusinessFailure(error)
    evidence.recordError('check-error', error)
    failure = error
  } finally {
    // Each step is guarded by the shared helper: every one runs, the business
    // exception is preserved, and cleanup failures are recorded beside it.
    await runGuardedCleanup([
      ['remove native observer', () => { removeNativeObserver() }],
      ...[...outstanding].flatMap(id => [
        [`kill job ${id}`, () => { ctx.jobs.kill(id, owner.session.id) }],
        [`wait job ${id}`, () => ctx.jobs.wait(id, 10000, owner.session.id)],
      ]),
      ...handles.slice().reverse().map(handle => ['dispose agent handle', () => handle.dispose()]),
    ], (label, error) => evidence.noteCleanupError(label, error))
    if (failure === undefined && evidence.cleanupErrors.length > 0) {
      evidence.recordError('cleanup-error', new Error(evidence.cleanupErrors.join('; ')))
    }
  }
  // One settle point: a success that leaves cleanup failures behind is not a pass.
  return settleRun(probeReport, failure, evidence.cleanupErrors)
}
