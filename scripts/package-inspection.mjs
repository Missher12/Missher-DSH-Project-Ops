import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Platform module-table rows the Host shell answers for every client bundle.
 * They are deliberately not npm dependencies of this package: `react-dom` is
 * not installed here at all, and the primitives package is ESM importing CSS,
 * which plain `require` cannot execute. A format check substitutes only what is
 * unavailable locally and reports every substitution; the real surface of each
 * row is verified against the installed official artifact by
 * `scripts/check-ui-contract.mjs`, and end to end by the isolated Host run.
 */
const PLATFORM_STUBS = new Map([
  ['react-dom', () => ({ createPortal: (children) => children })],
  ['@deepseek-ai/dsh-client-ui-primitives', () => {
    const icon = () => null
    return {
      StateDot: icon,
      IconArchiveOutlineRegular: icon,
      IconChecklistOutlineRegular: icon,
      IconChevronDownOutlineRegular: icon,
      IconCloseOutlineRegular: icon,
      IconDeliverDocRegular: icon,
      IconInspectOutlineRegular: icon,
      IconRefreshOutlineRegular: icon,
      useAnchoredPosition: () => null,
      useDismissOnOutsidePointer: () => {},
    }
  }],
])

export const REQUIRED_ENTRIES = [
  'LICENSE', 'README.md', 'README.zh.md', 'README.i18n.yaml', 'package.json', 'cordis.patch.yml',
  'docs/AGENT_USAGE.md', 'docs/CORDIS_INTEGRATION.md', 'docs/OFFICIAL_COMPAT.md',
  'lib/browser/client.js', 'lib/client/index.js', 'lib/client/index.d.ts', 'lib/index.js', 'lib/index.d.ts', 'lib/cordis.js', 'lib/cordis.d.ts',
].map(name => `package/${name}`)
export const ALLOWED_ENTRY = /^package\/(?:lib\/(?:(?:client|browser)\/)?[A-Za-z0-9_.-]+\.(?:js|d\.ts)|docs\/(?:AGENT_USAGE|CORDIS_INTEGRATION|OFFICIAL_COMPAT|TASK_DOCUMENTS|COMPATIBILITY)\.md|docs\/images\/[A-Za-z0-9_.-]+\.(?:png|jpg|webp|md)|README(?:\.zh\.md|\.md|\.i18n\.yaml)|LICENSE|cordis\.patch\.yml|package\.json)$/u

/**
 * Host peer ranges Project Ops is verified against: one branch per release line,
 * because semver only admits a prerelease when a comparator on the same
 * [major, minor, patch] tuple also carries a prerelease. Evidence and the
 * inclusion matrix live in scripts/check-peer-ranges.mjs.
 */
export const DSH_PEER_RANGE = '>=0.2.0-rc.2 <0.3.0-0 || ^0.2.1-alpha.2'

/** Cordis range covering the 4.0.4 and 4.0.5 release lines. */
export const CORDIS_PEER_RANGE = '^4.0.4 || ^4.0.5-alpha.1'

/** Reject wildcards and any open upper bound: a peer must name what was tested. */
function assertBoundedRange(value, label) {
  assert.equal(typeof value, 'string')
  assert.doesNotMatch(value, /(^|\s)(\*|x|latest)(\s|$)/u, `${label} must not be a blanket range`)
  // `^`/`~`/`<` all express an upper bound; a bare `>=x` or `>x` does not.
  assert.match(value, /[<^~]/u, `${label} must carry an upper bound`)
}

/** Validate the package's public entries, verified host peer ranges and Bundle declaration. */
export function assertPackageManifest(manifest) {
  assert.equal(manifest.name, '@missher/dsh-project-ops')
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.types, 'lib/index.d.ts')
  assert.equal(manifest.bin, undefined, 'Project Ops has no product executable entry')
  assert.deepEqual(manifest.exports['.'], { types: './lib/index.d.ts', default: './lib/index.js' })
  assert.deepEqual(manifest.exports['./cordis'], { types: './lib/cordis.d.ts', default: './lib/cordis.js' })
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], CORDIS_PEER_RANGE)
  assertBoundedRange(manifest.peerDependencies['@deepseek-ai/cordis'], '@deepseek-ai/cordis')
  for (const name of ['agent', 'fs', 'jobs', 'llm', 'tools', 'util-values']) {
    assert.equal(manifest.peerDependencies[`@deepseek-ai/dsh-${name}`], DSH_PEER_RANGE)
    assertBoundedRange(manifest.peerDependencies[`@deepseek-ai/dsh-${name}`], `@deepseek-ai/dsh-${name}`)
  }
  // The SDK anchor stays exactly pinned so a local build is reproducible; the
  // surrounding toolchain keeps its normal caret ranges.
  for (const [name, range] of Object.entries(manifest.devDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/')) continue
    assert.match(range, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, `SDK development dependency ${name} must be exactly pinned`)
  }
  assert.deepEqual(Object.keys(manifest.peerDependenciesMeta).sort(), Object.keys(manifest.peerDependencies).sort())
  assert(Object.values(manifest.peerDependenciesMeta).every(value => value.optional === true))
}

/** Reject extra, duplicate and missing files before any archive content is copied to a consumer. */
export function assertArchiveEntries(entries) {
  assert.equal(new Set(entries).size, entries.length, 'duplicate archive entry')
  assert(entries.every(entry => ALLOWED_ENTRY.test(entry)), 'unexpected archive entry')
  for (const entry of REQUIRED_ENTRIES) assert(entries.includes(entry), `missing archive entry: ${entry}`)
}

/** Inspect a fixed tgz without extracting links or trusting its declared entry paths. */
export function inspectArchive(archive, expectedSha256) {
  const bytes = readFileSync(archive)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (expectedSha256 !== undefined) {
    assert.match(expectedSha256, /^[a-f0-9]{64}$/u, 'expected archive SHA-256 must be lowercase hex')
    assert.equal(sha256, expectedSha256, 'archive SHA-256 mismatch')
  }
  const tar = args => execFileSync('tar', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const entries = tar(['-tzf', archive]).trim().split(/\r?\n/u)
  assertArchiveEntries(entries)
  assert(tar(['-tvzf', archive]).trim().split(/\r?\n/u).every(line => line.startsWith('-')), 'archive must contain regular files only')
  const files = new Map(entries.map(entry => [entry, tar(['-xOf', archive, entry])]))
  const manifest = JSON.parse(files.get('package/package.json'))
  assertPackageManifest(manifest)
  assert.equal(manifest.exports['./client'].default, './lib/browser/client.js')
  let client
  runInNewContext(files.get('package/lib/browser/client.js'), { window: { __ModuleLoader__: { load: value => { client = value } } } }, { timeout: 1000 })
  assert.equal(client?.id, '@missher/dsh-project-ops')
  // Execute the closure factory against the platform rows it will find at
  // runtime: installed rows resolve normally, rows this repository never
  // installs (a Host platform row) fall back to the documented stub.
  const stubbed = []
  const load = {
    resolve: createRequire(import.meta.url),
    store: createRequire(join(repositoryRoot, 'node_modules/.pnpm/node_modules/package.json')),
    resolveRow(id) {
      for (const candidate of [this.resolve, this.store]) {
        try { return candidate(id) } catch { /* fall through to the next installation layout */ }
      }
      const stub = PLATFORM_STUBS.get(id)
      if (stub !== undefined) {
        stubbed.push(id)
        return stub()
      }
      return undefined
    },
  }
  const loaded = client.factory(id => {
    const row = load.resolveRow(id)
    assert.notEqual(row, undefined, `client bundle requires an unresolvable module: ${id}`)
    return row
  })
  assert.equal(typeof loaded.apply, 'function')
  // The archive must declare the contract the client half is built on: the slot
  // registry and the dictionaries are hard requirements, while the file remote
  // and the native preview stay optional (they are resolved through the kernel's
  // optional-inject callback and only disable their own half of the panel).
  const declared = Array.isArray(loaded.inject) ? loaded.inject : []
  for (const required of ['slots', 'locale']) {
    assert(declared.includes(required), `client bundle must require the ${required} service`)
  }
  for (const optional of ['remote', 'remote.workspaceFiles', 'sidebarRight']) {
    assert(!declared.includes(optional), `client bundle must not hard-require the optional ${optional} service`)
  }
  assert.equal(files.get('package/cordis.patch.yml'), '- insert:\n    - id: missher-project-ops\n      name: "@missher/dsh-project-ops"\n')
  for (const [name, text] of files) {
    assert(!text.includes('sourceMappingURL='), `source map reference in ${name}`)
    assert(!text.includes('BEGIN PRIVATE KEY'), `private key in ${name}`)
    if (name.startsWith('package/lib/')) assert(!/\/(?:Users|home)\//u.test(text), `development path in ${name}`)
  }
  return { manifest, entries, files, sha256, bytes: bytes.byteLength, stubbedPlatformRows: stubbed }
}
