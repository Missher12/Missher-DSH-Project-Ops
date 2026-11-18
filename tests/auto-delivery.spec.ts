import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore, { type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { expect, test } from 'vitest'
import * as ProjectOps from '../src/index.ts'

type Delivery = { turn: number; callId: string; files: { path: string }[] }

async function setup() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'project-ops-final-')))
  const ctx = new Context()
  await ctx.plugin(SessionProjections)
  const sessions = await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(LocalFileSystem, { cwd, diffBasisMaxBytes: 1024 })
  await ctx.plugin({ apply(inner: Context) {
    inner.provide('tools', { register: () => () => {}, get: (name: string) => name === 'present' ? {} : undefined })
  } })
  const plugin = await ctx.plugin(ProjectOps)
  const deliveries = new Map<Session, Delivery[]>()
  const events = new Map<Session, SessionEvent[]>()
  ctx.on('session/event', (session, event) => {
    events.set(session, [...events.get(session) ?? [], event])
    if (String(event.type) !== 'deliverables/presented') return
    deliveries.set(session, [...deliveries.get(session) ?? [], event.data as Delivery])
  })
  const newSession = () => ctx.sessions.create(undefined, { meta: { cwd } })
  const begin = async (session: Session, turn = 1) => {
    session.append('turn/start', { turn })
    const assembly = await ctx.systemPrompt.assemble({ agent: { session } as Agent })
    const delivery = assembly.contexts.find(entry => entry.name === 'missher-project-ops:delivery-dir')
    expect(delivery?.text).toBeDefined()
    const path = JSON.parse(delivery!.text.slice(delivery!.text.indexOf('"'))) as string
    mkdirSync(path, { recursive: true })
    return path
  }
  const dispose = async () => {
    await plugin.dispose()
    await sessions.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
  const projectedPaths = (session: Session) => ctx.sessionProjections.restore(
    {}, events.get(session) ?? [], 0 as never, session.header, 0 as never,
  ).snapshot.values.missherProjectOpsFiles?.files.map(file => file.path)
  const stopping = (session: Session, signal = new AbortController().signal) => ctx.serial('agent/turn-stopping', {
    agent: { session, inbox: { nextStep: [] } } as unknown as Agent, turn: 1, signal,
  })
  return { cwd, deliveries, newSession, begin, dispose, projectedPaths, stopping }
}

test('reports final files in native chat and the file projection once the turn completes', async () => {
  const f = await setup()
  try {
    const session = f.newSession()
    const dir = await f.begin(session)
    const word = join(dir, '方案.docx')
    const sheet = join(dir, '预算.xlsx')
    for (const file of [word, sheet, join(dir, 'draft.tmp'), join(dir, '.hidden'), join(f.cwd, 'outside.csv')]) {
      writeFileSync(file, 'fixture')
    }
    if (process.platform !== 'win32') symlinkSync(join(f.cwd, 'outside.csv'), join(dir, 'link.csv'))
    const present = session.append.bind(session) as unknown as (kind: string, value: Delivery) => void
    present('deliverables/presented', { turn: 1, callId: 'manual', files: [{ path: word }] })
    expect(f.deliveries.get(session)).toHaveLength(1)
    await f.stopping(session)
    await f.stopping(session)
    expect(f.deliveries.get(session)).toHaveLength(2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(f.deliveries.get(session)?.[1]).toMatchObject({ turn: 1, files: [{ path: sheet }] })
    expect(f.projectedPaths(session)).toEqual([sheet, word])
  } finally { await f.dispose() }
})

test('keeps cancelled work and another turn’s files out of a completed delivery', async () => {
  const f = await setup()
  try {
    const a = f.newSession()
    const b = f.newSession()
    const partial = join(await f.begin(a), 'partial.xlsx')
    const final = join(await f.begin(b), 'final.csv')
    writeFileSync(partial, 'partial')
    writeFileSync(final, 'complete')
    await f.stopping(a, AbortSignal.abort())
    a.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    await f.stopping(b)
    b.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(f.deliveries.get(b)?.[0]?.files).toEqual([{ path: final }])
    expect(f.deliveries.get(a)).toBeUndefined()
  } finally { await f.dispose() }
})
