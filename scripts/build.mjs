import { existsSync, renameSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const lib = fileURLToPath(new URL('../lib', import.meta.url))
const backup = fileURLToPath(new URL('../.lib-backup', import.meta.url))
const entry = fileURLToPath(new URL('../lib/browser/client.js', import.meta.url))

/**
 * Restore a build left behind by a killed run before touching anything: the
 * backup is the last known-good distributable, the current `lib` may be partial.
 */
function recoverInterrupted() {
  if (!existsSync(backup)) return
  rmSync(lib, { recursive: true, force: true })
  renameSync(backup, lib)
}

/**
 * Move the previous build aside so a failed run cannot destroy it.
 * @returns whether a previous build was moved aside.
 */
function keepPrevious() {
  if (!existsSync(lib)) return false
  renameSync(lib, backup)
  return true
}

/** Delete a partial build and put the previous one back. */
function restorePrevious(kept) {
  rmSync(lib, { recursive: true, force: true })
  if (kept && existsSync(backup)) renameSync(backup, lib)
}

recoverInterrupted()
const kept = keepPrevious()
try {
  execFileSync(process.execPath, [require.resolve('tsdown/run'), '--config', 'tsdown.config.ts'], { stdio: 'inherit' })
  if (!existsSync(entry)) throw new Error(`build produced no ${entry}`)
} catch (error) {
  restorePrevious(kept)
  const reason = typeof error?.signal === 'string'
    ? error.signal
    : typeof error?.status === 'number' ? `exit ${String(error.status)}` : 'unknown failure'
  console.error(`build failed (${reason}); ${kept ? 'previous lib restored' : 'no previous lib to restore'}`)
  // The native bundler binding is the usual failure on a hardened macOS Node:
  // an ad-hoc signed binding cannot load next to a Team-ID-signed runtime.
  console.error('if this crashed in rolldown, reinstall the native binding or build under a non-hardened Node')
  process.exit(1)
}
rmSync(backup, { recursive: true, force: true })
