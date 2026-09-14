import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { assertArchiveEntries, assertPackageManifest, REQUIRED_ENTRIES } from '../scripts/package-inspection.mjs'

const manifest = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
describe('release candidate declarations', () => {
  test('accepts the shipped entry and exact official peer declarations', () => {
    expect(() => assertPackageManifest(manifest())).not.toThrow()
    expect(() => assertArchiveEntries([...REQUIRED_ENTRIES, 'package/lib/shared-hash.js'])).not.toThrow()
  })
  test('rejects escaping Bundle paths, different entries, floating peers and extra executables', () => {
    const escaped = manifest(); escaped.dsh.bundle.patch = '../cordis.patch.yml'
    const entry = manifest(); entry.exports['.'].default = './src/index.ts'
    const peer = manifest(); peer.peerDependencies['@deepseek-ai/dsh-jobs'] = '*'
    const executable = manifest(); executable.bin = './lib/index.js'
    for (const candidate of [escaped, entry, peer, executable]) expect(() => assertPackageManifest(candidate)).toThrow()
  })
  test('rejects missing declarations, duplicate files and unlisted content', () => {
    expect(() => assertArchiveEntries(REQUIRED_ENTRIES.filter(name => !name.endsWith('cordis.d.ts')))).toThrow('missing')
    expect(() => assertArchiveEntries([...REQUIRED_ENTRIES, REQUIRED_ENTRIES[0]])).toThrow('duplicate')
    expect(() => assertArchiveEntries([...REQUIRED_ENTRIES, 'package/.env'])).toThrow('unexpected')
  })
})
