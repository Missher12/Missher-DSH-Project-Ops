import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectArchive } from './package-inspection.mjs'
import { createHostResolver } from './selected-host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostRoot = process.env.PROJECT_OPS_HOST_ROOT ? resolve(process.env.PROJECT_OPS_HOST_ROOT) : undefined
const host = createHostResolver(hostRoot ?? root)
const { manifestPath: dshManifestPath, manifest: dshManifest } = host.resolvePackage('@deepseek-ai/dsh', '0.1.5-rc.2')
const cli = join(dirname(dshManifestPath), 'lib/bin.js')
const nodeBinary = process.env.PROJECT_OPS_NODE ? resolve(process.env.PROJECT_OPS_NODE) : process.execPath
const overlay = process.env.PROJECT_OPS_EXTRA_PATCH ? resolve(process.env.PROJECT_OPS_EXTRA_PATCH) : undefined
assert(existsSync(nodeBinary), 'selected Node executable is missing')
if (overlay) assert(existsSync(overlay), 'selected composition patch is missing')
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
function run(command, args, cwd = workspace) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000,
    shell: command.endsWith('.cmd') })
  const ordinal = run.count++
  writeFileSync(join(directory, `command-${ordinal}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { flag: 'wx' })
  writeFileSync(join(directory, `command-${ordinal}.json`), JSON.stringify({ executable: command, args, cwd,
    processExitCode: result.status, processSignal: result.signal, timedOut: 'unavailable',
    error: result.error ? { message: result.error.message, code: result.error.code ?? 'unavailable' } : 'unavailable',
    note: 'These are driver subprocess facts, not the declared task exit code or signal.' }, null, 2) + '\n', { flag: 'wx' })
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}
run.count = 0
const dsh = args => run(nodeBinary, [cli, ...args])
const profile = 'project-ops-official-test'
const profileDir = join(dshHome, 'profiles', profile)
try {
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
  const hostEvidence = { installation: host.installation, cli, cliSha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
    selectedNode: nodeBinary, archive, archiveSha256,
    extraPatch: overlay ? { path: overlay, sha256: createHash('sha256').update(readFileSync(overlay)).digest('hex') } : null }
  writeFileSync(join(directory, 'selected-runtime.json'), JSON.stringify(hostEvidence, null, 2) + '\n', { flag: 'wx' })
  // Initialize a named Profile from the official headless template without launching a second application entry.
  dsh(['--profile', profile, '--from-default-profile', 'headless', '--dump-config'])
  dsh(['plugin', '--profile', profile, 'add', archive])
  const installed = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert(installed.dsh.profile.bundles.includes('dsh-project-ops'))
  const app = join(workspace, 'packages/app')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ private: true, packageManager: 'npm@10', workspaces: ['packages/*'] }))
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: '@profile/app', scripts: { verify: 'node verify.cjs', long: 'node long.cjs' } }))
  writeFileSync(join(app, 'input.js'), 'export const changed = false\n')
  writeFileSync(join(app, 'verify.cjs'), "const fs = require('node:fs'); fs.mkdirSync('.output', {recursive:true}); fs.writeFileSync('.output/verified', 'yes');\n")
  writeFileSync(join(app, 'long.cjs'), "const fs = require('node:fs'); fs.mkdirSync('.output', {recursive:true}); fs.writeFileSync('.output/pid', String(process.pid)); setInterval(() => {}, 1000);\n")
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
  console.log('official-profile: booting installed plugin through dsh')
  dsh(['--profile', profile, ...overlay ? ['--patch', overlay] : []])
  const actual = JSON.parse(readFileSync(join(directory, 'installed.json'), 'utf8'))
  assert.equal(actual.passed, true)
  assert.deepEqual(actual.modelProjection, JSON.parse(readFileSync(join(root, 'tests/fixtures/official-profile.expected.json'), 'utf8')))
  dsh(['plugin', '--profile', profile, 'remove', 'dsh-project-ops'])
  configure(true)
  console.log('official-profile: checking tool and prompt absence after CLI removal')
  dsh(['--profile', profile, ...overlay ? ['--patch', overlay] : []])
  const removed = JSON.parse(readFileSync(join(directory, 'removed.json'), 'utf8'))
  assert.equal(removed.passed, true)
  assert.equal(sentinel(), before)
  const report = { passed: true, officialVersion: dshManifest.version,
    officialReferenceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203',
    runtimeSource: hostRoot ? 'Explicit caller-supplied runtime; package version is not source-SHA attestation' : 'Exact public npm packages from this checkout lockfile',
    hostRoot: hostRoot ?? null, hostInstallation: host.installation, nodeBinary, cli,
    extraPatch: overlay ? { path: overlay, sha256: createHash('sha256').update(readFileSync(overlay)).digest('hex') } : null,
    cliSha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
    lockfileSha256: createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex'),
    archive, archiveSha256, archiveBytes: inspected.bytes,
    pluginVersion: inspected.manifest.version, driverNode: process.version, ...actual.runtime,
    installed: actual, removed, liveHomeSentinelUnchanged: true,
    limitations: ['No live model API or Desktop UI', 'OS/architecture results apply only to this run', 'Headless-derived host smoke does not replace final Electron/platform acceptance'] }
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ passed: true, evidence: join(directory, 'report.json'), archiveSha256 }))
} catch (error) {
  writeFileSync(join(directory, 'failure.json'), JSON.stringify({ passed: false, error: String(error.stack ?? error) }, null, 2) + '\n', { flag: 'wx' })
  throw error
}
