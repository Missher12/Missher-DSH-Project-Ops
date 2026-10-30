import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { FILES_PROJECTION, type DeliveredFiles } from './delivered-files.ts'

interface FileState { cwd: string; pending: Record<string, string>; view: DeliveredFiles }
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { missherProjectOpsFiles: DeliveredFiles }
  interface SessionProjectionStateMap { missherProjectOpsFiles: FileState }
}

const MAX_FILES = 1000
const viewSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1).max(4096), description: z.string().max(4000).optional(), updatedAt: z.number().finite() })).max(MAX_FILES),
  truncated: z.boolean(),
})
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const validPath = (path: unknown): path is string => typeof path === 'string' && path.trim() !== '' && path.length <= 4096 && !/[\u0000-\u001f]/u.test(path)

function addFile(state: FileState, value: unknown, updatedAt: number): FileState {
  const file = record(value)
  if (!validPath(file.path) || !Number.isFinite(updatedAt)) return state
  const paths = /^[a-z]:[\\/]|^\\\\/iu.test(file.path) || /^[a-z]:[\\/]|^\\\\/iu.test(state.cwd) ? win32 : posix
  const path = paths.isAbsolute(file.path) || !state.cwd ? paths.normalize(file.path) : paths.resolve(state.cwd, file.path)
  // The task browser owns these process documents; they are not file deliverables.
  if (/(?:^|\/)docs\/tasks\/\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}\/(?:PLAN|READY)\.md$/u.test(path.replaceAll('\\', '/'))) return state
  const previous = state.view.files.find(row => row.path === path)
  const next = { ...previous, path, updatedAt, ...(typeof file.description === 'string' ? { description: file.description.slice(0, 4000) } : {}) }
  const files = [next, ...state.view.files.filter(row => row.path !== path)]
  return { ...state, view: { files: files.slice(0, MAX_FILES), truncated: state.view.truncated || files.length > MAX_FILES } }
}

/** Reuses the Host's replay, checkpoint and live notification machinery. */
const definition = {
  key: FILES_PROJECTION, stateVersion: 1,
  stateSchema: z.object({ cwd: z.string(), pending: z.record(z.string(), z.string()), view: viewSchema }),
  init: header => ({ cwd: header.cwd ?? '', pending: {}, view: { files: [], truncated: false } }),
  apply(state, event) {
    const data = record(event.data)
    if (String(event.type) === 'deliverables/presented' && Array.isArray(data.files)) {
      return data.files.reduce<FileState>((next, file) => addFile(next, file, event.time), state)
    }
    if (event.type === 'tool/call' && typeof data.callId === 'string' && typeof data.arguments === 'string') {
      let args: Record<string, unknown>
      try { args = record(JSON.parse(data.arguments)) } catch { return state }
      const path = data.name === 'write' || data.name === 'edit' ? args.file_path
        : data.name === 'str_replace_editor' && ['create', 'str_replace', 'insert'].includes(String(args.command)) ? args.path : undefined
      if (!validPath(path)) return state
      return { ...state, pending: { ...state.pending, [data.callId]: path } }
    }
    if (event.type === 'tool/result' && event.surfaceOp === 'append') {
      const message = record(data.message)
      const callId = record(message.source).callId
      if (typeof callId !== 'string' || !Object.hasOwn(state.pending, callId)) return state
      const pending = { ...state.pending }
      const path = record(data.meta).path ?? pending[callId]
      delete pending[callId]
      const next = { ...state, pending }
      return message.isError === true ? next : addFile(next, { path }, event.time)
    }
    if (event.type === 'turn/end' && Object.keys(state.pending).length) return { ...state, pending: {} }
    return state
  },
  wire: { viewSchema, view: state => state.view },
} satisfies ProjectionDefinition<typeof FILES_PROJECTION>

export function registerFileProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], inner => {
    if (typeof inner.sessionProjections.register === 'function') inner.sessionProjections.register(definition)
  })
}
