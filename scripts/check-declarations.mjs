import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectArchive } from './package-inspection.mjs'
import { createHostResolver, describeHost } from './selected-host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const hostRoot = process.env.PROJECT_OPS_HOST_ROOT ? resolve(process.env.PROJECT_OPS_HOST_ROOT) : undefined
const host = createHostResolver(hostRoot ?? root)
// Resolve one peer before touching the archive: a selected Host that is not a
// real installation must fail as a Host problem, not as an archive problem.
host.resolvePackage('@deepseek-ai/cordis')
assert(process.env.PROJECT_OPS_ARCHIVE, 'set PROJECT_OPS_ARCHIVE to the fixed candidate tgz')
assert(process.env.PROJECT_OPS_ARCHIVE_SHA256, 'set PROJECT_OPS_ARCHIVE_SHA256')
const archive = resolve(process.env.PROJECT_OPS_ARCHIVE)
// Peers are published as ranges now, so the resolver records the version the
// selected Host really installed instead of asserting an equality against a range.
const inspected = inspectArchive(archive, process.env.PROJECT_OPS_ARCHIVE_SHA256)
const peerTypes = Object.fromEntries(Object.keys(inspected.manifest.peerDependencies).filter(name => name !== 'react').map(name => {
  const { manifestPath, manifest } = host.resolvePackage(name)
  const types = manifest.exports?.['.']?.types ?? manifest.types
  assert.equal(typeof types, 'string', `missing peer declaration entry: ${name}`)
  return [name, [resolve(dirname(manifestPath), types)]]
}))
const parent = join(root, '.artifacts/r7-declarations')
mkdirSync(parent, { recursive: true })
const directory = mkdtempSync(join(parent, 'consumer-'))
const packageRoot = join(directory, 'package')
for (const [name, text] of inspected.files) {
  const path = join(directory, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const tsconfig = {
  compilerOptions: { target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    skipLibCheck: false, noEmit: true, types: ['node'], paths: {
      '@missher/dsh-project-ops': [join(packageRoot, 'lib/index.d.ts')],
      '@missher/dsh-project-ops/cordis': [join(packageRoot, 'lib/cordis.d.ts')],
      '@missher/dsh-project-ops/client': [join(packageRoot, 'lib/client/index.d.ts')],
      ...peerTypes,
    } },
  files: ['consumer.mts'],
}
writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
writeFileSync(join(directory, 'consumer.mts'), `import * as Harness from '@missher/dsh-project-ops'
import * as Portable from '@missher/dsh-project-ops/cordis'
import * as Client from '@missher/dsh-project-ops/client'
import type { Context } from '@deepseek-ai/cordis'
declare const ctx: Context
Harness.apply(ctx, { snapshotOutputDirectories: ['dist'] })
Portable.apply(ctx)
Client.apply(ctx)
// @ts-expect-error public config rejects non-string output paths
Harness.apply(ctx, { snapshotOutputDirectories: [42] })
// @ts-expect-error public host contract requires its scope and native call services
new Portable.ProjectOpsService({ apiVersion: 1 })
`)
const compiler = require.resolve('typescript/bin/tsc')
execFileSync(process.execPath, [compiler, '-p', join(directory, 'tsconfig.json')], { stdio: 'inherit' })
const report = { passed: true, archive, archiveSha256: inspected.sha256, archiveBytes: inspected.bytes,
  source: 'declarations copied from the checked tgz, no source path alias', compiler,
  compilerVersion: JSON.parse(readFileSync(require.resolve('typescript/package.json'), 'utf8')).version,
  strict: true, skipLibCheck: false, node: process.version, hostRoot: hostRoot ?? null,
  host: describeHost(host), peerTypes,
  entryHashes: Object.fromEntries(['index', 'cordis', 'client/index'].map(name => [name, createHash('sha256').update(inspected.files.get(`package/lib/${name}.d.ts`)).digest('hex')])) }
const reportPath = join(directory, 'report.json')
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: true, evidence: reportPath, archiveSha256: inspected.sha256 }))
