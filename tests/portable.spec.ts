import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, test } from 'vitest'
import * as Portable from '../src/cordis.ts'
import { ProjectOpsService, type ProjectOpsHost } from '../src/project-ops.ts'
import type { ExecutionReceipt, ProjectTask } from '../src/contracts.ts'
import { sourceSnapshot, SNAPSHOT_LIMITS, type SourceReader } from '../src/source-snapshot.ts'

function fixture() {
  const state = { source: 'one', snapshot: true, running: false, outcome: 'succeeded' as ExecutionReceipt['outcome'], calls: 0 }
  const files: Record<string, string> = { 'package.json': JSON.stringify({ packageManager: 'npm@10', scripts: { test: 'node test.js' } }) }
  const receipt = (task: ProjectTask): ExecutionReceipt => ({ receiptVersion: 2, taskId: task.id, source: task.source,
    workspace: task.workspace, purpose: task.purpose, manifestDigest: task.manifestDigest, executionMode: state.running ? 'background' : 'foreground',
    nestedCallId: `native-${state.calls}`, jobId: 'host-job', startedAt: new Date(1000 + state.calls).toISOString(), durationMs: 1,
    outcome: state.running ? 'running' : state.outcome, ...state.running ? {} : { exitCode: 0 } })
  const host: ProjectOpsHost<string> = {
    apiVersion: 1, signal: () => new AbortController().signal,
    capabilities: () => ({ host: 'test-host', version: '1', foreground: true, background: true, cancellation: true }),
    scope: identity => ({ identity,
      reader: { readCandidate: async name => files[name] === undefined ? undefined : new TextEncoder().encode(files[name]), lockfiles: async () => [], listDirectories: async () => [] },
      snapshot: async () => state.snapshot ? createHash('sha256').update(JSON.stringify([state.source, files])).digest('hex') : undefined }),
    execute: async task => { state.calls++; return { nestedContent: [], receipt: receipt(task) } },
    collect: async task => ({ nestedContent: [], receipt: receipt(task) }),
    cancel: async () => { state.running = false; state.outcome = 'aborted' },
  }
  const service = new ProjectOpsService(host)
  const args = { changedFiles: ['src/a.ts'], goal: 'verify' as const }
  const plan = () => service.plan('owner/project', args)
  return { state, files, host, service, args, plan }
}

describe('portable Cordis service and evidence', () => {
  test('registers and releases service through real Cordis lifecycle, including reload', async () => {
    const { host } = fixture()
    const ctx = new Context()
    await ctx.plugin((inner: Context) => { inner.provide('projectOpsHost', host) })
    const fiber = await ctx.plugin(Portable)
    const service = ctx.get('projectOps') as ProjectOpsService<string>
    expect((await service.list('owner/project')).tasks).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.get('projectOps')).toBeUndefined()
    await expect(service.list('owner/project')).rejects.toThrow('disposed')
    const reloaded = await ctx.plugin(Portable)
    expect(ctx.get('projectOps')).not.toBe(service)
    await reloaded.dispose()
  })

  test('rejects a missing or incompatible host contract', () => {
    expect(() => new ProjectOpsService({ apiVersion: 2 } as unknown as ProjectOpsHost)).toThrow('version')
    expect(() => Portable.apply({ get: () => undefined, provide() {}, effect() {} })).toThrow('adapter')
  })

  test('passes bound native evidence and rejects source changes, replay, forgery and reload', async () => {
    const f = fixture(); const plan = await f.plan(); const task = plan.tasks[0]!
    const result = await f.service.run('owner/project', { taskId: task.id, manifestDigest: task.manifestDigest })
    const gate = (receipts = [result.receipt], owner = 'owner/project', service = f.service) => service.gate(owner, { ...f.args, planDigest: plan.planDigest, receipts })
    expect((await gate()).verdict).toBe('passed')
    const reordered = Object.fromEntries(Object.entries(result.receipt).reverse()) as unknown as ExecutionReceipt
    expect((await gate([reordered])).verdict).toBe('passed')
    expect((await gate([{ ...result.receipt, durationMs: 999 }])).verdict).toBe('stale')
    expect((await gate([result.receipt], 'another/project')).verdict).toBe('stale')
    expect((await gate([result.receipt], 'owner/project', new ProjectOpsService(f.host))).verdict).toBe('stale')
    expect((await gate([{ ...result.receipt, receiptVersion: 2 }])).verdict).toBe('stale')
    f.state.source = 'two'
    expect((await f.plan()).planDigest).not.toBe(plan.planDigest)
    expect((await gate()).verdict).toBe('stale')
  })

  test('new execution can replace stale evidence without rejecting earlier attempts', async () => {
    const f = fixture(); const p1 = await f.plan(); const task = p1.tasks[0]!
    const old = await f.service.run('owner/project', { taskId: task.id, manifestDigest: task.manifestDigest })
    f.state.source = 'new'
    const p2 = await f.plan()
    const fresh = await f.service.run('owner/project', { taskId: task.id, manifestDigest: task.manifestDigest })
    expect((await f.service.gate('owner/project', { ...f.args, planDigest: p2.planDigest, receipts: [old.receipt, fresh.receipt] })).verdict).toBe('passed')
  })

  test('an old success cannot hide a newer failed native attempt by omitting its receipt', async () => {
    const f = fixture(); const plan = await f.plan(); const task = plan.tasks[0]!
    const old = await f.service.run('owner/project', { taskId: task.id, manifestDigest: task.manifestDigest })
    f.state.outcome = 'failed'
    await f.service.run('owner/project', { taskId: task.id, manifestDigest: task.manifestDigest })
    expect((await f.service.gate('owner/project', { ...f.args, planDigest: plan.planDigest, receipts: [old.receipt] })).verdict).toBe('stale')
  })

  test('a throwing native executor invalidates older evidence and does not cause automatic retry', async () => {
    const f = fixture(); const plan = await f.plan(); const task = plan.tasks[0]!
    const args = { taskId: task.id, manifestDigest: task.manifestDigest }
    const old = await f.service.run('owner/project', args)
    f.host.execute = async () => { throw new Error('native call interrupted') }
    await expect(f.service.run('owner/project', args)).rejects.toThrow('interrupted')
    expect((await f.service.gate('owner/project', { ...f.args, planDigest: plan.planDigest, receipts: [old.receipt] })).verdict).toBe('stale')
    expect(f.state.calls).toBe(1)
  })

  test('cannot claim a pass when snapshots are unavailable or change during execution', async () => {
    const f = fixture(); const plan = await f.plan(); const task = plan.tasks[0]!
    const execute = f.host.execute!
    f.host.execute = async (...args) => { const result = await execute(...args); f.state.source = 'changed-in-task'; return result }
    const changed = await f.service.run('owner/project', { taskId: task.id, manifestDigest: task.manifestDigest })
    expect(changed.receipt.freshness).toBe('changed')
    f.state.snapshot = false
    const unavailable = await f.service.run('owner/project', { taskId: task.id, manifestDigest: task.manifestDigest })
    expect(unavailable.receipt.freshness).toBe('unavailable')
    expect((await f.service.gate('owner/project', { ...f.args, planDigest: plan.planDigest, receipts: [unavailable.receipt] })).verdict).toBe('stale')
  })

  test('collects after configuration changes while preserving identity and cancellation', async () => {
    const f = fixture(); f.state.running = true
    const task = (await f.plan()).tasks[0]!
    const { receipt } = await f.service.run('owner/project', { taskId: task.id, manifestDigest: task.manifestDigest, mode: 'background' })
    const args = { taskId: receipt.taskId, manifestDigest: receipt.manifestDigest, jobId: receipt.jobId!, nestedCallId: receipt.nestedCallId, startedAt: receipt.startedAt }
    f.files['package.json'] = f.files['package.json']!.replace('test.js', 'new.js')
    await expect(f.service.collect('stranger', args)).rejects.toThrow('does not belong')
    await expect(f.service.cancel('stranger', receipt.executionId!)).rejects.toThrow('unknown')
    await f.service.cancel('owner/project', receipt.executionId!)
    const final = await f.service.collect('owner/project', args)
    expect(final.receipt.outcome).toBe('aborted')
    expect(final.receipt.freshness).toBe('changed')
    expect(f.state.calls).toBe(1)
  })

  test('supports discovery-only hosts and never falls back to starting a process', async () => {
    const f = fixture(); delete f.host.execute; delete f.host.collect
    const task = (await f.plan()).tasks[0]!
    expect((await f.service.doctor('owner')).executionAdapter).toBe(false)
    await expect(f.service.run('owner', { taskId: task.id, manifestDigest: task.manifestDigest })).rejects.toThrow('adapter unavailable')
    expect(f.state.calls).toBe(0)
  })
})

describe('bounded source snapshot', () => {
  test('hashes additions, contents and deletions; skips only git metadata and node_modules', async () => {
    const files: Record<string, string> = { 'src/a.ts': 'one', 'nested/tsconfig.json': '{}', '.git/config': 'ignored', 'node_modules/x': 'ignored' }
    const reader: SourceReader = {
      async entries(path) {
        const prefix = path === '.' ? '' : `${path}/`
        const rows = new Map<string, 'file' | 'directory'>()
        for (const key of Object.keys(files).filter(key => key.startsWith(prefix))) {
          const relative = key.slice(prefix.length); rows.set(relative.split('/')[0]!, relative.includes('/') ? 'directory' : 'file')
        }
        return [...rows].map(([name, type]) => ({ name, type }))
      },
      async read(path) { return new TextEncoder().encode(files[path]) },
    }
    const snap = () => sourceSnapshot(reader, new AbortController().signal)
    const original = await snap(); files['src/a.ts'] = 'two'; expect(await snap()).not.toBe(original)
    files['src/a.ts'] = 'one'; expect(await snap()).toBe(original)
    files['untracked.ts'] = 'new'; expect(await snap()).not.toBe(original)
    delete files['untracked.ts']; delete files['nested/tsconfig.json']; expect(await snap()).not.toBe(original)
    files['nested/tsconfig.json'] = '{}'; files['node_modules/x'] = 'other'; expect(await snap()).toBe(original)
  })

  test('rejects oversized files, invalid paths, unsupported entries and cancellation', async () => {
    const reader: SourceReader = { entries: async () => [{ name: 'file', type: 'file' }], read: async () => new Uint8Array(SNAPSHOT_LIMITS.fileBytes + 1) }
    const signal = new AbortController().signal
    await expect(sourceSnapshot(reader, signal)).rejects.toThrow('byte limit')
    reader.entries = async () => [{ name: '../escape', type: 'file' }]
    await expect(sourceSnapshot(reader, signal)).rejects.toThrow('invalid')
    reader.entries = async () => [{ name: 'link', type: 'unsupported' }]
    await expect(sourceSnapshot(reader, signal)).rejects.toThrow('symlinks')
    const controller = new AbortController(); controller.abort()
    await expect(sourceSnapshot(reader, controller.signal)).rejects.toThrow()
  })

  test('only excludes explicitly declared output directories and binds that policy into the digest', async () => {
    let output = false
    const reader: SourceReader = {
      entries: async path => path === '.' ? [{ name: 'src.ts', type: 'file' }, ...output ? [{ name: 'dist', type: 'directory' as const }] : []] : [{ name: 'out.js', type: 'file' }],
      read: async () => new TextEncoder().encode('data'),
    }
    const signal = new AbortController().signal
    const baseline = await sourceSnapshot(reader, signal, { outputDirectories: ['dist'] })
    output = true
    expect(await sourceSnapshot(reader, signal, { outputDirectories: ['dist'] })).toBe(baseline)
    expect(await sourceSnapshot(reader, signal)).not.toBe(baseline)
    await expect(sourceSnapshot(reader, signal, { outputDirectories: ['../src'] })).rejects.toThrow('relative directories')
  })
})
