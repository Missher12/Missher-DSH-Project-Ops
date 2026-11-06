/**
 * The "open location" path against the Host's own reveal Remote.
 *
 * The native Finder handoff is `session/openWorkspacePath` with
 * `action: "reveal"`; these tests pin the call shape, the missing-file
 * distinction and the unsupported-Host refusal without a DOM or a desktop.
 */
import { expect, test } from 'vitest'
import { RevealError, revealFileLocation, type RevealRemotes } from '../src/client/reveal.ts'

const signal = (): AbortSignal => new AbortController().signal

test('an existing file is revealed through the Host session Remote', async () => {
  const calls: unknown[] = []
  const remotes: RevealRemotes = {
    session: { openWorkspacePath: async (request) => { calls.push(request); return { ok: true } } },
    files: { stat: async () => ({ ok: true }) },
  }
  await expect(revealFileLocation(remotes, 'session-1', '/work/方案-分类测试.docx', signal())).resolves.toBeUndefined()
  expect(calls).toEqual([{ path: '/work/方案-分类测试.docx', action: 'reveal' }])
})

test('a moved or removed file is reported as missing before the native opener runs', async () => {
  let opened = false
  const remotes: RevealRemotes = {
    session: { openWorkspacePath: async () => { opened = true; return { ok: true } } },
    files: { stat: async () => ({ ok: false, error: { code: 'workspace-file/not-found', message: 'no entry' } }) },
  }
  await expect(revealFileLocation(remotes, 'session-1', '/work/gone.xlsx', signal())).rejects.toMatchObject({ outcome: 'missing' })
  expect(opened).toBe(false)
})

test('a Host without the reveal Remote reports unsupported instead of failing silently', async () => {
  await expect(revealFileLocation({}, 'session-1', '/work/report.docx', signal())).rejects.toBeInstanceOf(RevealError)
  await expect(revealFileLocation({}, 'session-1', '/work/report.docx', signal())).rejects.toMatchObject({ outcome: 'unsupported' })
})

test('a permission refusal is reported as denied, never as a missing file', async () => {
  let opened = false
  const remotes: RevealRemotes = {
    session: { openWorkspacePath: async () => { opened = true; return { ok: true } } },
    files: { stat: async () => ({ ok: false, error: {
      code: 'gateway/internal',
      message: "EACCES: permission denied, lstat '/work/private.docx'",
    } }) },
  }
  await expect(revealFileLocation(remotes, 'session-1', '/work/private.docx', signal()))
    .rejects.toMatchObject({ outcome: 'denied' })
  expect(opened).toBe(false)
})

test('another file failure keeps its detail instead of becoming missing or denied', async () => {
  const remotes: RevealRemotes = {
    files: { stat: async () => ({ ok: false, error: { code: 'workspace-file/not-regular-file', message: 'is a directory' } }) },
  }
  await expect(revealFileLocation(remotes, 'session-1', '/work/folder', signal()))
    .rejects.toMatchObject({ outcome: 'failed', message: 'is a directory' })
})

test('a file name that looks like an errno inside another fault is not a permission refusal', async () => {
  const remotes: RevealRemotes = {
    files: { stat: async () => ({ ok: false, error: {
      code: 'gateway/internal',
      message: "EIO: I/O error, lstat '/work/EACCES.xlsx'",
    } }) },
  }
  await expect(revealFileLocation(remotes, 'session-1', '/work/EACCES.xlsx', signal()))
    .rejects.toMatchObject({ outcome: 'failed', message: "EIO: I/O error, lstat '/work/EACCES.xlsx'" })
})

test('a native opener refusal keeps the Host message', async () => {
  const remotes: RevealRemotes = {
    session: { openWorkspacePath: async () => ({ ok: false, error: { message: 'path open failed' } }) },
  }
  await expect(revealFileLocation(remotes, 'session-1', '/work/report.docx', signal()))
    .rejects.toMatchObject({ outcome: 'failed', message: 'path open failed' })
})
