import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lockedHostDependencies } from './host-dependencies.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'project-ops-clean-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, shell: command === 'npm.cmd' })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`)
  return result.stdout
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
  const portable = init('portable')
  console.log('clean-install: installing Cordis 4.0.0-rc.9 and the archive in a fresh directory')
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', 'cordis@4.0.0-rc.9', archive], portable)
  if (existsSync(join(portable, 'node_modules', '@deepseek-ai'))) throw new Error('portable installation unexpectedly pulled Harness')
  cpSync(join(root, 'scripts/fixtures/cordis-host.mjs'), join(portable, 'probe.mjs'))
  process.stdout.write(run(process.execPath, ['probe.mjs', join(temporary, 'portable-project')], portable))
  run(npm, ['uninstall', '--ignore-scripts', '--no-audit', '--no-fund', 'dsh-project-ops'], portable)
  if (existsSync(join(portable, 'node_modules', 'dsh-project-ops'))) throw new Error('portable package survived uninstall')

  const harness = init('harness')
  const dependencies = lockedHostDependencies(root)
  console.log('clean-install: installing pinned Harness runtime without developer node_modules links')
  // Harness peers are explicitly pinned above; avoid npm expanding the cyclic host peer graph.
  run(npm, ['install', '--legacy-peer-deps', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', ...dependencies], harness)
  process.stdout.write(run(process.execPath, [join(root, 'scripts/smoke.mjs')], root, { ...process.env, PROJECT_OPS_HOST_ROOT: harness }))
  console.log(`clean-runtime: PASS ${process.platform}/${process.arch}, Node ${process.version}; isolated package installs and removal`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
