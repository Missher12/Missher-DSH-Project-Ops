// Early fixed official Web Profile + three original bundles. All writes belong to this checkout's isolated run.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync, readdirSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHostResolver } from './selected-host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [selectionPath, runtime, nodeBinary, helperSource] = process.argv.slice(2).map(path => resolve(path))
assert(selectionPath && runtime && nodeBinary && helperSource, 'provide release state, official runtime, helper Node, helper source.json')
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const state = JSON.parse(readFileSync(selectionPath, 'utf8'))
const selection = ['project-ops', 'memory', 'evolution'].map(id => {
  const entry = state.pluginSelection.find(row => row.id === id)
  assert(entry, `missing selection: ${id}`)
  assert.equal(lstatSync(entry.archive).size, entry.bytes)
  assert.equal(hash(entry.archive), entry.sha256)
  return entry
})
assert.deepEqual(selection.map(p => p.version), ['0.3.1', '0.3.1', '0.7.1'])
const helper = JSON.parse(readFileSync(helperSource, 'utf8'))
assert.equal(hash(nodeBinary), helper.files.find(file => file.path === 'node').sha256)
const host = createHostResolver(runtime)
const cli = join(dirname(host.resolvePackage('@deepseek-ai/dsh', '0.1.5-rc.2').manifestPath), 'lib/bin.js')
const llm = host.resolvePackage('@deepseek-ai/dsh-llm', '0.1.5-rc.2')
const provenance = JSON.parse(readFileSync(join(runtime, 'provenance.json'), 'utf8'))
assert.equal(provenance.sourceSha, 'fb2c4b9e698e30edb738bca4cf0618587db7d203')
function checkRuntime() {
  for (const entry of provenance.files) {
    const path = join(runtime, entry.path)
    if (entry.kind === 'symlink') assert.equal(readlinkSync(path), entry.target, path)
    else { assert.equal(lstatSync(path).size, entry.bytes, path); assert.equal(hash(path), entry.sha256, path) }
  }
  return { entries: provenance.files.length, inventorySha256: provenance.inventorySha256, verified: true }
}
const parent = join(root, '.artifacts/web-combination')
mkdirSync(parent, { recursive: true })
const directory = mkdtempSync(join(parent, 'run-'))
const sandbox = join(directory, 'sandbox')
const home = join(sandbox, 'home')
const dshHome = join(sandbox, 'dsh-home')
const workspace = join(sandbox, 'project')
const bin = join(sandbox, 'bin')
for (const dir of [home, dshHome, workspace, bin]) mkdirSync(dir, { recursive: true })
symlinkSync(nodeBinary, join(bin, 'node'))
const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'workspace-write', LANG: 'en_US.UTF-8' }
const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const redact = value => String(value ?? '').replace(/([?&]token=)[^\s"'&<>]+/gu, '$1[REDACTED]')
let ordinal = 0
let stage = 'input-verification'
function dsh(args) {
  const command = ordinal++
  const result = spawnSync(nodeBinary, [cli, ...args], { cwd: workspace, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
  save(`command-${command}.json`, { stage, executable: nodeBinary, args: [cli, ...args], cwd: workspace,
    processExitCode: result.status, processSignal: result.signal, error: result.error?.message ?? 'unavailable',
    scope: 'CLI process; not declared task exit code' })
  writeFileSync(join(directory, `command-${command}.log`), redact(result.stdout) + '\n' + redact(result.stderr), { flag: 'wx' })
  assert(!result.error && result.status === 0, `first CLI failure at ${stage}; command-${command}.json/log`)
  return result.stdout
}
const profile = 'project-ops-three-bundle-web'
const profileDir = join(dshHome, 'profiles', profile)
function dataInventory() {
  const files = {}
  const scan = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`
      if (entry.isDirectory()) scan(join(dir, entry.name), relative)
      else if (entry.isFile()) files[relative] = { bytes: lstatSync(join(dir, entry.name)).size, sha256: hash(join(dir, entry.name)) }
    }
  }
  for (const name of ['missher-memory', 'missher-evolution']) scan(join(dshHome, name), name)
  return files
}
let passed = false
try {
  const before = checkRuntime()
  const hostEvidence = { installation: host.installation, cli, cliSha256: hash(cli), selectedNode: nodeBinary,
    helperSource, helperSourceSha256: hash(helperSource), selection, runtimeInventory: before }
  save('inputs.json', hostEvidence)
  stage = 'initialize-official-web'
  dsh(['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
  for (const pkg of selection) { stage = `install-${pkg.id}`; dsh(['plugin', '--profile', profile, 'add', pkg.archive]) }
  stage = 'default-composition'
  const composed = dsh(['--profile', profile, '--dump-config'])
  assert(composed.includes('@deepseek-ai/dsh-web-app'))
  for (const name of ['dsh-project-ops', 'dsh-missher-memory', 'dsh-missher-evolution']) {
    assert.equal(composed.split('\n').filter(line => line.trim() === `name: ${name}` || line.trim() === `name: '${name}'`).length, 1, name)
  }
  assert(!/name: ['"]?(?:dsh-media-missher|dsh-missher-brain|dsh-desktop-enhance)/u.test(composed))
  const app = join(workspace, 'packages/app')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ private: true, packageManager: 'npm@10', workspaces: ['packages/*'] }))
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: '@combination/app', scripts: { verify: 'node verify.cjs' } }))
  writeFileSync(join(app, 'input.js'), 'export const input = true\n')
  writeFileSync(join(app, 'verify.cjs'), 'console.log("declared combination verify");\n')
  for (const name of ['web-combination.mjs', 'probe-evidence.mjs']) cpSync(join(root, 'scripts/fixtures', name), join(profileDir, name))
  const boot = phase => {
    const patch = join(directory, `probe-${phase}.patch.json`)
    writeFileSync(patch, JSON.stringify([{ insert: [{ id: 'project-ops-web-combination-probe', name: pathToFileURL(join(profileDir, 'web-combination.mjs')).href, config: {
      phase, removed: phase !== 'all', workspace, report: join(directory, `${phase}.json`), hostEvidence,
      llmEntry: pathToFileURL(join(dirname(llm.manifestPath), llm.manifest.main)).href,
    } }] }], null, 2), { flag: 'wx' })
    dsh(['--profile', profile, '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', '0'])
    return JSON.parse(readFileSync(join(directory, `${phase}.json`), 'utf8'))
  }
  stage = 'all-bundles-web-boot'
  const all = boot('all')
  assert(all.passed)
  const beforeRemoval = dataInventory()
  save('data-before-removal.json', beforeRemoval)
  stage = 'remove-project-ops'
  dsh(['plugin', '--profile', profile, 'remove', 'dsh-project-ops'])
  const afterRemoval = dataInventory()
  save('data-after-cli-removal.json', afterRemoval)
  assert.deepEqual(afterRemoval, beforeRemoval)
  stage = 'remaining-bundles-web-boot'
  const remaining = boot('remaining')
  assert(remaining.passed)
  assert.equal(remaining.memoryReference, all.memoryReference)
  const afterRestart = dataInventory()
  save('data-after-restart.json', afterRestart)
  const after = checkRuntime()
  save('report.json', { passed: true, selection, all, remaining, pluginDataBytesPreservedByRemoval: true,
    memoryReferencePreservedAfterRestart: true, sharedRuntimeUnchanged: after,
    noModelRequests: all.modelRequests === 0 && remaining.modelRequests === 0,
    limits: ['early official web + 3 original bundles only', 'no Brain/Media/Enhance', 'no Electron or final Desktop/native acceptance', 'vilN8t cause remains unknown'] })
  passed = true
} catch (error) {
  save('failure.json', { passed: false, stage, error: redact(error.stack ?? error), noRetry: true })
  process.exitCode = 1
} finally {
  // Each CLI subprocess has exited before this point; only this run's owned sandbox is removed.
  if (passed) { rmSync(sandbox, { recursive: true }); save('cleanup.json', { removedOwnedSandbox: true, sharedRuntimeModified: false }) }
  else save('cleanup.json', { removedOwnedSandbox: false, reason: 'first failure scene retained for diagnosis; no retry' })
  console.log(JSON.stringify({ passed, stage, evidence: directory }))
}
