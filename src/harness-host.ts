import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { JobId, JobView } from '@deepseek-ai/dsh-jobs'
import type { ContentBlock, ToolCallId, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ProjectTask } from './contracts.ts'
import type { ProjectOpsHost, RunArgs, CollectArgs, ExecutionResult } from './project-ops.ts'
import { MAX_MANIFEST_BYTES, type ManifestReader } from './task-discovery.ts'
import { sourceSnapshot, type SourceReader } from './source-snapshot.ts'
import { commandFor, createJobReceipt, createReceipt, type ExecutorTool, type ReceiptResult } from './task-execution.ts'
/**
 * Identity brands.
 *
 * `JobId`/`ToolCallId` are documented brand helpers whose whole body is
 * `return id` (verified byte-identical in `dsh-jobs` 0.2.0-rc.2 and
 * 0.2.1-alpha.2). Importing them as VALUES would make our node half fail to
 * load on a Host that does not ship `dsh-jobs` at all — before any capability
 * detection could report the background half as disabled — so the brand is
 * applied locally and only the type is imported.
 */
const brandJobId = (value: string): JobId => value as JobId
const brandToolCallId = (value: string): ToolCallId => value as ToolCallId

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb']

/** Preserve official composite-tool control metadata on the enclosing result. */
function forwardNestedResult(result: ToolExecutionResult, exec: ToolRunContext): void {
  for (const context of result.additionalContexts ?? []) exec.deferContext(context)
  if (!result.isError && result.concludesTurn) exec.concludeTurn()
}
class HarnessManifestReader implements ManifestReader {
  constructor(
    private readonly fs: FileSystem,
    private readonly cwd: string,
  ) {}

  async readCandidate(name: string, signal?: AbortSignal): Promise<Uint8Array | undefined> {
    const pathInfo = await this.fs.lstat(name, { cwd: this.cwd }, signal)
    if (pathInfo?.type === 'symlink') throw new Error('symlink task manifests and configuration are unsupported')
    if (pathInfo === undefined || pathInfo.type !== 'file') return undefined
    if (pathInfo.size !== undefined && pathInfo.size > MAX_MANIFEST_BYTES) {
      return new Uint8Array(MAX_MANIFEST_BYTES + 1)
    }
    const target = await this.fs.resolve(name, {
      cwd: this.cwd,
      ...signal === undefined ? {} : { signal },
    })
    const root = await this.fs.resolve('.', { cwd: this.cwd, ...signal === undefined ? {} : { signal } })
    if (!this.fs.contains(root, target)) return undefined
    return this.fs.readBytes(target, signal, MAX_MANIFEST_BYTES)
  }

  async lockfiles(signal?: AbortSignal): Promise<readonly string[]> {
    const found: string[] = []
    for (const name of LOCKFILES) {
      const info = await this.fs.lstat(name, { cwd: this.cwd }, signal)
      if (info?.type === 'file') found.push(name)
    }
    return found
  }

  async listDirectories(path: string, signal?: AbortSignal): Promise<readonly string[]> {
    const pathInfo = await this.fs.lstat(path, { cwd: this.cwd }, signal)
    if (pathInfo?.type !== 'directory') return []
    const root = await this.fs.resolve('.', { cwd: this.cwd, ...signal === undefined ? {} : { signal } })
    const directory = await this.fs.resolve(path, { cwd: this.cwd, ...signal === undefined ? {} : { signal } })
    if (!this.fs.contains(root, directory)) return []
    const entries = await this.fs.listDir(directory, signal)
    const names: string[] = []
    for (const entry of entries) {
      if (entry.type !== 'directory' || !this.fs.contains(root, entry.target)) continue
      const candidate = path === '.' ? entry.name : `${path}/${entry.name}`
      const info = await this.fs.lstat(candidate, { cwd: this.cwd }, signal)
      if (info?.type === 'directory') names.push(entry.name)
    }
    return names
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function sessionCwd(exec: ToolRunContext): string {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') throw new Error('Project Ops requires an owning Agent Session cwd')
  return cwd
}

async function taskWorkdir(ctx: Context, cwd: string, task: ProjectTask, signal?: AbortSignal): Promise<string> {
  const root = await ctx.fs.resolve('.', { cwd, ...signal === undefined ? {} : { signal } })
  const directory = await ctx.fs.resolve(task.workspace, { cwd, ...signal === undefined ? {} : { signal } })
  if (!ctx.fs.contains(root, directory)) throw new Error('project task workspace escaped the Session cwd')
  return ctx.fs.processPath(directory)
}

function executorFor(ctx: Context, owner: Agent | undefined): ExecutorTool | undefined {
  const selected: ExecutorTool = process.platform === 'win32' ? 'pwsh' : 'bash'
  return ctx.tools.get(selected, owner) === undefined ? undefined : selected
}

/**
 * The native Jobs service, or `undefined` on a Host that does not provide it.
 *
 * `jobs` is deliberately NOT in this plugin's cordis `inject` map: a plugin
 * inject entry is a hard activation requirement in cordis 4.x, so declaring it
 * would stop the whole plugin from loading on a Host without Jobs instead of
 * disabling only the background half of Project Ops.
 */
function jobsOf(ctx: Context): Context['jobs'] | undefined {
  return ctx.get('jobs') as Context['jobs'] | undefined
}

/** Method names Project Ops actually calls on each native service. */
const FS_METHODS = ['lstat', 'resolve', 'contains', 'readBytes', 'listDir', 'processPath', 'stat'] as const
const TOOLS_METHODS = ['schemas', 'get', 'execute', 'register'] as const
const JOBS_METHODS = ['get', 'read', 'wait'] as const

/** Which of `members` a live service does not expose as callable functions. */
function missingMethods(service: unknown, members: readonly string[]): string[] {
  if (typeof service !== 'object' || service === null) return [...members]
  const face = service as Record<string, unknown>
  return members.filter(member => typeof face[member] !== 'function')
}

/** Native capabilities actually observed on this Host, and why anything is missing. */
interface HostSurface {
  shell: ExecutorTool | undefined
  /** Methods missing from the FileSystem service; empty when it is fully usable. */
  fsMissing: string[]
  /** Methods missing from the tool registry; empty when it is fully usable. */
  toolsMissing: string[]
  /** Methods missing from the Jobs service, or every method when it is absent. */
  jobsMissing: string[]
  jobKill: boolean
  backgroundParameter: boolean
  workdirParameter: boolean
}

function surfaceFor(ctx: Context, owner: Agent | undefined): HostSurface {
  // Probe first, call second: every service method is reached only after its
  // own signature is known to be callable, so a reduced Host produces an
  // accurate capability report instead of a TypeError on the way to it.
  const fsMissing = missingMethods(ctx.get('fs'), FS_METHODS)
  const toolsMissing = missingMethods(ctx.get('tools'), TOOLS_METHODS)
  const jobsMissing = missingMethods(ctx.get('jobs'), JOBS_METHODS)
  const registryUsable = toolsMissing.length === 0
  const shell = registryUsable ? executorFor(ctx, owner) : undefined
  const properties = shell === undefined || !registryUsable ? {} : parameterProperties(schemaFor(ctx, owner, shell))
  return {
    shell,
    fsMissing,
    toolsMissing,
    jobsMissing,
    jobKill: registryUsable && ctx.tools.get('job_kill', owner) !== undefined,
    backgroundParameter: Object.hasOwn(properties, 'run_in_background'),
    workdirParameter: Object.hasOwn(properties, 'workdir'),
  }
}

/** True when the Jobs service can serve collection and outcome snapshots. */
function jobsUsable(surface: HostSurface): boolean {
  return surface.jobsMissing.length === 0
}

/** Why background execution is unavailable, named precisely enough to act on. */
function backgroundReason(surface: HostSurface): string {
  if (surface.shell === undefined) return 'no platform shell tool is visible to this Agent'
  if (!surface.backgroundParameter) return `the visible ${surface.shell} tool does not expose run_in_background`
  if (surface.jobsMissing.length > 0) {
    return surface.jobsMissing.length === JOBS_METHODS.length
      ? 'this Host does not expose the native Jobs service (dsh-jobs)'
      : `this Host's Jobs service does not expose ${surface.jobsMissing.join(', ')}`
  }
  return 'background execution is unavailable'
}

/** Core services Project Ops cannot operate without, when one is not fully usable. */
function coreReason(surface: HostSurface): string | undefined {
  if (surface.fsMissing.length > 0) return `this Host's FileSystem service does not expose ${surface.fsMissing.join(', ')}`
  if (surface.toolsMissing.length > 0) return `this Host's tool registry does not expose ${surface.toolsMissing.join(', ')}`
  return undefined
}

/** Capability notes surfaced through the doctor tool; empty when nothing is degraded. */
function surfaceNotes(surface: HostSurface): string[] {
  const notes: string[] = []
  const core = coreReason(surface)
  if (core !== undefined) notes.push(`project task discovery and documents are unavailable: ${core}`)
  if (surface.shell === undefined) notes.push('no platform shell tool is visible to this Agent; foreground execution is unavailable')
  else if (!surface.backgroundParameter) notes.push(`background execution is disabled: ${backgroundReason(surface)}`)
  else if (surface.jobsMissing.length > 0) notes.push(`background execution, collection and cancellation are disabled: ${backgroundReason(surface)}`)
  if (surface.shell !== undefined && !surface.jobKill) notes.push('cancellation is disabled: the visible job_kill tool is unavailable')
  return notes
}

function schemaFor(ctx: Context, owner: Agent | undefined, name: string): ToolSchema | undefined {
  return ctx.tools.schemas(owner).find(schema => schema.name === name)
}

function parameterProperties(schema: ToolSchema | undefined): Record<string, unknown> {
  return record(schema?.parameters.properties) ?? {}
}

function shellArguments(
  ctx: Context,
  owner: Agent | undefined,
  executor: ExecutorTool,
  command: string,
  workdir: string,
  background: boolean,
): Record<string, JsonValue> {
  const properties = parameterProperties(schemaFor(ctx, owner, executor))
  return {
    command,
    ...Object.hasOwn(properties, 'description') ? { description: 'Run declared project task' } : {},
    ...Object.hasOwn(properties, 'workdir') ? { workdir } : {},
    ...background ? { run_in_background: true } : {},
  }
}

function backgroundJobId(result: ReceiptResult): string | undefined {
  if (result.isError) return undefined
  const value = record(result.value)
  return (value?.kind === 'background' || value?.kind === 'promoted') && typeof value.jobId === 'string' ? value.jobId : undefined
}

function jobContent(output: string, fallback: readonly ContentBlock[]): ContentBlock[] {
  return output === '' ? [...fallback] : [{ type: 'text', text: output }]
}

async function executeTask(ctx: Context, task: ProjectTask, args: RunArgs, exec: ToolRunContext): Promise<ExecutionResult> {
  const mode = args.mode ?? 'foreground'
  const waitMs = args.waitMs ?? 3_000
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 10_000) throw new Error('waitMs must be an integer from 1 through 10000')
  const cwd = sessionCwd(exec)
  const executorTool = executorFor(ctx, exec.agent)
  const nestedCallId = brandToolCallId(`${exec.callId}:project-ops:1`)
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  if (executorTool === undefined) {
    const receipt = createReceipt({ task, nestedCallId, startedAt, durationMs: Date.now() - startedAtMs })
    return {
      nestedContent: [{ type: 'text', text: 'No platform shell tool is visible to this Agent.' }] as unknown as JsonValue[],
      receipt,
    }
  }

  const surface = surfaceFor(ctx, exec.agent)
  const backgroundAvailable = surface.backgroundParameter && jobsUsable(surface)
  if (mode === 'background' && !backgroundAvailable) throw new Error(`background execution is unavailable: ${backgroundReason(surface)}`)
  // `auto` stays background-first: without the background half it still runs in
  // the foreground instead of failing, which is what the mode promises.
  const background = mode !== 'foreground' && backgroundAvailable
  const command = commandFor(task, executorTool)
  if (task.workspace !== '.' && !surface.workdirParameter) {
    throw new Error('visible shell cannot select a workspace workdir')
  }
  exec.signal.throwIfAborted()
  const workdir = await taskWorkdir(ctx, cwd, task, exec.signal)
  const result = await ctx.tools.execute({
    callId: nestedCallId,
    rootCallId: exec.rootCallId,
    name: executorTool,
    arguments: shellArguments(ctx, exec.agent, executorTool, command, workdir, background),
    ...exec.agent === undefined ? {} : { agent: exec.agent },
    parent: exec.token,
    signal: exec.signal,
  })
  forwardNestedResult(result, exec)

  const jobId = backgroundJobId(result)
  if (!background && jobId === undefined) {
    const receipt = createReceipt({
      task,
      executorTool,
      nestedCallId,
      startedAt,
      durationMs: Date.now() - startedAtMs,
      result,
    })
    return { nestedContent: [...result.content] as unknown as JsonValue[], receipt }
  }

  if (jobId === undefined) {
    const receipt = createReceipt({
      task,
      executorTool,
      nestedCallId,
      startedAt,
      durationMs: Date.now() - startedAtMs,
      executionMode: 'background',
      result,
    })
    return { nestedContent: [...result.content] as unknown as JsonValue[], receipt }
  }
  const jobs = jobsOf(ctx)
  if (!jobsUsable(surface) || jobs === undefined) {
    // The Host promoted (or already ran) the command as a native job. The job is
    // NOT ours to lose: the receipt keeps its id, the outcome stays `running`,
    // and the model is told precisely how to follow up. Nothing here claims the
    // background half succeeded.
    const receipt = createReceipt({
      task,
      executorTool,
      nestedCallId,
      startedAt,
      durationMs: Date.now() - startedAtMs,
      executionMode: 'background',
      result,
    })
    return {
      nestedContent: [
        { type: 'text', text: `The Host returned native background job ${jobId} for this task. ${backgroundReason(surface)}, so Project Ops cannot collect or cancel it; use the native job tools (job_output/job_kill) if this Host exposes them.` },
        ...result.content,
      ] as unknown as JsonValue[],
      receipt: { ...receipt, jobId, outcome: 'running' },
    }
  }
  let snapshot: JobView
  let output = ''
  if (mode === 'auto') {
    snapshot = await jobs.wait(brandJobId(jobId), waitMs, exec.agent?.session.id, exec.signal)
    const read = jobs.read(brandJobId(jobId), exec.agent?.session.id)
    snapshot = read.job
    output = read.chunks.map(chunk => chunk.text).join('') + (read.result ?? '')
  } else {
    snapshot = jobs.get(brandJobId(jobId), exec.agent?.session.id)
  }
  const receipt = createJobReceipt({
    task,
    executorTool,
    nestedCallId,
    jobId,
    startedAt,
    durationMs: Date.now() - startedAtMs,
    snapshot,
    output,
  })
  return {
    nestedContent: jobContent(output, result.content) as unknown as JsonValue[],
    receipt,
  }
}

async function collectTask(ctx: Context, task: ProjectTask, args: CollectArgs, exec: ToolRunContext): Promise<ExecutionResult> {
  if (args.jobId.trim() === '' || args.jobId.length > 128) throw new Error('jobId must contain 1 through 128 characters')
  if (args.nestedCallId.trim() === '' || args.nestedCallId.length > 512) throw new Error('nestedCallId must contain 1 through 512 characters')
  const startedAtMs = Date.parse(args.startedAt)
  if (!Number.isFinite(startedAtMs)) throw new Error('startedAt must be an ISO timestamp')
  if (args.waitMs !== undefined && (!Number.isInteger(args.waitMs) || args.waitMs < 1 || args.waitMs > 10_000)) {
    throw new Error('waitMs must be an integer from 1 through 10000')
  }
  const surface = surfaceFor(ctx, exec.agent)
  const executorTool = surface.shell
  if (executorTool === undefined) throw new Error('No platform shell tool is visible to this Agent.')
  const jobs = jobsOf(ctx)
  if (!jobsUsable(surface) || jobs === undefined) {
    throw new Error(`background collection is unavailable: ${backgroundReason(surface)}`)
  }
  const id = brandJobId(args.jobId)
  jobs.get(id, exec.agent?.session.id)
  if (args.waitMs !== undefined) await jobs.wait(id, args.waitMs, exec.agent?.session.id, exec.signal)
  const snapshot = jobs.get(id, exec.agent?.session.id)
  if (snapshot.kind !== executorTool || snapshot.label !== commandFor(task, executorTool)) {
    throw new Error('background job does not belong to the declared project task')
  }
  const read = jobs.read(id, exec.agent?.session.id)
  const receipt = createJobReceipt({
    task,
    executorTool,
    nestedCallId: args.nestedCallId,
    jobId: args.jobId,
    startedAt: args.startedAt,
    durationMs: Date.now() - startedAtMs,
    snapshot: read.job,
    output: read.chunks.map(chunk => chunk.text).join('') + (read.result ?? ''),
  })
  return {
    nestedContent: [{ type: 'text', text: (read.chunks.map(chunk => chunk.text).join('') + (read.result ?? '')) || '(no new job output)' }] as unknown as JsonValue[],
    receipt,
  }
}

class HarnessSourceReader implements SourceReader {
  constructor(private readonly fs: FileSystem, private readonly cwd: string) {}
  private async target(path: string, signal: AbortSignal) {
    const root = await this.fs.resolve('.', { cwd: this.cwd, signal })
    const target = await this.fs.resolve(path, { cwd: this.cwd, signal })
    if (!this.fs.contains(root, target)) throw new Error('source escaped project root')
    if ((await this.fs.lstat(path, { cwd: this.cwd }, signal))?.type === 'symlink') throw new Error('source symlink unsupported')
    return target
  }
  async entries(path: string, signal: AbortSignal) {
    const rows = await this.fs.listDir(await this.target(path, signal), signal)
    return Promise.all(rows.map(async row => {
      const info = await this.fs.lstat(path === '.' ? row.name : `${path}/${row.name}`, { cwd: this.cwd }, signal)
      return { name: row.name, type: info?.type === 'file' ? 'file' as const : info?.type === 'directory' ? 'directory' as const : 'unsupported' as const }
    }))
  }
  async read(path: string, maxBytes: number, signal: AbortSignal) {
    const info = await this.fs.lstat(path, { cwd: this.cwd }, signal)
    if (info?.type !== 'file' || (info.size !== undefined && info.size > maxBytes)) throw new Error('source file unavailable or too large')
    return this.fs.readBytes(await this.target(path, signal), signal, maxBytes)
  }
}

export interface HarnessConfig { snapshotOutputDirectories?: string[] }

export function createHarnessHost(ctx: Context, config: HarnessConfig = {}): ProjectOpsHost<ToolRunContext> {
  return {
    apiVersion: 1,
    signal: call => call.signal,
    async scope(call) {
      const core = coreReason(surfaceFor(ctx, call.agent))
      if (core !== undefined) throw new Error(`Project Ops cannot operate on this Host: ${core}`)
      const cwd = sessionCwd(call)
      if (!call.agent?.id) throw new Error('Project Ops requires an owning Agent')
      const root = await ctx.fs.resolve('.', { cwd, signal: call.signal })
      return { identity: JSON.stringify([call.agent.id, ctx.fs.processPath(root)]),
        reader: new HarnessManifestReader(ctx.fs, cwd),
        snapshot: signal => sourceSnapshot(new HarnessSourceReader(ctx.fs, cwd), signal,
          { outputDirectories: config.snapshotOutputDirectories ?? [] }) }
    },
    capabilities(call) {
      const surface = surfaceFor(ctx, call.agent)
      return { host: 'deepseek-harness', version: 'unknown', foreground: surface.shell !== undefined,
        background: surface.shell !== undefined && surface.backgroundParameter && jobsUsable(surface),
        cancellation: jobsUsable(surface) && surface.jobKill,
        notes: surfaceNotes(surface) }
    },
    execute: (task, args, call) => executeTask(ctx, task, args, call),
    collect: (task, args, call) => collectTask(ctx, task, args, call),
    tools: call => ctx.tools.schemas(call.agent).map(tool => ({ source: 'tool', id: `tool:${tool.name}`, name: tool.name, description: tool.description })),
    async cancel(receipt, call) {
      if (!receipt.jobId) throw new Error('execution has no native background job')
      const result = await ctx.tools.execute({ callId: brandToolCallId(`${call.callId}:project-ops:cancel`), rootCallId: call.rootCallId,
        name: 'job_kill', arguments: { job_id: receipt.jobId }, agent: call.agent!, parent: call.token, signal: call.signal })
      forwardNestedResult(result, call)
      if (result.isError) throw new Error('native cancellation failed')
    },
  }
}
