import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
const statePath = resolve(import.meta.dirname, '../.artifacts/ui/current.json')
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^DSH_|^DEEPSEEK_/i.test(name)))
Object.assign(env, state.env, { DSH_TELEMETRY_DISABLED: '1' })
state.archive = resolve(process.argv[2])
execFileSync(process.execPath, [state.cli, 'plugin', '--profile', 'project-ops-ui', 'add', state.archive], { cwd: state.workspace, env, stdio: 'inherit', timeout: 180000 })
writeFileSync(statePath, JSON.stringify(state, null, 2))
