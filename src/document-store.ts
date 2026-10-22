import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { DOCUMENT_LIMIT, TASK_DIRECTORY, decodePlan, digest, encodePlan, mergePlan, parsePlan, parseReport, encodeReady, recoverReady, type TaskRecord, type TaskStatus } from './task-documents.ts'

interface ObservedFile { target: FsTarget; content: string | undefined; version: FsVersion | undefined }
/** Filesystem operations use the Host provider, policy, observation guard, and atomic writes. */
export class DocumentStore {
  private busy = new Set<string>()
  constructor(private ctx: Context) {}
  private owner(exec: ToolRunContext) {
    const session = exec.agent?.session
    if (!session?.id || !session.header.cwd) throw new Error('Task documents require an owning Host Session and workspace')
    return { sessionId: session.id, cwd: session.header.cwd }
  }
  private async target(path: string, exec: ToolRunContext): Promise<FsTarget> {
    const { cwd } = this.owner(exec)
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const info = await this.ctx.fs.lstat(parts.slice(0, i).join('/'), { cwd }, exec.signal)
      if (info?.type === 'symlink') throw new Error('Task document paths must not contain symlinks')
    }
    const root = await this.ctx.fs.resolve('.', { cwd, signal: exec.signal })
    const target = await this.ctx.fs.resolve(path, { cwd, signal: exec.signal })
    if (!this.ctx.fs.contains(root, target)) throw new Error('Task document escaped Session workspace')
    return target
  }
  private path(taskId: string, file: 'PLAN.md' | 'READY.md'): string {
    if (!TASK_DIRECTORY.test(taskId)) throw new Error('Invalid task directory identifier')
    return `docs/tasks/${taskId}/${file}`
  }
  private async read(path: string, exec: ToolRunContext): Promise<ObservedFile> {
    const target = await this.target(path, exec)
    const before = await this.ctx.fs.stat(target, exec.signal)
    if (before === undefined) {
      this.ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
      return { target, content: undefined, version: undefined }
    }
    if (before.type !== 'file' || (before.size ?? 0) > DOCUMENT_LIMIT) throw new Error('Task document must be a regular file under 128 KiB')
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await this.ctx.fs.readBytes(target, exec.signal, DOCUMENT_LIMIT))
    if ((await this.ctx.fs.stat(target, exec.signal))?.version !== before.version) throw new Error('Task document changed during read; retry')
    this.ctx.emit('fs/observed', target, { kind: 'present', version: before.version }, exec)
    return { target, content, version: before.version }
  }
  private async write(path: string, content: string, before: ObservedFile, exec: ToolRunContext): Promise<void> {
    exec.signal.throwIfAborted()
    if (Buffer.byteLength(content) > DOCUMENT_LIMIT) throw new Error('Task document exceeds 128 KiB')
    const target = await this.target(path, exec)
    if (target.targetKey !== before.target.targetKey) throw new Error('Task path changed before write')
    if (before.content === content) return
    const expected: FsWriteIntent = before.version === undefined ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version: before.version }
    const policyIntent = await this.ctx.waterfall('fs/write-intent', target, exec, () => undefined)
    if (policyIntent !== undefined && JSON.stringify(policyIntent) !== JSON.stringify(expected)) throw new Error('Host file observation conflicts with document revision')
    const policy = this.ctx.get('sandboxPolicy')
    if (this.ctx.fs.sandboxMode !== undefined && policy === undefined) throw new Error('Confining filesystem requires Host sandboxPolicy')
    const outcome = await this.ctx.fs.writeText(target, content, expected, exec.signal, policy?.resolve({ session: exec.agent!.session }))
    this.ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
  }
  async list(exec: ToolRunContext) {
    const root = await this.target('docs/tasks', exec)
    if (await this.ctx.fs.stat(root, exec.signal) === undefined) return []
    const rows = await this.ctx.fs.listDir(root, exec.signal)
    if (rows.length > 1000) throw new Error('Task directory exceeds 1000 entries')
    const tasks = []
    for (const row of rows) {
      if (row.type !== 'directory' || !TASK_DIRECTORY.test(row.name)) continue
      try {
        const task = await this.get(row.name, exec)
        if (task.record.sessionId === this.owner(exec).sessionId) tasks.push(this.summary(task.record, task.readyValid))
      } catch (error) { tasks.push({ taskId: row.name, status: 'unavailable', error: error instanceof Error ? error.message : String(error) }) }
    }
    return tasks
  }
  async get(taskId: string, exec: ToolRunContext) {
    const plan = await this.read(this.path(taskId, 'PLAN.md'), exec)
    if (plan.content === undefined) throw new Error('Task PLAN not found')
    const record = decodePlan(plan.content)
    if (record.taskId !== taskId) throw new Error('PLAN directory identity mismatch')
    if (record.sessionId !== this.owner(exec).sessionId) throw new Error('Task belongs to another Host Session')
    const ready = await this.read(this.path(taskId, 'READY.md'), exec)
    const readyValid = record.delivery !== undefined && ready.content !== undefined && digest(ready.content) === record.delivery.readyHash
    return { record, plan, ready, readyValid }
  }
  summary(record: TaskRecord, readyValid = false) {
    return { taskId: record.taskId, title: record.plan.title, revision: record.revision, status: record.status, planPath: this.path(record.taskId, 'PLAN.md'), readyPath: readyValid ? this.path(record.taskId, 'READY.md') : null, verification: record.delivery?.verification ?? '未验证', readyValid }
  }
  async mutate<T>(key: string, exec: ToolRunContext, fn: () => Promise<T>): Promise<T> {
    const id = `${this.owner(exec).cwd}\0${key}`
    if (this.busy.has(id)) throw new Error('Task write already in progress; inspect and retry')
    this.busy.add(id)
    try { return await fn() } finally { this.busy.delete(id) }
  }
  async begin(slug: string, value: unknown, exec: ToolRunContext) {
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(slug)) throw new Error('slug must contain 1–48 lowercase letters, numbers, or hyphens')
    const owner = this.owner(exec)
    // The original Host call identifies creation. Retries of that call use the same directory.
    const suffix = digest(`${owner.sessionId}\0${exec.callId}`).slice(0, 16)
    const existing = (await this.list(exec)).find(row => row.taskId.endsWith(`-${suffix}`))
    const plan = parsePlan(value)
    if (existing) {
      const saved = await this.get(existing.taskId, exec)
      if (JSON.stringify(saved.record.plan) !== JSON.stringify(plan)) throw new Error('Creation call already exists with different content; use update')
      return this.summary(saved.record, saved.readyValid)
    }
    const created = new Date().toISOString()
    const taskId = `${created.slice(0, 10)}-${slug}-${suffix}`
    return this.mutate(taskId, exec, async () => {
      const record: TaskRecord = { format: 1, taskId, sessionId: owner.sessionId, originCallId: exec.callId, created, revision: 1, status: 'active', plan }
      const path = this.path(taskId, 'PLAN.md')
      const before = await this.read(path, exec)
      if (before.content !== undefined) throw new Error('Task directory already exists; inspect before retrying')
      await this.write(path, encodePlan(record), before, exec)
      return this.summary(record)
    })
  }
  async update(taskId: string, revision: number, value: unknown, status: TaskStatus, exec: ToolRunContext) {
    return this.mutate(taskId, exec, async () => {
      const saved = await this.get(taskId, exec)
      // The caller asked to update the revision it read: reject a stale revision
      // before merging or short-circuiting, so an old revision can never look
      // like a no-op success — even when the patch is empty or repeats values.
      if (saved.record.revision !== revision) throw new Error('Stale task revision; read current PLAN before updating')
      // A partial update merges over the record read right here.
      const plan = mergePlan(saved.record.plan, value)
      if (saved.record.status === status && JSON.stringify(saved.record.plan) === JSON.stringify(plan) && !saved.record.delivery) return this.summary(saved.record)
      if (saved.record.delivery && !saved.readyValid) throw new Error('READY manually edited or missing; preserve and reconcile it')
      const record: TaskRecord = { ...saved.record, plan, status, revision: revision + 1 }
      if (record.delivery) record.previousReadyHash = record.delivery.readyHash
      delete record.delivery
      // Old READY remains as historical evidence, but is no longer advertised as current.
      await this.write(this.path(taskId, 'PLAN.md'), encodePlan(record), saved.plan, exec)
      return this.summary(record)
    })
  }
  async finish(taskId: string, revision: number, value: unknown, verification: string, exec: ToolRunContext) {
    return this.mutate(taskId, exec, async () => {
      const saved = await this.get(taskId, exec)
      const report = parseReport(value, saved.record.plan)
      if (saved.record.delivery && saved.readyValid && JSON.stringify(saved.record.delivery.report) === JSON.stringify(report) && (revision === saved.record.revision - 1 || (revision === saved.record.revision && verification === saved.record.delivery.verification))) return this.summary(saved.record, true)
      if (saved.record.revision !== revision) throw new Error('Stale task revision; read current PLAN before finishing')
      if (saved.record.status === 'cancelled' || saved.record.status === 'failed') throw new Error('Failed or cancelled task must explicitly resume before delivery review')
      if (saved.record.delivery && !saved.readyValid) throw new Error('READY manually edited or missing; preserve and reconcile it')
      const recovered = saved.ready.content === undefined ? undefined : recoverReady(saved.ready.content, saved.record, report)
      verification = recovered ?? verification
      const ready = encodeReady(saved.record, report, verification)
      // A prior interrupted READY write may be reused only byte-for-byte. Never overwrite a manual file.
      if (saved.ready.content !== undefined && saved.ready.content !== ready && !saved.readyValid && digest(saved.ready.content) !== saved.record.previousReadyHash) throw new Error('Existing READY differs: preserve it and reconcile before delivery')
      const record: TaskRecord = { ...saved.record, status: 'reviewed', revision: revision + 1, delivery: { report, verification, readyHash: digest(ready) } }
      await this.write(this.path(taskId, 'READY.md'), ready, saved.ready, exec)
      await this.write(this.path(taskId, 'PLAN.md'), encodePlan(record), saved.plan, exec)
      return this.summary(record, true)
    })
  }
}
