import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ObservationPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, test } from 'vitest'
import { DocumentStore } from '../src/document-store.ts'
import { decodePlan, encodePlan } from '../src/task-documents.ts'

const roots: string[] = []
const cleanups: (() => Promise<void>)[] = []
const plan = { title: '开发示例', requirements: '维护任务记录', design: '复用宿主文件系统', steps: ['实现', '验证'], acceptance: ['隔离'], progress: '开始' }
const report = { implementation: '实现文件写入', checks: [{ criterion: '隔离', status: 'unverified', evidence: '未执行原生验收' }], artifacts: ['src/example.ts'], git: '未提交', release: '未发布', installation: '未安装', limitations: ['真实模型未验证'], rollback: '仅移除此候选，保留项目文档' }
async function fixture(sessionId = 'host-session', root?: string) {
  const cwd = root ?? mkdtempSync(join(tmpdir(), 'project-ops-docs-'))
  if (!root) roots.push(cwd)
  const ctx = new Context()
  const fs = await ctx.plugin(LocalFileSystem, { cwd, diffBasisMaxBytes: 1024 * 1024 })
  const policy = await ctx.plugin(ObservationPolicy)
  cleanups.push(async () => { await policy.dispose(); await fs.dispose() })
  const exec = { agent: { session: { id: sessionId, header: { cwd } } }, callId: 'native-create-call', signal: new AbortController().signal } as unknown as ToolRunContext
  return { ctx, cwd, exec, store: new DocumentStore(ctx) }
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('isolates tasks and preserves root files; restart reads and continues original native identity', async () => {
  const f = await fixture()
  for (const file of ['README.md', 'READY.md', 'AGENTS.md']) writeFileSync(join(f.cwd, file), 'human')
  const a = await f.store.begin('feature', plan, f.exec)
  const retry = await f.store.begin('feature', plan, f.exec)
  expect(retry).toEqual(a)
  const b = await f.store.begin('feature', plan, { ...f.exec, callId: 'second-call' } as ToolRunContext)
  expect(b.taskId).not.toBe(a.taskId)
  const resumed = await fixture('host-session', f.cwd)
  expect((await resumed.store.get(a.taskId, resumed.exec)).record.originCallId).toBe('native-create-call')
  const update = await resumed.store.update(a.taskId, 1, { ...plan, progress: '实现完成，等待验收' }, 'active', resumed.exec)
  expect(update.revision).toBe(2)
  for (const file of ['README.md', 'READY.md', 'AGENTS.md']) expect(readFileSync(join(f.cwd, file), 'utf8')).toBe('human')
  const stranger = await fixture('different-session', f.cwd)
  await expect(stranger.store.update(a.taskId, 2, plan, 'active', stranger.exec)).rejects.toThrow('another Host Session')
})

test('manual PLAN and READY edits are preserved and stale updates cannot overwrite them', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  const path = join(f.cwd, a.planPath)
  const original = readFileSync(path, 'utf8'); writeFileSync(path, original + 'human edit\n')
  await expect(f.store.update(a.taskId, 1, plan, 'active', f.exec)).rejects.toThrow('manually edited')
  expect(readFileSync(path, 'utf8')).toContain('human edit')
  writeFileSync(path, original)
  const readyPath = join(f.cwd, a.planPath.replace('PLAN.md', 'READY.md'))
  writeFileSync(readyPath, 'human READY')
  await expect(f.store.finish(a.taskId, 1, report, '未验证', f.exec)).rejects.toThrow('Existing READY differs')
  expect(readFileSync(readyPath, 'utf8')).toBe('human READY')
})

test('failure/cancellation never produce completion; unknown evidence remains explicit after delivery review', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  await f.store.update(a.taskId, 1, plan, 'cancelled', f.exec)
  await expect(f.store.finish(a.taskId, 2, report, '未验证', f.exec)).rejects.toThrow('explicitly resume')
  await f.store.update(a.taskId, 2, plan, 'failed', f.exec)
  await expect(f.store.finish(a.taskId, 3, report, '未验证', f.exec)).rejects.toThrow('explicitly resume')
  await f.store.update(a.taskId, 3, plan, 'active', f.exec)
  const ready = await f.store.finish(a.taskId, 4, report, '未验证', f.exec)
  expect(ready.status).toBe('reviewed'); expect(ready.verification).toBe('未验证')
  const text = readFileSync(join(f.cwd, ready.readyPath!), 'utf8')
  expect(text).toContain('unverified'); expect(text).toContain('未发布'); expect(text).toContain('关联方案修订：4')
  expect(await f.store.finish(a.taskId, 4, report, '未验证', f.exec)).toEqual(ready)
  const resumed = await f.store.update(a.taskId, 5, { ...plan, progress: '追加修改' }, 'active', f.exec)
  expect(resumed.readyPath).toBeNull()
  expect((await f.store.finish(a.taskId, 6, report, '未验证', f.exec)).readyValid).toBe(true)
})

test('READY-first interruption does not mark PLAN reviewed; restart and identical retry finish once', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  const write = f.ctx.fs.writeText.bind(f.ctx.fs)
  f.ctx.fs.writeText = async (target, ...args) => {
    if (target.displayPath.endsWith('PLAN.md')) throw new Error('simulated interrupted PLAN commit')
    return write(target, ...args)
  }
  await expect(f.store.finish(a.taskId, 1, report, '未验证', f.exec)).rejects.toThrow('interrupted')
  f.ctx.fs.writeText = write
  const after = await f.store.get(a.taskId, f.exec)
  expect(after.record.status).toBe('active'); expect(after.readyValid).toBe(false)
  const resumed = await fixture('host-session', f.cwd)
  const final = await resumed.store.finish(a.taskId, 1, report, 'stale after READY write', resumed.exec)
  expect(final.verification).toBe('未验证')
  expect(final.readyValid).toBe(true); expect(final.revision).toBe(2)
})

test('Host version guard rejects a concurrent human edit between observation and atomic publication', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  const write = f.ctx.fs.writeText.bind(f.ctx.fs)
  f.ctx.fs.writeText = async (target, ...args) => { writeFileSync(target.displayPath, 'concurrent human'); return write(target, ...args) }
  await expect(f.store.update(a.taskId, 1, { ...plan, progress: 'changed' }, 'active', f.exec)).rejects.toThrow()
  expect(readFileSync(join(f.cwd, a.planPath), 'utf8')).toBe('concurrent human')
})

test('abort, policy refusal, malformed content and symlink escapes leave no task publication', async () => {
  const f = await fixture(); const abort = new AbortController(); abort.abort()
  await expect(f.store.begin('aborted', plan, { ...f.exec, signal: abort.signal })).rejects.toThrow()
  await expect(f.store.begin('../escape', plan, f.exec)).rejects.toThrow('slug')
  await expect(f.store.begin('bad', { ...plan, acceptance: [] }, f.exec)).rejects.toThrow('acceptance')
  mkdirSync(join(f.cwd, 'docs')); symlinkSync(tmpdir(), join(f.cwd, 'docs/tasks'))
  await expect(f.store.begin('escape', plan, f.exec)).rejects.toThrow('symlink')
})

test('report must cover PLAN acceptance, and revision CAS protects concurrent sessions of same owner', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  await expect(f.store.finish(a.taskId, 1, { ...report, checks: [] }, '未验证', f.exec)).rejects.toThrow('criterion')
  await f.store.update(a.taskId, 1, { ...plan, progress: 'new' }, 'active', f.exec)
  await expect(f.store.update(a.taskId, 1, { ...plan, progress: 'old' }, 'active', f.exec)).rejects.toThrow('Stale')
  const r = (await f.store.get(a.taskId, f.exec)).record
  expect(decodePlan(encodePlan(r))).toEqual(r)
})

test('requires Host policy under confinement and passes its exact session policy to atomic writes', async () => {
  const f = await fixture()
  Object.defineProperty(f.ctx.fs, 'sandboxMode', { value: 'read-only' })
  await expect(f.store.begin('denied', plan, f.exec)).rejects.toThrow('sandboxPolicy')
  const policy = { mode: 'read-only', workspaceRoot: f.cwd }
  f.ctx.provide('sandboxPolicy', { resolve: () => policy })
  const write = f.ctx.fs.writeText.bind(f.ctx.fs)
  let observed: unknown
  f.ctx.fs.writeText = async (_target, _content, _expected, _signal, stamped) => { observed = stamped; throw new Error('Host read-only denial') }
  await expect(f.store.begin('denied', plan, f.exec)).rejects.toThrow('read-only denial')
  expect(observed).toBe(policy)
  f.ctx.fs.writeText = write
  expect(await f.store.list(f.exec)).toEqual([])
})

test('finish retries bind the previous revision, and fresh evidence can replace the current review', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  const first = await f.store.finish(a.taskId, 1, report, '未验证', f.exec)
  expect(await f.store.finish(a.taskId, 1, report, '重试时快照已改变', f.exec)).toEqual(first)
  const second = await f.store.finish(a.taskId, 2, report, '新的原生回执验证', f.exec)
  expect(second.revision).toBe(3); expect(second.verification).toBe('新的原生回执验证')
  await expect(f.store.finish(a.taskId, 1, report, '过期请求', f.exec)).rejects.toThrow('Stale task revision')
})

test('a partial update changes only the supplied fields and keeps the rest of the plan', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  // The reported failure: a progress-only update must not require the title.
  const updated = await f.store.update(a.taskId, 1, { progress: '实现中，稍后补验收' }, 'active', f.exec)
  expect(updated.revision).toBe(2)
  const saved = (await f.store.get(a.taskId, f.exec)).record.plan
  expect(saved.title).toBe(plan.title)
  expect(saved.requirements).toBe(plan.requirements)
  expect(saved.design).toBe(plan.design)
  expect(saved.steps).toEqual(plan.steps)
  expect(saved.acceptance).toEqual(plan.acceptance)
  expect(saved.progress).toBe('实现中，稍后补验收')
  // A complete six-field payload still behaves exactly like before.
  const complete = await f.store.update(a.taskId, 2, { ...plan, progress: '完成' }, 'active', f.exec)
  expect(complete.revision).toBe(3)
  expect((await f.store.get(a.taskId, f.exec)).record.plan).toEqual({ ...plan, progress: '完成' })
})

test('an upward revision change is required before merge: stale patches never look like a no-op success', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  await f.store.update(a.taskId, 1, { progress: '第一次进展' }, 'active', f.exec)
  // Old revision with an identical patch: rejected, not silently accepted.
  await expect(f.store.update(a.taskId, 1, { progress: '第一次进展' }, 'active', f.exec)).rejects.toThrow('Stale task revision')
  // Old revision with an empty patch: also rejected.
  await expect(f.store.update(a.taskId, 1, {}, 'active', f.exec)).rejects.toThrow('Stale task revision')
  // Old revision with the complete, unchanged plan: rejected.
  await expect(f.store.update(a.taskId, 1, { ...plan, progress: '第一次进展' }, 'active', f.exec)).rejects.toThrow('Stale task revision')
  // Current revision with an empty patch is a legitimate no-op, not a fabricated write.
  const noop = await f.store.update(a.taskId, 2, {}, 'active', f.exec)
  expect(noop.revision).toBe(2)
  // Current revision with the same content is likewise the same record.
  expect((await f.store.update(a.taskId, 2, { progress: '第一次进展' }, 'active', f.exec)).revision).toBe(2)
})

test('partial update rejects null, empty, wrong types and unknown fields by name, and never writes', async () => {
  const f = await fixture(); const a = await f.store.begin('feature', plan, f.exec)
  const before = readFileSync(join(f.cwd, 'docs/tasks', a.taskId, 'PLAN.md'), 'utf8')
  await expect(f.store.update(a.taskId, 1, { title: null }, 'active', f.exec)).rejects.toThrow(/Invalid title: expected a string, received null/u)
  await expect(f.store.update(a.taskId, 1, { title: '   ' }, 'active', f.exec)).rejects.toThrow(/Invalid title: the string is empty/u)
  await expect(f.store.update(a.taskId, 1, { title: 42 }, 'active', f.exec)).rejects.toThrow(/Invalid title: expected a string, received a number/u)
  await expect(f.store.update(a.taskId, 1, { steps: 'one' }, 'active', f.exec)).rejects.toThrow(/Invalid steps: expected an array/u)
  await expect(f.store.update(a.taskId, 1, { titel: 'typo' }, 'active', f.exec)).rejects.toThrow(/Unknown PLAN field\(s\): titel/u)
  // Every rejection above left the file, the revision and the record untouched.
  expect(readFileSync(join(f.cwd, 'docs/tasks', a.taskId, 'PLAN.md'), 'utf8')).toBe(before)
  expect((await f.store.get(a.taskId, f.exec)).record.revision).toBe(1)
})

test('begin names the missing field instead of a bare range message', async () => {
  const f = await fixture()
  await expect(f.store.begin('feature', { ...plan, title: undefined }, f.exec))
    .rejects.toThrow(/Invalid title: expected a string, received nothing \(field absent\)/u)
  expect(await f.store.list(f.exec)).toEqual([])
})
