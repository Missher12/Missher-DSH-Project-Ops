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
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const windowsNpm = command === 'npm.cmd'
  if (windowsNpm && !existsSync(npmCli)) throw new Error('selected Windows Node has no bundled npm CLI')
  const result = spawnSync(windowsNpm ? process.execPath : command, windowsNpm ? [npmCli, ...args] : args, {
    cwd, env, encoding: 'utf8', timeout: windowsNpm && args[0] === 'install' ? 600000 : 240000,
    maxBuffer: 8 * 1024 * 1024, shell: false,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.error?.code ?? result.status}): ${result.error?.message ?? ''}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`)
  }
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
let passed = false
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
  // Keep the same exact pins in the temporary manifest: passing every Host
  // package through npm.cmd exceeds Windows' command-line length limit.
  // Only this isolated test environment is written, never the product manifest.
  const pinned = Object.fromEntries(dependencies.map(spec => {
    const at = spec.lastIndexOf('@')
    return [spec.slice(0, at), spec.slice(at + 1)]
  }))
  writeFileSync(join(harness, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: pinned }))
  run(npm, ['install', '--save-exact', '--legacy-peer-deps', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund'], harness)
  process.stdout.write(run(process.execPath, [join(root, 'scripts/smoke.mjs')], root, { ...process.env, PROJECT_OPS_HOST_ROOT: harness }))
  assertPackageName(packageName)
  console.log(`clean-runtime: PASS ${process.platform}/${process.arch}, Node ${process.version}; ${packageName} installs and removes in isolation`)
  passed = true
} finally {
  try {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (error) {
    if (passed) throw error
    console.error(`clean-install cleanup: ${error.message}`)
  }
}
