/**
 * Package verification: the archive, and the mandatory Profile run of it.
 *
 * This script owns the packaging half — which bytes ship, under which identity,
 * and whether a real Profile installs, composes, records and removes that exact
 * archive. It no longer builds a second hand-made Context runtime: behaviour is
 * verified by the real Profile entry (`scripts/smoke-profile.mjs`), which this
 * script runs as a required child against the same archive bytes and the same
 * selected Host root. A non-zero child fails the package check; there is no
 * report-present shortcut.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lockedHostDependencies } from './host-dependencies.mjs'
import { ALLOWED_ENTRY, REQUIRED_ENTRIES, assertArchiveEntries } from './package-inspection.mjs'
import { SOURCE, archiveIdentity, createHostResolver, installedPathFor } from './selected-host.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostRoot = process.env.PROJECT_OPS_HOST_ROOT ? resolve(process.env.PROJECT_OPS_HOST_ROOT) : undefined
/**
 * Resolve the selected Host's own installed SDK.
 *
 * The SDK must come from the selected root's own `node_modules/@deepseek-ai/dsh`
 * link, for the checkout default as well as for an explicit Host: a plain
 * `createRequire(hostRoot/package.json)` would walk up the directory tree and
 * borrow an SDK from an unrelated ancestor, letting an empty Host pass.
 */
const selectedHost = createHostResolver(hostRoot ?? pluginRoot,
  { sourceKind: hostRoot === undefined ? SOURCE.checkout : SOURCE.caller })
const dshPackageRoot = dirname(selectedHost.resolvePackage('@deepseek-ai/dsh').manifestPath)
const dshCli = join(dshPackageRoot, 'lib', 'bin.js')
// The selected Host reports its own version: a printed constant would go stale
// the moment the harness line moves.
const dshVersion = JSON.parse(readFileSync(join(dshPackageRoot, 'package.json'), 'utf8')).version
const sourceVersion = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).version
/**
 * One whitelist for the whole repository: the required entries and the allowed
 * entry pattern come from `package-inspection.mjs`, so this smoke check cannot
 * drift behind a newly added document or image directory the way a private copy
 * of the list did.
 */
const expectedEntries = [
  ...REQUIRED_ENTRIES,
  // The client half and the shared node chunk live in lib/ subdirectories, so
  // the list walks the emitted tree instead of one flat directory level.
  ...readdirSync(join(pluginRoot, 'lib'), { recursive: true })
    .filter(name => /\.(?:js|d\.ts)$/u.test(name))
    .map(name => `package/lib/${name.split('\\').join('/')}`),
  ...REQUIRED_ENTRIES.filter(name => name.endsWith('README.md')).map(name => name.replace('README.md', 'README.zh.md')),
  'package/README.i18n.yaml',
  'package/LICENSE',
  'package/cordis.patch.yml',
  'package/package.json',
].sort()
const expectedPatch = '- insert:\n    - id: missher-project-ops\n      name: "@missher/dsh-project-ops"\n'

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? pluginRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    // The mandatory Profile child boots a real Host and installs a Profile, so a
    // caller that names an archive gets the same generous window the standalone
    // profile script uses.
    timeout: options.env?.PROJECT_OPS_ARCHIVE === undefined ? undefined : 30 * 60 * 1000,
    shell: options.shell ?? false,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})${output === '' ? '' : `:\n${output}`}`)
  }
  return result.stdout ?? ''
}

function directorySentinel(path) {
  if (!existsSync(path)) return 'absent'
  const stat = lstatSync(path)
  invariant(stat.isDirectory(), 'live DSH_HOME exists but is not a directory')
  const names = readdirSync(path).sort()
  return createHash('sha256').update(JSON.stringify(names)).digest('hex')
}

function readProfileManifest(home, profile) {
  return JSON.parse(readFileSync(join(home, 'profiles', profile, 'package.json'), 'utf8'))
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-project-ops-smoke-'))
const temporaryHome = join(temporaryRoot, 'home')
const packDir = join(temporaryRoot, 'pack')
const profile = 'project-ops-smoke'
const liveHome = join(homedir(), '.dsh')
const liveBefore = directorySentinel(liveHome)
const cli = [dshCli]
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const isolatedEnv = { ...process.env, DSH_HOME: temporaryHome,
  ...hostRoot ? { npm_config_legacy_peer_deps: 'true', npm_config_prefer_offline: 'true' } : {} }
const originalDshHome = process.env.DSH_HOME
process.env.DSH_HOME = temporaryHome

try {
  mkdirSync(packDir)
  for (const required of [
    'LICENSE',
    'README.i18n.yaml',
    'README.md',
    'README.zh.md',
    'cordis.patch.yml',
    'lib/index.d.ts',
    'lib/index.js',
    'package.json',
  ]) {
    invariant(existsSync(join(pluginRoot, required)), `required package file is missing: ${required}`)
  }
  invariant(readFileSync(join(pluginRoot, 'cordis.patch.yml'), 'utf8') === expectedPatch, 'Bundle patch is not exact')

  const packed = JSON.parse(run(npmCommand, ['pack', '--json', '--pack-destination', packDir], {
    cwd: pluginRoot,
    shell: process.platform === 'win32',
  }))
  invariant(Array.isArray(packed) && packed.length === 1, 'npm pack returned an unexpected manifest')
  const archive = join(packDir, packed[0].filename)
  // One archive feeds everything below: identity, entry whitelist, install,
  // Bundle activation, byte comparison and the mandatory Profile run.
  const archiveSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex')
  const identity = archiveIdentity(run('tar', ['-xOf', archive, 'package/package.json']),
    JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).name)
  const packageName = identity.name
  const entries = run('tar', ['-tzf', archive]).trim().split(/\r?\n/u).sort()
  // Required entries, duplicates, escaping paths and the allowed-name pattern is
  // one shared rule; this smoke check only adds the "exactly these files" part.
  assertArchiveEntries(entries)
  for (const entry of entries) {
    invariant(ALLOWED_ENTRY.test(entry), `archive entry outside the shared whitelist: ${entry}`)
  }
  for (const required of expectedEntries) {
    invariant(entries.includes(required), `archive is missing the built entry: ${required}`)
  }
  invariant(entries.length === new Set(entries).size, 'archive contains duplicate entries')

  const archiveText = expectedEntries
    .filter(entry => !entry.endsWith('LICENSE'))
    .map(entry => run('tar', ['-xOf', archive, entry]))
    .join('\n')
  const forbidden = [
    pluginRoot,
    homedir(),
    'sourceMappingURL=',
    'BEGIN PRIVATE KEY',
  ]
  for (const value of forbidden) invariant(!archiveText.includes(value), `archive contains forbidden text: ${value}`)
  invariant(!/(?:api[_-]?key|authorization)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i.test(archiveText), 'archive contains secret-shaped text')

  run(process.execPath, [...cli, 'plugin', '--profile', profile, 'add', archive], { env: isolatedEnv })
  const installed = readProfileManifest(temporaryHome, profile)
  invariant(installed.dependencies?.[packageName] !== undefined, `temporary Profile dependency ${packageName} was not installed`)
  invariant(installed.dsh?.profile?.bundles?.includes(packageName), `temporary Profile Bundle layer ${packageName} was not activated`)

  const dumped = run(process.execPath, [...cli, '--profile', profile, '--dump-config'], { env: isolatedEnv })
  invariant(dumped.includes('missher-project-ops'), 'temporary Profile did not compose the plugin row')

  const runtimeRoot = join(temporaryRoot, 'runtime')
  mkdirSync(runtimeRoot)
  run('tar', ['-xzf', archive, '-C', runtimeRoot])
  const profileDir = join(temporaryHome, 'profiles', profile)
  const installedEntry = join(installedPathFor(join(profileDir, 'node_modules'), packageName), 'lib', 'index.js')
  const packedEntry = join(runtimeRoot, 'package', 'lib', 'index.js')
  invariant(
    createHash('sha256').update(readFileSync(installedEntry)).digest('hex')
      === createHash('sha256').update(readFileSync(packedEntry)).digest('hex'),
    'installed entry bytes differ from the packed entry',
  )
  // Supply host peers to the installed Bundle from the pinned validation runtime.
  const installedPackage = dirname(dirname(installedEntry))
  if (hostRoot) {
    // Install declared host peers in the isolated Profile, with no developer dependency links.
    const peers = lockedHostDependencies(pluginRoot)
    run(npmCommand, ['install', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', ...peers], { cwd: profileDir, env: isolatedEnv, shell: process.platform === 'win32' })
  } else if (!existsSync(join(installedPackage, 'node_modules'))) {
    symlinkSync(join(pluginRoot, 'node_modules'), join(installedPackage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  }

  // Mandatory real-Profile verification of THIS archive. The profile script
  // receives the archive and its digest, so it re-checks the same bytes instead
  // of packing its own, and it drives the same selected Host root. A non-zero
  // child throws out of `run`, which fails the package check: the report alone
  // never counts as a pass.
  run(process.execPath, [join(pluginRoot, 'scripts', 'smoke-profile.mjs')], {
    env: {
      ...process.env,
      PROJECT_OPS_ARCHIVE: archive,
      PROJECT_OPS_ARCHIVE_SHA256: archiveSha256,
      ...hostRoot === undefined ? {} : { PROJECT_OPS_HOST_ROOT: hostRoot },
    },
  })

  run(process.execPath, [...cli, 'plugin', '--profile', profile, 'remove', packageName], { env: isolatedEnv })
  const removed = readProfileManifest(temporaryHome, profile)
  invariant(removed.dependencies?.[packageName] === undefined, `temporary Profile dependency ${packageName} survived removal`)
  invariant(!removed.dsh?.profile?.bundles?.includes(packageName), `temporary Profile Bundle layer ${packageName} survived removal`)
  invariant(directorySentinel(liveHome) === liveBefore, 'live ~/.dsh top-level sentinel changed')

  process.stdout.write(`archive-identity: ${packageName}@${identity.version ?? sourceVersion}, Harness ${dshVersion}\n`)
  process.stdout.write(`archive-sha256: ${archiveSha256}\n`)
  process.stdout.write('project-ops-smoke: PASS archive identity, entry whitelist, isolated install and Bundle activation, dump-config composition, installed/packed byte equality, mandatory real-Profile verification, removal, live-home sentinel\n')
} finally {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  rmSync(temporaryRoot, { recursive: true, force: true })
}
