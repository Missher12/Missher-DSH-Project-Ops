import { randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

const MAX_DELIVERED_FILES = 1000
const DELIVERY_ROOT = '.artifacts/project-ops'

interface DeliveryTurn {
  number: number
  cwd: string
  directory: string
  announced: boolean
  incomplete: boolean
  presented: Set<string>
}

interface DeliverySession {
  controller: AbortController
  turn: DeliveryTurn | undefined
}

interface NativeDelivery {
  turn: number
  callId: string
  files: { path: string }[]
}

const windowsPath = (path: string) => /^[a-z]:[\\/]|^\\\\/iu.test(path)

/** Read metadata only, in the unique final-file directory that this turn was given. */
async function finalFiles(fs: FileSystem, turn: DeliveryTurn, signal: AbortSignal): Promise<NativeDelivery['files']> {
  const { cwd, directory, presented } = turn
  const options = { cwd, signal }
  const seen = new Set(presented)
  let prefix = ''
  for (const segment of directory.split('/')) {
    prefix = prefix ? `${prefix}/${segment}` : segment
    if ((await fs.lstat(prefix, options, signal))?.type !== 'directory') return []
  }
  const root = await fs.resolve('.', options)
  const target = await fs.resolve(directory, options)
  if (!fs.contains(root, target) || target.targetKey === root.targetKey) return []

  const files: NativeDelivery['files'] = []
  for (const entry of await fs.listDir(target, signal)) {
    if (entry.type !== 'file' || !entry.name || entry.name.startsWith('.')
      || /[\\/\u0000-\u001f]/u.test(entry.name) || /(?:\.part|\.tmp|~)$/iu.test(entry.name)) continue
    if (!fs.contains(target, entry.target)) continue
    if ((await fs.lstat(`${directory}/${entry.name}`, options, signal))?.type !== 'file') continue
    const path = fs.processPath(entry.target)
    if (!path || path.length > 4096 || /[\u0000-\u001f]/u.test(path) || seen.has(path)) continue
    seen.add(path)
    files.push({ path })
    if (files.length >= MAX_DELIVERED_FILES) break
  }
  return files
}

/** Publish final files at the Host's turn boundary so live chat sees the native record. */
export function registerAutoDelivery(ctx: Context): void {
  const prompt = ctx.get('systemPrompt') as Context['systemPrompt'] | undefined
  if (typeof prompt?.context !== 'function') return

  const lifetime = new AbortController()
  const sessions = new WeakMap<Session, DeliverySession>()
  ctx.effect(() => () => lifetime.abort())
  ctx.on('session/disposed', session => {
    sessions.get(session)?.controller.abort()
    sessions.delete(session)
  })
  prompt.context({
    name: 'missher-project-ops:delivery-dir',
    order: 145,
    required: true,
    interpolate: false,
    text: ({ agent, signal }) => {
      if (!agent || signal?.aborted) return ''
      const turn = sessions.get(agent.session)?.turn
      if (!turn || typeof ctx.tools.get !== 'function' || ctx.tools.get('present', agent) === undefined) return ''
      turn.announced = true
      const paths = windowsPath(turn.cwd) ? win32 : posix
      return `Project Ops final file directory for this turn: ${JSON.stringify(paths.join(turn.cwd, turn.directory))}`
    },
  })

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      const { cwd, origin, delegationDepth } = session.header
      if (!cwd || origin === 'subagent' || (delegationDepth ?? 0) > 0) return
      const state = sessions.get(session) ?? { controller: new AbortController(), turn: undefined }
      state.turn = {
        number: event.data.turn,
        cwd,
        directory: `${DELIVERY_ROOT}/turn-${event.data.turn}-${randomUUID()}`,
        announced: false,
        incomplete: false,
        presented: new Set(),
      }
      sessions.set(session, state)
      return
    }

    const state = sessions.get(session)
    const turn = state?.turn
    if (!state || !turn) return
    if (String(event.type) === 'deliverables/presented') {
      const delivered = event.data as NativeDelivery
      if (delivered.turn === turn.number && Array.isArray(delivered.files)) {
        for (const { path } of delivered.files) if (typeof path === 'string') turn.presented.add(path)
      }
      return
    }
    if (event.type === 'assistant/message' && event.data.turn === turn.number) {
      // The loop keeps max-tokens sticky across steps. The stopping hook also
      // runs for those turns, although it does not carry the end reason.
      if (event.data.interrupted === true || event.data.stream?.some(frame => frame.type === 'chunk'
        && frame.chunk.type === 'finish' && frame.chunk.reason.kind === 'max-tokens')) turn.incomplete = true
    } else if (event.type === 'turn/end' && event.data.turn === turn.number) {
      state.turn = undefined
    }
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn: number, signal: turnSignal }) => {
    const session = agent.session
    const state = sessions.get(session)
    const turn = state?.turn
    if (!state || !turn || turn.number !== number || !turn.announced || turn.incomplete) return
    const signal = AbortSignal.any([lifetime.signal, state.controller.signal, turnSignal, AbortSignal.timeout(5000)])
    try {
      if (signal.aborted) return
      const files = await finalFiles(ctx.fs, turn, signal)
      if (!files.length || signal.aborted || agent.inbox.nextStep.length > 0) return
      const append = session.append as unknown as (type: 'deliverables/presented', data: NativeDelivery) => void
      append.call(session, 'deliverables/presented', { turn: turn.number, callId: `project-ops:auto:${turn.number}`, files })
    } catch (error) {
      if (!signal.aborted) ctx.logger.warn(`project-ops: automatic file delivery failed: ${String(error)}`)
    }
  })
}
