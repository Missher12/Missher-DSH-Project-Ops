import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { assertArchiveEntries, assertPackageManifest, inspectArchive, REQUIRED_ENTRIES } from '../scripts/package-inspection.mjs'

const manifest = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
test('an archive whose digest does not match the bound one fails before any entry work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'project-ops-bind-'))
  try {
    mkdirSync(join(directory, 'package'), { recursive: true })
    writeFileSync(join(directory, 'package', 'package.json'), JSON.stringify({ name: '@missher/dsh-project-ops' }))
    const archive = join(directory, 'candidate.tgz')
    const packed = spawnSync('tar', ['-czf', archive, '-C', directory, 'package'], { encoding: 'utf8' })
    expect(packed.status).toBe(0)
    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
    // `smoke:package` computes this digest from the archive it just inspected and
    // hands it to the Profile child, so a mismatch must be fatal on its own and
    // must not be reached only after entry or factory validation.
    expect(() => inspectArchive(archive, '0'.repeat(64))).toThrow(/SHA-256 mismatch/u)
    expect(actual).not.toBe('0'.repeat(64))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

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
