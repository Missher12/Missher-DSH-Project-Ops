import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { createHostResolver } from '../scripts/selected-host.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const parent = join(root, '.artifacts/r7-host-resolution')
mkdirSync(parent, { recursive: true })
const directory = mkdtempSync(join(parent, 'negative-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

for (const script of ['check-declarations.mjs', 'smoke-profile.mjs']) {
  describe(script, () => {
    for (const state of ['missing', 'empty', 'empty-install', 'wrong-version']) {
      test(`rejects selected ${state} host below installed development ancestors`, () => {
        const host = join(directory, script, state)
        if (state !== 'missing') mkdirSync(host, { recursive: true })
        if (state === 'empty-install' || state === 'wrong-version') {
          writeFileSync(join(host, 'package.json'), '{"private":true}')
          mkdirSync(join(host, 'node_modules'))
        }
        if (state === 'wrong-version') {
          const name = script === 'smoke-profile.mjs' ? '@deepseek-ai/dsh' : '@deepseek-ai/cordis'
          const pkg = join(host, 'node_modules', name)
          mkdirSync(pkg, { recursive: true })
          writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version: '0.0.0' }))
        }
        const result = spawnSync(process.execPath, [join(root, 'scripts', script)], {
          cwd: root, encoding: 'utf8', timeout: 20000,
          env: { ...process.env, PROJECT_OPS_HOST_ROOT: host,
            PROJECT_OPS_ARCHIVE: join(root, 'dsh-project-ops-0.3.1.tgz'),
            PROJECT_OPS_ARCHIVE_SHA256: '9fed65a24615211a06867223fd6f5510f51e9f775522294ead3a1d7a8fbe98c9',
            PROJECT_OPS_NODE: join(directory, 'must-not-launch-node') },
        })
        expect(result.error).toBeUndefined()
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('selected host')
        if (state === 'wrong-version') expect(result.stderr).toContain('version mismatch')
      }, 25000)
    }
  })
}

test('accepts explicit pnpm package links and records logical and real manifests', () => {
  const host = join(directory, 'linked-host')
  const modules = join(host, 'node_modules')
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  writeFileSync(join(host, 'package.json'), '{"private":true}')
  const source = join(root, 'node_modules/@deepseek-ai/cordis')
  symlinkSync(realpathSync(source), join(modules, '@deepseek-ai/cordis'), 'junction')
  const selected = createHostResolver(host)
  const actual = selected.resolvePackage('@deepseek-ai/cordis', '4.0.2')
  expect(actual.manifestPath).toBe(realpathSync(join(source, 'package.json')))
  expect(selected.installation.packages['@deepseek-ai/cordis'].anchor)
    .toBe(join(modules, '@deepseek-ai/cordis/package.json'))
  // An installed sibling at the development ancestor cannot fill a missing host link.
  expect(() => selected.resolvePackage('@deepseek-ai/dsh', '0.1.5-rc.2')).toThrow('selected host')
})

test('rejects a manifest that is not a project object', () => {
  const host = join(directory, 'invalid-manifest')
  mkdirSync(join(host, 'node_modules'), { recursive: true })
  writeFileSync(join(host, 'package.json'), '[]')
  expect(() => createHostResolver(host)).toThrow('selected host')
})
