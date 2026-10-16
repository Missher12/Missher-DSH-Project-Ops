import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectArchive } from './package-inspection.mjs'
import { createHostResolver, describeHost } from './selected-host.mjs'
import { failureDetail, fixtureEvidenceFor, runDriverCommand, uploadDocument } from './fixtures/driver-diagnostics.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostRoot = process.env.PROJECT_OPS_HOST_ROOT ? resolve(process.env.PROJECT_OPS_HOST_ROOT) : undefined
const host = createHostResolver(hostRoot ?? root)
// The SDK version is read from the selected Host, not pinned here: the same
// script must run against the community rc.2 / alpha.2 roots and the official
// npm alpha line. Set PROJECT_OPS_HOST_VERSION to demand one exact version.
const pinnedVersion = process.env.PROJECT_OPS_HOST_VERSION
const { manifestPath: dshManifestPath, manifest: dshManifest } = host.resolvePackage('@deepseek-ai/dsh', pinnedVersion)
const cli = join(dirname(dshManifestPath), 'lib/bin.js')
const nodeBinary = process.env.PROJECT_OPS_NODE ? resolve(process.env.PROJECT_OPS_NODE) : process.execPath
const overlay = process.env.PROJECT_OPS_EXTRA_PATCH ? resolve(process.env.PROJECT_OPS_EXTRA_PATCH) : undefined
assert(existsSync(nodeBinary), 'selected Node executable is missing')
if (overlay) assert(existsSync(overlay), 'selected composition patch is missing')
// CI uploads this directory only: allowlisted fields, capped strings, scrubbed
// credentials and local paths. The full local evidence stays in evidenceRoot.
const ciEvidence = join(root, '.artifacts/ci-diagnostics')
const evidenceRoot = join(root, '.artifacts/official-compat')
mkdirSync(evidenceRoot, { recursive: true })
const directory = mkdtempSync(join(evidenceRoot, 'profile-'))
const home = join(directory, 'home')
const dshHome = join(directory, 'dsh-home')
const workspace = join(directory, 'project')
const pack = join(directory, 'pack')
for (const path of [home, dshHome, workspace, pack]) mkdirSync(path, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^DSH_|^DEEPSEEK_/i.test(name)))
Object.assign(env, { HOME: home, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'workspace-write' })
const liveHome = join(homedir(), '.dsh')
const sentinel = () => existsSync(liveHome) ? createHash('sha256').update(JSON.stringify(readdirSync(liveHome).sort())).digest('hex') : 'absent'
const before = sentinel()
/** Current stage of the run; the failure record names it instead of leaving the step implicit. */
let phase = 'startup'
const setPhase = name => { phase = name }
/** Facts of the last driver command, kept for the failure record. */
let lastFacts = null
let ordinal = 0

/** Run one driver command through the shared chain: facts are recorded before any assertion. */
function run(command, args, cwd = workspace) {
  const { result, facts } = runDriverCommand({ command, args, cwd, env, directory, phase, ordinal: ordinal++,
    shell: command.endsWith('.cmd') })
  lastFacts = facts
  if (result.error !== undefined || result.status !== 0) {
    // Null-safe: a CLI that produced no fixture report still reports its own exit
    // status instead of dereferencing a missing summary.
    const evidence = fixtureEvidenceFor(directory, phase)
    const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim()
    throw new Error(failureDetail({ evidence, facts, fallback: `${command} failed`, output }))
  }
  return result.stdout
}
run.count = 0
const dsh = args => run(nodeBinary, [cli, ...args])
const profile = 'project-ops-official-test'
const profileDir = join(dshHome, 'profiles', profile)
/** Filled as soon as the archive is inspected; stays null when the run fails earlier. */
let inspectedIdentity = null
try {
  // A run that dies before writing must not leave the previous run's projection
  // behind: CI uploads whatever is there, and a stale success would misreport it.
  rmSync(join(ciEvidence, 'smoke-profile.json'), { force: true })
  let archive
  if (process.env.PROJECT_OPS_ARCHIVE) {
    assert(process.env.PROJECT_OPS_ARCHIVE_SHA256, 'a fixed archive requires PROJECT_OPS_ARCHIVE_SHA256')
    archive = resolve(process.env.PROJECT_OPS_ARCHIVE)
  } else {
    assert(!process.env.PROJECT_OPS_ARCHIVE_SHA256, 'archive checksum supplied without an archive')
    const packed = JSON.parse(run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--json', '--pack-destination', pack], root))[0]
    archive = join(pack, packed.filename)
  }
  const inspected = inspectArchive(archive, process.env.PROJECT_OPS_ARCHIVE_SHA256)
  const archiveSha256 = inspected.sha256
  inspectedIdentity = { name: inspected.manifest.name, version: inspected.manifest.version, sha256: inspected.sha256, bytes: inspected.bytes }
  const hostEvidence = { host: describeHost(host), cli, cliSha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
    selectedNode: nodeBinary, archive, archiveSha256,
    extraPatch: overlay ? { path: overlay, sha256: createHash('sha256').update(readFileSync(overlay)).digest('hex') } : null }
  writeFileSync(join(directory, 'selected-runtime.json'), JSON.stringify(hostEvidence, null, 2) + '\n', { flag: 'wx' })
  // Initialize a named Profile from the official headless template without launching a second application entry.
  setPhase('initialize-profile')
  dsh(['--profile', profile, '--from-default-profile', 'headless', '--dump-config'])
  setPhase('install-archive')
  dsh(['plugin', '--profile', profile, 'add', archive])
  const installed = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert(installed.dsh.profile.bundles.includes(inspectedIdentity.name))
  const app = join(workspace, 'packages/app')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ private: true, packageManager: 'npm@10', workspaces: ['packages/*'] }))
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: '@profile/app', scripts: { verify: 'node verify.cjs', long: 'node long.cjs' } }))
  writeFileSync(join(app, 'input.js'), 'export const changed = false\n')
  writeFileSync(join(app, 'verify.cjs'), "const fs = require('node:fs'); fs.mkdirSync('.output', {recursive:true}); fs.writeFileSync('.output/verified', 'yes');\n")
  writeFileSync(join(app, 'long.cjs'), "const fs = require('node:fs'); fs.mkdirSync('.output', {recursive:true}); fs.writeFileSync('.output/pid', String(process.pid)); setInterval(() => fs.writeFileSync('.output/heartbeat', String(Date.now())), 50);\n")
  const fixture = join(profileDir, 'project-ops-probe.mjs')
  cpSync(join(root, 'scripts/fixtures/official-profile.mjs'), fixture)
  cpSync(join(root, 'scripts/fixtures/probe-evidence.mjs'), join(profileDir, 'probe-evidence.mjs'))
  const patch = join(profileDir, 'cordis.patch.yml')
  const configure = removed => {
    const rows = [
      { id: 'headless-startup', disabled: true }, { id: 'headless-runner', disabled: true },
      { id: process.platform === 'win32' ? 'pwsh-sandbox' : 'bash-sandbox', config: { timeoutMs: 1500, maxTimeoutMs: 2000, graceMs: 100 } },
      ...removed ? [] : [{ id: 'missher-project-ops', config: { snapshotOutputDirectories: ['packages/app/.output'] } }],
      { insert: [{ id: 'project-ops-profile-probe', name: './project-ops-probe.mjs', config: {
        removed, workspace, hostEvidence, report: join(directory, removed ? 'removed.json' : 'installed.json'),
      } }] },
    ]
    writeFileSync(patch, JSON.stringify(rows, null, 2) + '\n')
  }
  configure(false)
  setPhase('probe-installed')
  console.log('official-profile: booting installed plugin through dsh')
  dsh(['--profile', profile, ...overlay ? ['--patch', overlay] : []])
  const actual = JSON.parse(readFileSync(join(directory, 'installed.json'), 'utf8'))
  assert.equal(actual.passed, true)
  assert.deepEqual(actual.modelProjection, JSON.parse(readFileSync(join(root, 'tests/fixtures/official-profile.expected.json'), 'utf8')))
  // The removal names the package the archive manifest declares, not a constant.
  setPhase('remove-plugin')
  dsh(['plugin', '--profile', profile, 'remove', inspected.manifest.name])
  configure(true)
  setPhase('probe-removed')
  console.log('official-profile: checking tool and prompt absence after CLI removal')
  dsh(['--profile', profile, ...overlay ? ['--patch', overlay] : []])
  const removed = JSON.parse(readFileSync(join(directory, 'removed.json'), 'utf8'))
  assert.equal(removed.passed, true)
  assert.equal(sentinel(), before)
  const referenceSha = process.env.PROJECT_OPS_HOST_REFERENCE_SHA ?? null
  const report = { passed: true, hostVersion: dshManifest.version,
    // Only a caller-supplied, already-verified reference may carry a commit id.
    // Reusing one release's commit for a different target would misattribute it,
    // so an unverified source records null instead.
    officialReferenceSha: referenceSha,
    referenceSource: referenceSha === null
      ? 'null: no verified commit id for this target in this run'
      : 'caller-supplied verified reference via PROJECT_OPS_HOST_REFERENCE_SHA',
    runtimeSource: host.installation.source.kind === 'checkout'
      ? 'Checkout install selected by default; package version is not source-SHA attestation'
      : `Caller-selected runtime (${host.installation.source.label}); a label is not a distribution proof, and the package version is not source-SHA attestation`,
    hostRoot: hostRoot ?? null, hostInstallation: host.installation, nodeBinary, cli,
    extraPatch: overlay ? { path: overlay, sha256: createHash('sha256').update(readFileSync(overlay)).digest('hex') } : null,
    cliSha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
    lockfileSha256: createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex'),
    archive, archiveSha256, archiveBytes: inspected.bytes,
    pluginVersion: inspected.manifest.version, driverNode: process.version, ...actual.runtime,
    installed: actual, removed, liveHomeSentinelUnchanged: true,
    limitations: ['No live model API or Desktop UI', 'OS/architecture results apply only to this run', 'Headless-derived host smoke does not replace final Electron/platform acceptance'] }
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  mkdirSync(ciEvidence, { recursive: true })
  // Replace, never append with `wx`: the same checkout can run this repeatedly,
  // and this file only ever holds the current run's minimal projection. The
  // complete raw evidence stays in the per-attempt mkdtemp directories.
  writeFileSync(join(ciEvidence, 'smoke-profile.json'), JSON.stringify(uploadDocument({
    passed: true,
    phase,
    platform: { node: process.version, os: process.platform, arch: process.arch },
    selectedRuntime: { source: host.installation.source, sdkVersion: dshManifest.version, archive: inspectedIdentity },
    evidence: fixtureEvidenceFor(directory, phase),
    facts: lastFacts,
    original: null,
    installed: actual,
    removed,
  }), null, 2) + '\n')
  console.log(JSON.stringify({ passed: true, evidence: join(directory, 'report.json'), ciEvidence, archiveSha256 }))
} catch (error) {
  // The original failure is the record. Diagnostic and cleanup problems are
  // recorded beside it and never replace it.
  const original = String(error.stack ?? error)
  const evidence = fixtureEvidenceFor(directory, phase)
  // The generated patch layer is kept on purpose: it is the reproduction input
  // for the failure. Cleanup problems are recorded, never rethrown over this error.
  const cleanupError = evidence.summary?.cleanupError ?? null
  const failure = { passed: false, phase, error: original,
    fixtureEvidence: evidence.relativePath ?? evidence.note,
    fixtureSummary: evidence.summary ?? null,
    driver: lastFacts,
    cleanupError }
  try {
    writeFileSync(join(directory, 'failure.json'), JSON.stringify(failure, null, 2) + '\n', { flag: 'wx' })
  } catch { /* the thrown error below stays the primary signal */ }
  try {
    mkdirSync(ciEvidence, { recursive: true })
    writeFileSync(join(ciEvidence, 'smoke-profile.json'), JSON.stringify(uploadDocument({
      passed: false,
      phase,
      platform: { node: process.version, os: process.platform, arch: process.arch },
      selectedRuntime: { source: host.installation.source, sdkVersion: dshManifest.version, archive: inspectedIdentity },
      evidence,
      facts: lastFacts,
      original,
      cleanupError,
    }), null, 2) + '\n')
  } catch { /* evidence upload is best effort; the failure above still stands */ }
  throw error
}
