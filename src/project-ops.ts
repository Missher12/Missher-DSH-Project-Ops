import { createHash, randomUUID } from 'node:crypto'
import { rankCapabilities, type CapabilityCandidate } from './capability-ranking.ts'
import type { ExecutionReceipt, ProjectTask } from './contracts.ts'
import { discoverProjectTasks, type ManifestReader } from './task-discovery.ts'
import { createTaskPlan, type PlanGoal } from './task-planning.ts'
import { evaluateVerificationGate, latestReceipt } from './verification-gate.ts'

export interface ProjectScope {
  /** Opaque, stable identity including both owning session and canonical project root. Never model supplied. */
  identity: string
  reader: ManifestReader
  /** Must hash the authorized input tree; return undefined when coverage cannot be established. */
  snapshot?: (signal: AbortSignal) => Promise<string | undefined>
}
export interface RunArgs { taskId: string; manifestDigest: string; mode?: 'foreground' | 'background' | 'auto'; waitMs?: number }
export interface CollectArgs { taskId: string; manifestDigest: string; jobId: string; nestedCallId: string; startedAt: string; waitMs?: number }
export interface PlanArgs { changedFiles: string[]; goal: PlanGoal }
export interface GateArgs extends PlanArgs { planDigest: string; receipts: ExecutionReceipt[] }
export interface ExecutionResult { nestedContent: unknown[]; receipt: ExecutionReceipt }
export interface HostCapabilities { host: string; version: string; foreground: boolean; background: boolean; cancellation: boolean }

/** Trusted host bridge. All execution must retain native owner, policy, sandbox and cancellation context. */
export interface ProjectOpsHost<Call = unknown> {
  apiVersion: 1
  scope(call: Call): ProjectScope | Promise<ProjectScope>
  signal(call: Call): AbortSignal
  capabilities(call: Call): HostCapabilities
  execute?: (task: ProjectTask, args: RunArgs, call: Call) => Promise<ExecutionResult>
  collect?: (task: ProjectTask, args: CollectArgs, call: Call) => Promise<ExecutionResult>
  tools?: (call: Call) => readonly CapabilityCandidate[]
  /** Optional owner-checked native cancellation. No new scheduler or process controller. */
  cancel?: (receipt: ExecutionReceipt, call: Call) => Promise<void>
  /** Expose the service as native Agent tools/guidance. Must return their lifecycle disposer. */
  bind?: (service: ProjectOpsService<Call>) => (() => void)
}

interface Evidence {
  order: number
  dispatching: boolean
  scope: string
  task: ProjectTask
  before?: string
  receipts: ExecutionReceipt[]
}
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
// JSON object key order is not part of the receipt contract; optional undefined fields disappear in transit.
const receiptHash = (receipt: ExecutionReceipt) => sha(Object.entries(receipt)
  .filter(([, value]) => value !== undefined).sort(([left], [right]) => left.localeCompare(right, 'en')))

/** Shared execution policy; records correlation and evidence, never schedules or owns native jobs. */
export class ProjectOpsService<Call = unknown> {
  private readonly evidence = new Map<string, Evidence>()
  private active = true
  private inflight = 0
  private sequence = 0

  constructor(private readonly host: ProjectOpsHost<Call>) {
    if (host.apiVersion !== 1) throw new Error('unsupported Project Ops host API version')
  }

  dispose(): void { this.active = false; this.evidence.clear() }

  private async scope(call: Call): Promise<ProjectScope> {
    if (!this.active) throw new Error('Project Ops plugin is disposed')
    this.host.signal(call).throwIfAborted()
    const scope = await this.host.scope(call)
    if (!this.active) throw new Error('Project Ops plugin is disposed')
    if (!scope.identity) throw new Error('Project Ops requires an owning project identity')
    return scope
  }

  private async snapshot(scope: ProjectScope, call: Call): Promise<string | undefined> {
    try {
      const digest = await scope.snapshot?.(this.host.signal(call))
      return digest !== undefined && /^[a-f0-9]{64}$/u.test(digest) ? digest : undefined
    } catch {
      this.host.signal(call).throwIfAborted()
      return undefined
    }
  }

  async list(call: Call) {
    const scope = await this.scope(call)
    return discoverProjectTasks(scope.reader, this.host.signal(call))
  }

  async plan(call: Call, args: PlanArgs) {
    const scope = await this.scope(call)
    const found = await discoverProjectTasks(scope.reader, this.host.signal(call))
    const plan = createTaskPlan(found.tasks, args.changedFiles, args.goal, found.diagnostics)
    const sourceDigest = await this.snapshot(scope, call)
    return { ...plan, planDigest: sha([scope.identity, plan.planDigest, sourceDigest ?? null]),
      sourceDigest, snapshotStatus: sourceDigest === undefined ? 'unavailable' as const : 'available' as const }
  }

  private async task(call: Call, args: RunArgs): Promise<ProjectTask> {
    if (typeof args.taskId !== 'string' || args.taskId.trim() === '' || args.taskId.length > 256) throw new Error('invalid taskId')
    if (!/^[a-f0-9]{64}$/u.test(args.manifestDigest)) throw new Error('manifestDigest must be a lowercase SHA-256 digest')
    const discovered = await this.list(call)
    if (discovered.diagnostics.length) throw new Error('task discovery is incomplete; resolve diagnostics before execution')
    const task = discovered.tasks.find(row => row.id === args.taskId)
    if (!task) throw new Error('project task is not declared')
    if (task.manifestDigest !== args.manifestDigest) throw new Error('project task manifest changed; list tasks again')
    if (!task.runnable || !task.invocation) throw new Error('project task is not runnable')
    return task
  }

  private remember(id: string, entry: Evidence, receipt: ExecutionReceipt, after: string | undefined): ExecutionReceipt {
    const bound: ExecutionReceipt = { ...receipt, receiptVersion: 3, executionId: id,
      ...entry.before === undefined ? {} : { sourceDigest: entry.before },
      freshness: entry.before === undefined || after === undefined ? 'unavailable' : entry.before === after ? 'stable' : 'changed' }
    // A changed input tree can never regain freshness by restoring it before a later collect.
    if (entry.receipts.some(row => row.freshness === 'changed')) bound.freshness = 'changed'
    entry.receipts = [...entry.receipts.filter(row => row.outcome !== bound.outcome), structuredClone(bound)]
    if (this.active) this.evidence.set(id, entry)
    return bound
  }

  async run(call: Call, args: RunArgs): Promise<ExecutionResult> {
    const scope = await this.scope(call)
    if (!this.host.execute) throw new Error('native execution adapter unavailable')
    if (args.mode !== undefined && !['auto', 'foreground', 'background'].includes(args.mode)) throw new Error('invalid execution mode')
    if (args.waitMs !== undefined && (!Number.isInteger(args.waitMs) || args.waitMs < 1 || args.waitMs > 10000)) throw new Error('invalid waitMs')
    // Evict only settled evidence; native jobs and active bindings remain host owned.
    for (const [id, entry] of this.evidence) {
      if (this.evidence.size < 1024) break
      if (!entry.dispatching && entry.receipts.at(-1)?.outcome !== 'running') this.evidence.delete(id)
    }
    if (this.evidence.size + this.inflight >= 4096) throw new Error('Project Ops active evidence limit reached; collect native jobs')
    this.inflight++
    try {
      const before = await this.snapshot(scope, call)
      const task = await this.task(call, args)
      if (!this.active) throw new Error('Project Ops plugin is disposed')
      this.host.signal(call).throwIfAborted()
      const id = randomUUID()
      const entry: Evidence = { order: ++this.sequence, dispatching: true, scope: scope.identity, task, receipts: [], ...before === undefined ? {} : { before } }
      // Record the attempt before dispatch, so an old success cannot hide a newer in-flight/failed attempt.
      this.evidence.set(id, entry)
      try {
        const result = await this.host.execute(structuredClone(task), args, call)
        const after = await this.snapshot(scope, call)
        const receipt = this.remember(id, entry, result.receipt, after)
        return { nestedContent: result.nestedContent, receipt }
      } finally { entry.dispatching = false }
    } finally { this.inflight-- }
  }

  async collect(call: Call, args: CollectArgs): Promise<ExecutionResult> {
    const scope = await this.scope(call)
    if (!this.host.collect) throw new Error('native collection adapter unavailable')
    const pair = [...this.evidence].find(([, entry]) => entry.scope === scope.identity && entry.receipts.some(row =>
      row.taskId === args.taskId && row.manifestDigest === args.manifestDigest && row.jobId === args.jobId
      && row.nestedCallId === args.nestedCallId && row.startedAt === args.startedAt))
    if (!pair) throw new Error('background job does not belong to this Project Ops dispatch; use native Jobs after reload')
    const [id, entry] = pair
    // Collection must remain possible after source/config edits; freshness is checked separately.
    const result = await this.host.collect(structuredClone(entry.task), args, call)
    return { nestedContent: result.nestedContent, receipt: this.remember(id, entry, result.receipt, await this.snapshot(scope, call)) }
  }

  async gate(call: Call, args: GateArgs) {
    const scope = await this.scope(call)
    const plan = await this.plan(call, args)
    const gate = evaluateVerificationGate(plan, plan.tasks, args.receipts, args.planDigest)
    const newest = new Map<string, { id: string; order: number }>()
    for (const [id, entry] of this.evidence) {
      if (entry.scope === scope.identity && (newest.get(entry.task.id)?.order ?? 0) < entry.order) {
        newest.set(entry.task.id, { id, order: entry.order })
      }
    }
    const selected = plan.tasks.flatMap(task => {
      const receipt = latestReceipt(args.receipts.filter(row => row.taskId === task.id))
      return receipt ? [receipt] : []
    })
    const invalid = selected.filter(receipt => {
      const entry = receipt.executionId === undefined ? undefined : this.evidence.get(receipt.executionId)
      return receipt.receiptVersion !== 3 || !entry || entry.scope !== scope.identity
        || newest.get(receipt.taskId)?.id !== receipt.executionId
        || !entry.receipts.some(row => receiptHash(row) === receiptHash(receipt))
        || receipt.freshness !== 'stable' || !plan.sourceDigest || receipt.sourceDigest !== plan.sourceDigest
    })
    if (invalid.length || !plan.sourceDigest) {
      gate.verdict = 'stale'
      gate.reasonCodes.push(plan.sourceDigest ? 'execution-evidence-stale' : 'source-snapshot-unavailable')
      gate.staleTaskIds = [...new Set([...gate.staleTaskIds, ...invalid.map(row => row.taskId)])].sort()
    }
    return gate
  }

  async search(call: Call, query: string, limit = 5) {
    const found = await this.list(call)
    return { matches: rankCapabilities(query, [
      ...this.host.tools?.(call) ?? [],
      ...found.tasks.map(task => ({ source: 'project-task' as const, id: task.id, name: task.name, description: task.description })),
    ], limit) }
  }

  async doctor(call: Call) {
    const scope = await this.scope(call)
    const capabilities = this.host.capabilities(call)
    return { apiVersion: 1, ...capabilities, executionAdapter: this.host.execute !== undefined,
      collectionAdapter: this.host.collect !== undefined, sourceSnapshot: await this.snapshot(scope, call) !== undefined,
      runnerDependencies: 'unknown', guidance: 'Host must expose tools and load the packaged Agent contract.' }
  }

  async cancel(call: Call, executionId: string): Promise<void> {
    const scope = await this.scope(call)
    const entry = this.evidence.get(executionId)
    if (!entry || entry.scope !== scope.identity) throw new Error('unknown Project Ops execution')
    if (!this.host.cancel) throw new Error('use native host cancellation')
    await this.host.cancel(structuredClone(entry.receipts.at(-1)!), call)
  }
}
