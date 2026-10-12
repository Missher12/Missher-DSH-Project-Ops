import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
const state = JSON.parse(readFileSync(resolve(import.meta.dirname, '../.artifacts/ui/current.json'), 'utf8'))
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^DSH_|^DEEPSEEK_/i.test(name)))
Object.assign(env, state.env, { DSH_TELEMETRY_DISABLED: '1' })
const child = spawn(process.execPath, [state.cli, '--profile', 'project-ops-ui', '--host', '127.0.0.1', '--port', '0', '--no-open'], { env, cwd: state.workspace, stdio: 'inherit' })
for (const event of ['SIGINT','SIGTERM']) process.on(event, () => child.kill(event))
child.on('exit', code => { process.exitCode = code ?? 1 })
