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
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lockedHostDependencies } from './host-dependencies.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostRoot = process.env.PROJECT_OPS_HOST_ROOT
const require = createRequire(hostRoot ? join(hostRoot, 'package.json') : import.meta.url)
const dshPackageRoot = dirname(require.resolve('@deepseek-ai/dsh/package.json'))
const dshCli = join(dshPackageRoot, 'lib', 'bin.js')
const expectedEntries = [
  'package/LICENSE',
  'package/README.i18n.yaml',
  'package/README.md',
  'package/README.zh.md',
  'package/cordis.patch.yml',
  'package/docs/AGENT_USAGE.md',
  'package/docs/CORDIS_INTEGRATION.md',
  'package/docs/OFFICIAL_COMPAT.md',
  ...readdirSync(join(pluginRoot, 'lib')).filter(name => /\.(?:js|d\.ts)$/u.test(name)).map(name => `package/lib/${name}`),
  'package/package.json',
].sort()
const expectedPatch = '- insert:\n    - id: missher-project-ops\n      name: dsh-project-ops\n'

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? pluginRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
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

async function exercisePackedPlugin(entry, workspace, home) {
  const cliRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
  const baseRequire = createRequire(cliRequire.resolve('@deepseek-ai/dsh-base/package.json'))
  const bashRequire = createRequire(baseRequire.resolve('@deepseek-ai/dsh-bash-sandbox'))
  const load = async (name, resolver = require) => import(pathToFileURL(resolver.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const ctx = new Context()
  const fibers = []
  const mount = async (module, config = {}) => fibers.push(await ctx.plugin(module.default ?? module, config))
  try {
    await mount(await load('@deepseek-ai/dsh-agent'))
    await mount(await load('@deepseek-ai/dsh-jobs-local'))
    await mount(await load('@deepseek-ai/dsh-system-prompt'))
    await mount(await load('@deepseek-ai/dsh-tools'))
    await mount(await load('@deepseek-ai/dsh-fs-local'), { cwd: workspace, diffBasisMaxBytes: 1048576 })
    await mount(await load('@deepseek-ai/dsh-subprocess-local', baseRequire))
    await mount(await load('@deepseek-ai/dsh-shell-env', baseRequire), { dshHome: home })
    await mount(await load(process.platform === 'win32' ? '@deepseek-ai/dsh-pwsh-local' : '@deepseek-ai/dsh-bash-local', process.platform === 'win32' ? cliRequire : bashRequire), {
      cwd: workspace, timeoutMs: 1000, maxTimeoutMs: 2000, graceMs: 100,
    })
    await mount(await load(process.platform === 'win32' ? '@deepseek-ai/dsh-tool-pwsh' : '@deepseek-ai/dsh-tool-bash', cliRequire))
    await mount(await load('@deepseek-ai/dsh-tool-jobs', cliRequire), { completionDelivery: 'quiet' })
    await mount(await import(pathToFileURL(entry).href), { snapshotOutputDirectories: ['packages/app/.project-ops-output'] })
    const promptService = ctx.get('systemPrompt')
    invariant(promptService !== undefined, 'native systemPrompt service is missing')
    const prompt = await promptService.assemble()
    invariant(prompt.sections.some(section => section.name === 'missher-project-ops:agent-guidance'), 'Project Ops Agent guidance was not registered in systemPrompt')
    const owner = { id: 'smoke-owner', ctx, session: { id: 'smoke-owner', header: { id: 'smoke-owner', cwd: workspace } }, inject() {} }
    const stranger = { ...owner, id: 'smoke-stranger', session: { id: 'smoke-stranger', header: { id: 'smoke-stranger', cwd: workspace } } }
    ctx.agents.register(owner)
    ctx.agents.register(stranger)
    let sequence = 0
    const call = async (name, args, agent = owner) => {
      const result = await ctx.tools.execute({ name, arguments: args, agent, callId: `smoke-${++sequence}`, signal: new AbortController().signal })
      invariant(!result.isError, `native ${name} failed: ${JSON.stringify(result.content)}`)
      return result.value
    }
    const planned = await call('missher_project_ops_task_plan', { changedFiles: ['packages/app/src/index.js'], goal: 'verify' })
    const task = planned.tasks.find(row => row.id === 'package@packages/app:verify')
    invariant(task !== undefined, 'installed plugin did not plan workspace verification')
    const ran = await call('missher_project_ops_task_run', { taskId: task.id, manifestDigest: task.manifestDigest, mode: 'auto', waitMs: 1000 })
    const collect = receipt => call('missher_project_ops_task_collect', {
      taskId: receipt.taskId, manifestDigest: receipt.manifestDigest, jobId: receipt.jobId,
      nestedCallId: receipt.nestedCallId, startedAt: receipt.startedAt, waitMs: 10000,
    })
    const terminal = ran.receipt.outcome === 'running' ? await collect(ran.receipt) : ran
    invariant(terminal.receipt.outcome === 'succeeded', 'native job did not succeed')
    invariant(existsSync(join(workspace, 'packages/app/.project-ops-output/project-ops-smoke.marker')), 'workspace script did not execute')
    const gate = await call('missher_project_ops_verification_gate', {
      changedFiles: ['packages/app/src/index.js'], goal: 'verify', planDigest: planned.planDigest,
      receipts: [ran.receipt, terminal.receipt],
    })
    invariant(gate.verdict === 'passed', 'native verification gate did not pass')
    const readiness = await call('missher_project_ops_doctor', {})
    invariant(readiness.foreground && readiness.sourceSnapshot, 'native readiness failed')
    writeFileSync(join(workspace, 'packages/app/src/index.js'), 'export const changed = true\n')
    const sourceStale = await call('missher_project_ops_verification_gate', { changedFiles: ['packages/app/src/index.js'], goal: 'verify', planDigest: planned.planDigest, receipts: [terminal.receipt] })
    invariant(sourceStale.verdict === 'stale', 'source edit accepted old evidence')
    writeFileSync(join(workspace, 'packages/app/src/index.js'), 'export {}\n')
    const marker = join(workspace, 'packages/app/.project-ops-output/project-ops-smoke.marker')
    rmSync(marker)
    rmSync(join(workspace, 'packages/app/.project-ops-output'), { recursive: true })
    const removeGuard = ctx.on('tools/pre-execute', async (exec, next) =>
      exec.name === (process.platform === 'win32' ? 'pwsh' : 'bash') ? { kind: 'deny', reason: 'smoke policy denial' } : next())
    const blocked = await call('missher_project_ops_task_run', { taskId: task.id, manifestDigest: task.manifestDigest })
    invariant(blocked.receipt.outcome !== 'succeeded' && !existsSync(marker), 'native policy denial did not prevent dispatch')
    removeGuard()
    const listed = await call('missher_project_ops_task_list', {})
    const long = listed.tasks.find(row => row.name === 'long')
    const started = await call('missher_project_ops_task_run', { taskId: long.id, manifestDigest: long.manifestDigest, mode: 'auto', waitMs: 1 })
    invariant(started.receipt.outcome === 'running', 'bounded wait must leave native job running')
    const denied = await ctx.tools.execute({ name: 'job_kill', arguments: { job_id: started.receipt.jobId }, agent: stranger, callId: 'stranger-kill', signal: new AbortController().signal })
    invariant(denied.isError, 'native Jobs owner fence permitted stranger cancellation')
    await call('job_kill', { job_id: started.receipt.jobId })
    invariant((await collect(started.receipt)).receipt.outcome === 'aborted', 'native cancellation did not settle aborted')
    const timed = await call('missher_project_ops_task_run', { taskId: long.id, manifestDigest: long.manifestDigest, mode: 'foreground' })
    invariant(timed.receipt.outcome !== 'succeeded', 'native timeout became success')
    writeFileSync(join(workspace, '.npmrc'), 'ignore-scripts=true\n')
    const stale = await call('missher_project_ops_verification_gate', {
      changedFiles: ['packages/app/src/index.js'], goal: 'verify', planDigest: planned.planDigest, receipts: [terminal.receipt],
    })
    invariant(stale.verdict === 'stale', 'changed configuration accepted old receipt')
    process.stdout.write(`native-runtime: PASS ${process.platform}/${process.arch}, Harness 0.1.5-rc.2, real Tools/Jobs/subprocess, policy denial, owner fence, wait, kill, timeout, stale config\n`)
  } finally {
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
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
  const entries = run('tar', ['-tzf', archive]).trim().split(/\r?\n/u).sort()
  invariant(JSON.stringify(entries) === JSON.stringify(expectedEntries), `archive entries differ from whitelist: ${entries.join(', ')}`)

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
  invariant(installed.dependencies?.['dsh-project-ops'] !== undefined, 'temporary Profile dependency was not installed')
  invariant(installed.dsh?.profile?.bundles?.includes('dsh-project-ops'), 'temporary Profile Bundle layer was not activated')

  const dumped = run(process.execPath, [...cli, '--profile', profile, '--dump-config'], { env: isolatedEnv })
  invariant(dumped.includes('missher-project-ops'), 'temporary Profile did not compose the plugin row')

  const workspace = join(temporaryRoot, 'workspace')
  const runtimeRoot = join(temporaryRoot, 'runtime')
  mkdirSync(workspace)
  mkdirSync(runtimeRoot)
  run('tar', ['-xzf', archive, '-C', runtimeRoot])
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({
    name: 'project-ops-smoke-root',
    private: true,
    packageManager: 'npm@10.0.0',
    workspaces: ['packages/*'],
  }))
  mkdirSync(join(workspace, 'packages', 'app', 'src'), { recursive: true })
  writeFileSync(join(workspace, 'packages', 'app', 'src', 'index.js'), 'export {}\n')
  writeFileSync(join(workspace, 'packages', 'app', 'package.json'), JSON.stringify({
    name: '@smoke/app',
    private: true,
    scripts: {
      long: 'node -e "setTimeout(() => {}, 60000)"',
      verify: 'node -e "require(\'node:fs\').mkdirSync(\'.project-ops-output\', { recursive: true }); require(\'node:fs\').writeFileSync(\'.project-ops-output/project-ops-smoke.marker\', \'ran\')"',
    },
  }))
  const profileDir = join(temporaryHome, 'profiles', profile)
  const installedEntry = join(profileDir, 'node_modules', 'dsh-project-ops', 'lib', 'index.js')
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
  await exercisePackedPlugin(installedEntry, workspace, temporaryHome)

  run(process.execPath, [...cli, 'plugin', '--profile', profile, 'remove', 'dsh-project-ops'], { env: isolatedEnv })
  const removed = readProfileManifest(temporaryHome, profile)
  invariant(removed.dependencies?.['dsh-project-ops'] === undefined, 'temporary Profile dependency survived removal')
  invariant(!removed.dsh?.profile?.bundles?.includes('dsh-project-ops'), 'temporary Profile Bundle layer survived removal')
  invariant(directorySentinel(liveHome) === liveBefore, 'live ~/.dsh top-level sentinel changed')

  process.stdout.write(`archive-sha256: ${createHash('sha256').update(readFileSync(archive)).digest('hex')}\n`)
  process.stdout.write('project-ops-smoke: PASS archive, isolated install, composition, workspace auto receipt, source/config freshness, verification gate, removal, live-home sentinel\n')
} finally {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  rmSync(temporaryRoot, { recursive: true, force: true })
}
