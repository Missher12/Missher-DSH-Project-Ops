import { Context } from '@deepseek-ai/cordis'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { expect, test } from 'vitest'
import * as ProjectOps from '../src/index.ts'

const key = 'missherProjectOpsFiles'
const header = { id: 'files-session', version: 3, createdAt: 0, cwd: '/work', isSeeded: false }
const event = (seq: number, type: string, data: unknown, surfaceOp?: unknown) => ({ seq, time: seq * 1000, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) })

async function registry() {
  const ctx = new Context()
  await ctx.plugin(SessionProjections)
  await ctx.plugin({ apply(inner: Context) {
    inner.provide('fs', {})
    inner.provide('tools', { register: () => () => {} })
  } })
  const fiber = await ctx.plugin(ProjectOps)
  return { ctx, fiber }
}

test('replays historical chat deliveries without a PLAN and merges the same path, not the same filename', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [
      event(0, 'deliverables/presented', { turn: 1, callId: 'p1', files: [{ path: 'out/report.docx', description: '初稿' }, { path: 'other/report.docx' }] }),
      event(1, 'deliverables/presented', { turn: 2, callId: 'p2', files: [{ path: '/work/out/report.docx', description: '修订稿' }, { path: 'out/data.xlsx' }] }),
    ]
    const restored = ctx.sessionProjections.restore({}, events as never, 0 as never, header as never, 0 as never)
    expect(restored.snapshot.values[key]).toEqual({ files: [
      { path: '/work/out/data.xlsx', updatedAt: 1000 },
      { path: '/work/out/report.docx', description: '修订稿', updatedAt: 1000 },
      { path: '/work/other/report.docx', updatedAt: 0 },
    ], truncated: false })
    const replay = ctx.sessionProjections.restore({}, events as never, 0 as never, header as never, 0 as never)
    expect(replay.snapshot.values[key]).toEqual(restored.snapshot.values[key])
  } finally { await fiber.dispose() }
})

test('includes successful file mutations while excluding reads, failures and replacement copies', async () => {
  const { ctx, fiber } = await registry()
  try {
    const events = [
      event(0, 'tool/call', { turn: 1, callId: 'w', name: 'write', arguments: JSON.stringify({ file_path: 'result.pdf', content: 'file' }) }),
      event(1, 'tool/result', { turn: 1, message: { source: { callId: 'w' } }, meta: { path: '/work/result.pdf' } }, 'append'),
      event(2, 'tool/call', { turn: 1, callId: 'f', name: 'write', arguments: JSON.stringify({ file_path: 'failed.xlsx', content: 'file' }) }),
      event(3, 'tool/result', { turn: 1, message: { isError: true, source: { callId: 'f' } } }, 'append'),
      event(4, 'tool/call', { turn: 1, callId: 'r', name: 'read', arguments: JSON.stringify({ file_path: 'input.docx' }) }),
      event(5, 'tool/result', { turn: 1, message: { isError: false, source: { callId: 'r' } } }, 'append'),
      event(6, 'tool/result', { turn: 1, message: { isError: false, source: { callId: 'f' } } }, { op: 'replace', startSeq: 3, endSeq: 3 }),
    ]
    const value = ctx.sessionProjections.restore({}, events as never, 0 as never, header as never, 0 as never).snapshot.values[key]
    expect(value).toEqual({ files: [{ path: '/work/result.pdf', updatedAt: 1000 }], truncated: false })
  } finally { await fiber.dispose() }
})

test('keeps managed plans and delivery records out of the actual-file list', async () => {
  const { ctx, fiber } = await registry()
  try {
    const dir = 'docs/tasks/2026-10-30-demo-0123456789abcdef'
    const events = [event(0, 'deliverables/presented', { turn: 1, callId: 'p', files: [
      { path: `${dir}/PLAN.md` }, { path: `${dir}/READY.md` },
      { path: '方案.docx' }, { path: 'PLAN.md' }, { path: '' }, { path: 'bad\u0000.docx' },
    ] })]
    const value = ctx.sessionProjections.restore({}, events as never, 0 as never, header as never, 0 as never).snapshot.values[key]
    expect(value).toEqual({ files: [{ path: '/work/PLAN.md', updatedAt: 0 }, { path: '/work/方案.docx', updatedAt: 0 }], truncated: false })
  } finally { await fiber.dispose() }
})
