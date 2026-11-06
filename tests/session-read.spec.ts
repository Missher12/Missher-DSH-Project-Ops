/**
 * Session-scoped read state: one session's rows never leak into another, while
 * a background refresh keeps the last successful result for its own session.
 */
import { expect, test } from 'vitest'
import { beginRead, failRead, readFor } from '../src/client/session-read.ts'

const previous = { sessionId: 'session-a', result: { files: [{ path: '/work/a.docx', updatedAt: 1 }], truncated: false } }

test('a previous session supplies no rows, error or count to the current one', () => {
  expect(readFor(previous, 'session-b')).toBeUndefined()
  expect(beginRead(previous, 'session-b')).toEqual({ sessionId: 'session-b' })
  expect(failRead(previous, 'session-b', 'boom')).toEqual({ sessionId: 'session-b', error: 'boom' })
})

test('a refresh keeps the last successful result while the read runs', () => {
  expect(readFor(previous, 'session-a')?.result).toBe(previous.result)
  expect(beginRead(previous, 'session-a')).toEqual({ sessionId: 'session-a', result: previous.result })
})

test('a failed refresh keeps the last successful result next to the error', () => {
  const failed = failRead(previous, 'session-a', 'boom')
  expect(failed).toEqual({ sessionId: 'session-a', result: previous.result, error: 'boom' })
  expect(readFor(failed, 'session-a')?.result).toBe(previous.result)
})

test('a first read of a session starts empty even after an earlier failure', () => {
  const failed = failRead(undefined, 'session-a', 'boom')
  expect(failed).toEqual({ sessionId: 'session-a', error: 'boom' })
  expect(beginRead(failed, 'session-a')).toEqual({ sessionId: 'session-a' })
})
