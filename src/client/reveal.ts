/**
 * "Open location" for one delivered file.
 *
 * The Host exposes its native file-manager handoff as the
 * `session/openWorkspacePath` Remote with `action: "reveal"` (macOS: `open -R`,
 * which selects the file in Finder). This module keeps that call, and the
 * classification of its refusals, outside the render tree: the panel only maps
 * one short outcome to a dictionary sentence, and a missing file is reported as
 * moved or removed instead of being conflated with a Host that cannot reveal
 * locations at all.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Why a reveal did not happen, in the terms the panel can explain. */
export type RevealOutcome = 'missing' | 'unsupported' | 'failed'

/** A reveal refusal carrying the outcome the panel maps to one short sentence. */
export class RevealError extends Error {
  constructor(readonly outcome: RevealOutcome, message: string) {
    super(message)
    this.name = 'RevealError'
  }
}

/** The optional client remotes the reveal path uses, as far as it needs them. */
export interface RevealRemotes {
  session?: {
    openWorkspacePath?: (request: { path: string, action?: 'reveal' }, signal: AbortSignal) => Promise<{
      ok: boolean
      error?: { message?: string }
    }>
  }
  files?: {
    stat?: (sessionId: SessionId, path: string, signal: AbortSignal) => Promise<{
      ok: boolean
      error?: { code?: string, message?: string }
    }>
  }
}

/**
 * Ask the Host desktop to reveal the file in Finder (or its platform file
 * manager). The file is probed first so a moved or removed file gets an
 * accurate message; a Host without the reveal Remote throws `unsupported`
 * rather than silently doing nothing.
 * @param remotes - optional session/files services observed on this Host.
 * @param sessionId - viewed session, for the filesystem probe.
 * @param path - absolute Host path from the delivered-files projection.
 * @param signal - caller lifetime; abort cancels the probe and the native opener.
 */
export async function revealFileLocation(remotes: RevealRemotes, sessionId: SessionId, path: string, signal: AbortSignal): Promise<void> {
  const stat = remotes.files?.stat
  if (typeof stat === 'function') {
    const probe = await stat(sessionId, path, signal)
    if (!probe.ok) {
      throw new RevealError(
        probe.error?.code === 'workspace-file/not-found' ? 'missing' : 'failed',
        probe.error?.message ?? 'File unavailable',
      )
    }
    signal.throwIfAborted()
  }
  const open = remotes.session?.openWorkspacePath
  if (typeof open !== 'function') throw new RevealError('unsupported', 'session.openWorkspacePath is unavailable')
  const response = await open({ path, action: 'reveal' }, signal)
  if (!response.ok) throw new RevealError('failed', response.error?.message ?? 'openWorkspacePath failed')
}
