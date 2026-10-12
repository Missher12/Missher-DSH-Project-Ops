import { rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
rmSync(new URL('../lib', import.meta.url), { recursive: true, force: true })
execFileSync(process.execPath, [require.resolve('tsdown/run'), '--config', 'tsdown.config.ts'], { stdio: 'inherit' })
