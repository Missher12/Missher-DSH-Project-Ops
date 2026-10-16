import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lockedHostDependencies } from './host-dependencies.mjs'
import { archiveIdentity, installedPathFor, isPackageName } from './selected-host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'project-ops-clean-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, shell: command === 'npm.cmd' })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`)
  return result.stdout
}
/** Keep the verified name usable as an install argument before it is printed. */
const assertPackageName = name => {
  if (!isPackageName(name)) throw new Error(`verified package name is not usable: ${name}`)
}
const init = name => {
  const dir = join(temporary, name); mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  return dir
}
try {
  const pack = init('pack')
  const packed = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', pack], root))
  const archive = join(pack, packed[0].filename)
  // Identity comes from the archive being installed, so install, uninstall and
  // the survival check cannot disagree about the package name.
  const identity = archiveIdentity(run('tar', ['-xOf', archive, 'package/package.json'], pack),
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name)
  const packageName = identity.name
  console.log(`clean-install: archive identity ${packageName}@${identity.version ?? 'unknown'}`)
  const portable = init('portable')
  console.log('clean-install: installing Cordis 4.0.0-rc.9 and the archive in a fresh directory')
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', 'cordis@4.0.0-rc.9', archive], portable)
  if (existsSync(join(portable, 'node_modules', '@deepseek-ai'))) throw new Error('portable installation unexpectedly pulled Harness')
  cpSync(join(root, 'scripts/fixtures/cordis-host.mjs'), join(portable, 'probe.mjs'))
  // The portable fixture imports the scoped Cordis entry by the verified name,
  // so the driver passes it instead of the fixture hardcoding one.
  process.stdout.write(run(process.execPath, ['probe.mjs', join(temporary, 'portable-project')], portable,
    { ...process.env, PROJECT_OPS_PACKAGE_NAME: packageName }))
  run(npm, ['uninstall', '--ignore-scripts', '--no-audit', '--no-fund', packageName], portable)
  if (existsSync(installedPathFor(join(portable, 'node_modules'), packageName))) throw new Error(`portable package ${packageName} survived uninstall`)

  const harness = init('harness')
  const dependencies = lockedHostDependencies(root)
  console.log('clean-install: installing pinned Harness runtime without developer node_modules links')
  // Harness peers are explicitly pinned above; avoid npm expanding the cyclic host peer graph.
  run(npm, ['install', '--legacy-peer-deps', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', ...dependencies], harness)
  process.stdout.write(run(process.execPath, [join(root, 'scripts/smoke.mjs')], root, { ...process.env, PROJECT_OPS_HOST_ROOT: harness }))
  assertPackageName(packageName)
  console.log(`clean-runtime: PASS ${process.platform}/${process.arch}, Node ${process.version}; ${packageName} installs and removes in isolation`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
