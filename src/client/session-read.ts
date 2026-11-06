/**
 * One session's last bounded read.
 *
 * The panel keeps the last successful rows while a newer read runs in the
 * background; the same state must never leak a previous session's rows, errors
 * or count. Keeping the session id beside the data makes both rules explicit:
 * a read belongs to exactly one session, and starting a read for the same
 * session retains its last result instead of unmounting the list.
 */

/** One session's last read: its rows, the error of the latest attempt, or neither. */
export interface SessionRead<T> {
  sessionId: string
  result?: T
  error?: string
}

/**
 * The read that belongs to this session, if any.
 * @param read - the last read of any session.
 * @param sessionId - the session the panel is showing now.
 * @returns the read, or `undefined` when it belongs to another session.
 */
export function readFor<T>(read: SessionRead<T> | undefined, sessionId: string): SessionRead<T> | undefined {
  return read?.sessionId === sessionId ? read : undefined
}

/**
 * The state at the start of a read: keep this session's last successful result
 * so its rows stay mounted, and drop an error or another session's data.
 * @param previous - the last read of any session.
 * @param sessionId - the session being read.
 * @returns the state while the read is in flight.
 */
export function beginRead<T>(previous: SessionRead<T> | undefined, sessionId: string): SessionRead<T> {
  return previous?.sessionId === sessionId && previous.result !== undefined
    ? { sessionId, result: previous.result }
    : { sessionId }
}

/**
 * The state after a failed read: this session keeps its last successful rows
 * next to the error; another session starts with the error only.
 * @param previous - the last read of any session.
 * @param sessionId - the session that failed.
 * @param error - the failure detail.
 * @returns the state with the error and, on the same session, the old rows.
 */
export function failRead<T>(previous: SessionRead<T> | undefined, sessionId: string, error: string): SessionRead<T> {
  return previous?.sessionId === sessionId && previous.result !== undefined
    ? { sessionId, result: previous.result, error }
    : { sessionId, error }
}
