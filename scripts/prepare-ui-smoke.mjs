import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHostResolver, describeHost, cliOf } from './selected-host.mjs'
const root = resolve(import.meta.dirname, '..')
const base = join(root, '.artifacts/ui')
mkdirSync(base, { recursive: true })
const run = mkdtempSync(join(base, 'run-'))
// The Host is selected, not assumed: PROJECT_OPS_HOST_ROOT points at a real
// installation (for example the official alpha line, which ships a web frontend
// for UI acceptance), and PROJECT_OPS_HOST_VERSION optionally pins its SDK
// version. Without either, the checkout's own pinned development SDK is used.
const hostRoot = process.env.PROJECT_OPS_HOST_ROOT ? resolve(process.env.PROJECT_OPS_HOST_ROOT) : root
const host = createHostResolver(hostRoot)
const { manifestPath: dshManifestPath } = host.resolvePackage('@deepseek-ai/dsh', process.env.PROJECT_OPS_HOST_VERSION)
const cli = cliOf(dshManifestPath)
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^DSH_|^DEEPSEEK_/i.test(name)))
Object.assign(env, { HOME: join(run, 'home'), DSH_HOME: join(run, 'dsh-home'), DSH_TELEMETRY_DISABLED: '1' })
for (const dir of [env.HOME, env.DSH_HOME, join(run, 'workspace')]) mkdirSync(dir, { recursive: true })
const invoke = args => execFileSync(process.execPath, [cli, ...args], { cwd: join(run, 'workspace'), env, encoding: 'utf8', timeout: 180000 })
const archive = resolve(process.argv[2])
writeFileSync(join(run, 'initialize.log'), invoke(['--profile', 'project-ops-ui', '--from-default-profile', 'web', '--dump-config']))
writeFileSync(join(run, 'install.log'), invoke(['plugin', '--profile', 'project-ops-ui', 'add', archive]))
writeFileSync(join(run, 'help.log'), invoke(['--profile', 'project-ops-ui', '--help']))
writeFileSync(join(base, 'current.json'), JSON.stringify({ run, cli, archive, host: describeHost(host),
  workspace: join(run, 'workspace'), env: { HOME: env.HOME, DSH_HOME: env.DSH_HOME } }, null, 2))
console.log(JSON.stringify({ run, host: describeHost(host), help: readFileSync(join(run, 'help.log'), 'utf8') }))
