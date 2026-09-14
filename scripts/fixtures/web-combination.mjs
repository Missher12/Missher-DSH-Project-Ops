// Real public Web Profile consumer. No Agent turns or model requests are needed for this probe.
import assert from 'node:assert/strict'
import { createProbeEvidence } from './probe-evidence.mjs'

export const name = 'project-ops-web-combination-probe'
export const inject = ['appReady', 'appExit', 'agents', 'agentPresets', 'tools', 'llm', 'systemPrompt', 'missherMemory', 'missherMemoryService', 'missherMemoryCore', 'missherEvolution']

/** Match the public Web session controller's resolve + factory setup composition. */
export async function createWebProbeAgent(ctx, sessionId, workspace) {
  const preset = await ctx.agentPresets.resolve(undefined)
  return ctx.agents.create({ sessionId, meta: { cwd: workspace, agentPreset: preset.id },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash' },
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset.id) } })
}

export function apply(ctx, config) {
  let modelRequests = 0
  ctx.on('llm/stream', () => { modelRequests++; throw new Error('Combination probe forbids model requests') })
  const abort = new AbortController()
  let pending
  ctx.effect(() => ctx.appReady.onReady(() => {
    pending = createProbeEvidence(config).run(evidence => probe(ctx, config, evidence, abort.signal, () => modelRequests))
    void pending.then(report => ctx.appExit(report.passed ? 0 : 1), error => {
      console.error('Combination evidence failure', error)
      ctx.appExit(1)
    })
  }))
  ctx.effect(() => async () => { abort.abort(); await pending?.catch(() => {}) })
}

async function probe(ctx, config, evidence, signal, requestCount) {
  const { ToolCallId } = await import(config.llmEntry)
  const tools = ctx.tools.schemas().map(tool => tool.name)
  const sections = (await ctx.systemPrompt.assemble()).sections.map(section => section.name)
  const present = config.phase === 'all'
  const counts = {
    projectOps: tools.filter(name => name.startsWith('missher_project_ops_')).length,
    memorySearch: tools.filter(name => name === 'memory_search').length,
    projectOpsGuidance: sections.filter(name => name === 'missher-project-ops:agent-guidance').length,
    evolutionGuidance: sections.filter(name => name === 'missher-evolution:agent-guidance').length,
    memoryGuidance: sections.filter(name => name.startsWith('missher-memory:')).length,
  }
  evidence.record('registrations', { counts, tools, sections, memoryGuidanceContract: 'tool description only; no standalone section' })
  assert.equal(new Set(tools).size, tools.length)
  assert.equal(counts.projectOps, present ? 7 : 0)
  assert.equal(counts.memorySearch, 1)
  assert.equal(counts.projectOpsGuidance, present ? 1 : 0)
  assert.equal(counts.evolutionGuidance, 1)
  assert.equal(counts.memoryGuidance, 0)
  assert.equal(ctx.get('projectOps') !== undefined, present)
  assert.equal(ctx.get('missherBrain'), undefined)
  assert(ctx.get('missherEvolutionCore'))
  const evolution = await ctx.missherEvolution.snapshot()
  evidence.record('evolution-status', evolution)
  assert.equal(evolution.enabled, true)
  const handle = await createWebProbeAgent(ctx, `web-combination-${config.phase}`, config.workspace)
  const agent = handle.agent
  const shell = process.platform === 'win32' ? 'pwsh' : 'bash'
  const native = ctx.tools.get(shell, agent)
  evidence.record('agent-preset-tools', { preset: agent.session.header.agentPreset, tools: ctx.tools.schemas(agent).map(tool => tool.name), nativeVisible: native !== undefined })
  if (!native) { await handle.dispose(); throw new Error(`default Web preset has no visible ${shell}`) }
  const remove = agent.ctx.tools.register({ ...native, execute: (args, exec) => evidence.observe('native', {
    tool: shell, callId: exec.callId, requestedWorkdir: args.workdir ?? 'unavailable',
  }, () => native.execute(args, exec)) })
  let sequence = 0
  const call = async (name, args) => {
    const callId = ToolCallId(`web-combination-${config.phase}-${++sequence}`)
    const result = await evidence.observe('tool', { tool: name, callId }, () => ctx.agents.withInitiator(agent,
      () => ctx.tools.execute({ name, arguments: args, agent, callId, signal })))
    assert.equal(result.isError, false)
    return result.value
  }
  try {
    let gate = 'not-applicable-after-removal'
    if (present) {
      const planArgs = { changedFiles: ['packages/app/input.js'], goal: 'verify' }
      const plan = await call('missher_project_ops_task_plan', planArgs)
      const task = plan.tasks.find(task => task.id === 'package@packages/app:verify')
      assert(task)
      const result = await call('missher_project_ops_task_run', { taskId: task.id, manifestDigest: task.manifestDigest, mode: 'foreground' })
      assert.equal(result.receipt.outcome, 'succeeded')
      assert.equal(result.receipt.exitCode, 0)
      const verification = await call('missher_project_ops_verification_gate', { ...planArgs, planDigest: plan.planDigest, receipts: [result.receipt] })
      assert.equal(verification.verdict, 'passed')
      gate = verification.verdict
      await ctx.missherMemoryCore.noteCwd(config.workspace)
      const candidate = await ctx.missherMemory.snapshot()
      const bound = await ctx.missherMemory.bindProject({ candidateId: candidate.projectCandidate.candidateId, sourceIds: [] })
      evidence.record('memory-bound', bound)
      assert.equal(bound.project.captureEnabled, true)
      assert.equal(bound.project.recallEnabled, true)
      const draft = await ctx.missherMemoryService.project(config.workspace).propose({ sourceId: 'web-combination-fixture', drafts: [
        { scope: 'project', kind: 'architecture', content: 'Architecture triplewidget isolated combination evidence.' },
      ] })
      assert.equal(draft.status, 'created')
      await ctx.missherMemoryService.admin(config.workspace).approve(draft.candidateIds[0])
    }
    const memory = await ctx.missherMemory.snapshot()
    evidence.record('memory-status', memory)
    assert.equal(memory.project.captureEnabled, true)
    assert.equal(memory.project.recallEnabled, true)
    const search = await call('memory_search', { query: 'triplewidget', scope: 'project' })
    assert.equal(search.status, 'ready')
    assert.equal(search.results.length, 1)
    assert(search.results[0].excerpt.includes('triplewidget'))
    const afterEvolution = await ctx.missherEvolution.snapshot()
    evidence.record('cross-check', { memoryReference: search.results[0].reference, evolution: afterEvolution, modelRequests: requestCount() })
    assert.equal(afterEvolution.enabled, true)
    assert.equal(requestCount(), 0)
    return { passed: true, phase: config.phase, counts, gate, memoryReference: search.results[0].reference,
      evolution: afterEvolution, memoryFlags: { capture: memory.project.captureEnabled, recall: memory.project.recallEnabled },
      modelRequests: requestCount(), runtime: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch },
      limits: ['no Agent turns; automatic capture/learning efficacy untested', 'no Brain or automatic memory recall', 'not Electron or final Desktop/native acceptance'] }
  } finally { remove(); await handle.dispose() }
}
