import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { JobId, type JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { ToolCallId, type ContentBlock, type ToolSchema } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ProjectTask } from './contracts.ts'
import type { ProjectOpsHost, RunArgs, CollectArgs, ExecutionResult } from './project-ops.ts'
import { MAX_MANIFEST_BYTES, type ManifestReader } from './task-discovery.ts'
import { sourceSnapshot, type SourceReader } from './source-snapshot.ts'
import { commandFor, createJobReceipt, createReceipt, type ExecutorTool, type ReceiptResult } from './task-execution.ts'
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

function schemaFor(ctx: Context, owner: Agent | undefined, name: string): ToolSchema | undefined {
  return ctx.tools.schemas(owner).find(schema => schema.name === name)
}

function parameterProperties(schema: ToolSchema | undefined): Record<string, unknown> {
  return record(schema?.parameters.properties) ?? {}
}

function supportsBackground(ctx: Context, owner: Agent | undefined, executor: ExecutorTool): boolean {
  return Object.hasOwn(parameterProperties(schemaFor(ctx, owner, executor)), 'run_in_background')
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
  return value?.kind === 'background' && typeof value.jobId === 'string' ? value.jobId : undefined
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
  const nestedCallId = ToolCallId(`${exec.callId}:project-ops:1`)
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  if (executorTool === undefined) {
    const receipt = createReceipt({ task, nestedCallId, startedAt, durationMs: Date.now() - startedAtMs })
    return {
      nestedContent: [{ type: 'text', text: 'No platform shell tool is visible to this Agent.' }] as unknown as JsonValue[],
      receipt,
    }
  }

  const backgroundAvailable = supportsBackground(ctx, exec.agent, executorTool)
  if (mode === 'background' && !backgroundAvailable) throw new Error('background execution is unavailable for the visible shell tool')
  const background = mode !== 'foreground' && backgroundAvailable
  const command = commandFor(task, executorTool)
  if (task.workspace !== '.' && !Object.hasOwn(parameterProperties(schemaFor(ctx, exec.agent, executorTool)), 'workdir')) {
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

  if (!background) {
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

  const jobId = backgroundJobId(result)
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
  let snapshot: JobSnapshot
  let output = ''
  if (mode === 'auto') {
    snapshot = await ctx.jobs.wait(JobId(jobId), waitMs, exec.agent, exec.signal)
    const read = ctx.jobs.read(JobId(jobId), exec.agent)
    snapshot = read.snapshot
    output = read.text
  } else {
    snapshot = ctx.jobs.get(JobId(jobId), exec.agent)
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
  const executorTool = executorFor(ctx, exec.agent)
  if (executorTool === undefined) throw new Error('No platform shell tool is visible to this Agent.')
  const id = JobId(args.jobId)
  ctx.jobs.get(id, exec.agent)
  if (args.waitMs !== undefined) await ctx.jobs.wait(id, args.waitMs, exec.agent, exec.signal)
  const snapshot = ctx.jobs.get(id, exec.agent)
  if (snapshot.kind !== executorTool || snapshot.label !== commandFor(task, executorTool)) {
    throw new Error('background job does not belong to the declared project task')
  }
  const read = ctx.jobs.read(id, exec.agent)
  const receipt = createJobReceipt({
    task,
    executorTool,
    nestedCallId: args.nestedCallId,
    jobId: args.jobId,
    startedAt: args.startedAt,
    durationMs: Date.now() - startedAtMs,
    snapshot: read.snapshot,
    output: read.text,
  })
  return {
    nestedContent: [{ type: 'text', text: read.text === '' ? '(no new job output)' : read.text }] as unknown as JsonValue[],
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
      const cwd = sessionCwd(call)
      if (!call.agent?.id) throw new Error('Project Ops requires an owning Agent')
      const root = await ctx.fs.resolve('.', { cwd, signal: call.signal })
      return { identity: JSON.stringify([call.agent.id, ctx.fs.processPath(root)]),
        reader: new HarnessManifestReader(ctx.fs, cwd),
        snapshot: signal => sourceSnapshot(new HarnessSourceReader(ctx.fs, cwd), signal,
          { outputDirectories: config.snapshotOutputDirectories ?? [] }) }
    },
    capabilities(call) {
      const executor = executorFor(ctx, call.agent)
      return { host: 'deepseek-harness', version: 'unknown', foreground: executor !== undefined,
        background: executor !== undefined && supportsBackground(ctx, call.agent, executor),
        cancellation: ctx.tools.get('job_kill', call.agent) !== undefined }
    },
    execute: (task, args, call) => executeTask(ctx, task, args, call),
    collect: (task, args, call) => collectTask(ctx, task, args, call),
    tools: call => ctx.tools.schemas(call.agent).map(tool => ({ source: 'tool', id: `tool:${tool.name}`, name: tool.name, description: tool.description })),
    async cancel(receipt, call) {
      if (!receipt.jobId) throw new Error('execution has no native background job')
      const result = await ctx.tools.execute({ callId: ToolCallId(`${call.callId}:project-ops:cancel`), rootCallId: call.rootCallId,
        name: 'job_kill', arguments: { job_id: receipt.jobId }, agent: call.agent!, parent: call.token, signal: call.signal })
      forwardNestedResult(result, call)
      if (result.isError) throw new Error('native cancellation failed')
    },
  }
}
