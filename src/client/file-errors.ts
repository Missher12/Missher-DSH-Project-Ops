/**
 * Classification of a file action the Host refused.
 *
 * Both the native preview and "open location" run the same availability probe,
 * so both read one classification instead of each inventing its own. The Host
 * names a missing entry with its own code; metadata faults such as EACCES/EPERM
 * cross the gateway as `gateway/internal` with the Node errno message, so only
 * that explicit signature is treated as a permission refusal — a plain error, a
 * capability that this Host lacks, or an access-denied message without the
 * signature keeps its own detail instead of being reported as a missing file.
 */

/** Why one file action did not happen, in the terms the panel can explain. */
export type FileOutcome = 'missing' | 'denied' | 'failed'

/** A file-action refusal carrying the outcome the panel maps to one short sentence. */
export class FileError extends Error {
  constructor(readonly outcome: FileOutcome, message: string) {
    super(message)
    this.name = 'FileError'
  }
}

/** The Host's own code for an entry that is no longer at the recorded path. */
const MISSING_CODE = 'workspace-file/not-found'

/** The Host's structured permission code, and the errno marker that starts a metadata fault. */
const PERMISSION_CODE = 'FS_PERMISSION_DENIED'
// Node prefixes its filesystem errors with the errno marker (`EACCES:`/`EPERM:`);
// anchoring keeps a path like `EACCES.xlsx` inside an EIO message from matching.
const PERMISSION_ERRNO = /^(?:EACCES|EPERM):/u

/**
 * Classify one Host file failure from its real code or errno signature.
 * @param error - a failed stat/reveal result's `{ code, message }`.
 * @returns `missing` or `denied` when the failure is recognized, otherwise `undefined`.
 */
export function classifyHostFileFailure(error: { code?: string; message?: string }): 'missing' | 'denied' | undefined {
  if (error.code === MISSING_CODE) return 'missing'
  if (error.code === PERMISSION_CODE) return 'denied'
  // A raw EACCES/EPERM from the filesystem is wrapped by the gateway as
  // `gateway/internal`; the errno token is the only discriminator left.
  if (error.code === 'gateway/internal' && PERMISSION_ERRNO.test(error.message ?? '')) return 'denied'
  return undefined
}
