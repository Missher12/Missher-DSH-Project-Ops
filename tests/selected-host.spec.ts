import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { SOURCE, archiveIdentity, createHostResolver, hostSourceOf, installedPathFor, isPackageName, selectHostTargets } from '../scripts/selected-host.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const parent = join(root, '.artifacts/r7-host-resolution')
mkdirSync(parent, { recursive: true })
const directory = mkdtempSync(join(parent, 'negative-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

/** Run one verification script against a synthetic Host root. */
function runScript(script, host, extraEnv = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts', script)], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, PROJECT_OPS_HOST_ROOT: host,
      PROJECT_OPS_ARCHIVE: join(root, 'dsh-project-ops-0.3.1.tgz'),
      PROJECT_OPS_ARCHIVE_SHA256: '9fed65a24615211a06867223fd6f5510f51e9f775522294ead3a1d7a8fbe98c9',
      PROJECT_OPS_NODE: join(directory, 'must-not-launch-node'),
      ...extraEnv },
  })
}

for (const script of ['check-declarations.mjs', 'smoke-profile.mjs']) {
  describe(script, () => {
    // A Host root that is absent, empty, or an empty install must be rejected as
    // a Host problem, before any archive, Node or CLI work is attempted.
    for (const state of ['missing', 'empty', 'empty-install']) {
      test(`rejects selected ${state} host below installed development ancestors`, () => {
        const host = join(directory, script, state)
        if (state !== 'missing') mkdirSync(host, { recursive: true })
        if (state === 'empty-install') {
          writeFileSync(join(host, 'package.json'), '{"private":true}')
          mkdirSync(join(host, 'node_modules'))
        }
        const result = runScript(script, host)
        expect(result.error).toBeUndefined()
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('selected host')
      }, 25000)
    }
  })
}

describe('explicit Host pins and identity checks', () => {
  test('rejects a Host that does not match an explicit PROJECT_OPS_HOST_VERSION pin', () => {
    const host = join(directory, 'pinned-mismatch')
    const pkg = join(host, 'node_modules/@deepseek-ai/dsh')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(host, 'package.json'), '{"private":true}')
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.0.0' }))
    const result = runScript('smoke-profile.mjs', host, { PROJECT_OPS_HOST_VERSION: '0.2.1-alpha.2' })
    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('version mismatch')
  }, 25000)

  test('rejects a Host whose installed peer manifest is not the package it claims to be', () => {
    const host = join(directory, 'declarations-impostor')
    const pkg = join(host, 'node_modules/@deepseek-ai/cordis')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(host, 'package.json'), '{"private":true}')
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/not-cordis', version: '4.0.4' }))
    const result = runScript('check-declarations.mjs', host)
    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('name mismatch')
  }, 25000)
})

test('accepts explicit pnpm package links and records logical and real manifests', () => {
  const host = join(directory, 'linked-host')
  const modules = join(host, 'node_modules')
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  writeFileSync(join(host, 'package.json'), '{"private":true}')
  const source = join(root, 'node_modules/@deepseek-ai/cordis')
  symlinkSync(realpathSync(source), join(modules, '@deepseek-ai/cordis'), 'junction')
  const selected = createHostResolver(host)
  const actual = selected.resolvePackage('@deepseek-ai/cordis', '4.0.5-alpha.1')
  expect(actual.manifestPath).toBe(realpathSync(join(source, 'package.json')))
  expect(actual.version).toBe('4.0.5-alpha.1')
  expect(actual.sha256).toMatch(/^[a-f0-9]{64}$/u)
  expect(selected.installation.packages['@deepseek-ai/cordis'].anchor)
    .toBe(join(modules, '@deepseek-ai/cordis/package.json'))
  // Without an explicit pin the installed version is recorded, not compared.
  expect(selected.resolvePackage('@deepseek-ai/cordis').version).toBe('4.0.5-alpha.1')
  // An installed sibling at the development ancestor cannot fill a missing host link.
  expect(() => selected.resolvePackage('@deepseek-ai/dsh', '0.2.1-alpha.2')).toThrow('selected host')
})

test('rejects a manifest that is not a project object', () => {
  const host = join(directory, 'invalid-manifest')
  mkdirSync(join(host, 'node_modules'), { recursive: true })
  writeFileSync(join(host, 'package.json'), '[]')
  expect(() => createHostResolver(host)).toThrow('selected host')
})

describe('host selection and verified identity', () => {
  test('selects explicit targets from the environment and defaults to this checkout', () => {
    const first = join(directory, 'target-a')
    const second = join(directory, 'target-b')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    // A label is caller-supplied metadata, not a distribution claim.
    const listed = selectHostTargets({ PROJECT_OPS_HOST_TARGETS: `lab-a=${first}, ${second}` }, root)
    expect(listed).toEqual([
      { label: 'lab-a', directory: first },
      { label: SOURCE.caller, directory: second },
    ])
    const single = selectHostTargets({ PROJECT_OPS_HOST_ROOT: first }, root)
    expect(single).toEqual([{ label: SOURCE.caller, directory: first }])
    // With nothing selected the checkout's own install is the target.
    expect(selectHostTargets({}, root)).toEqual([{ label: SOURCE.checkout, directory: root }])
  })

  test('a selected target that does not exist fails instead of falling back', () => {
    const absent = join(directory, 'absent-host')
    expect(() => selectHostTargets({ PROJECT_OPS_HOST_ROOT: absent }, root)).toThrow(/does not exist/)
    expect(() => selectHostTargets({ PROJECT_OPS_HOST_TARGETS: `x=${absent}` }, root)).toThrow(/does not exist/)
  })

  test('an entry with an empty label or an empty path is rejected, not resolved to the cwd', () => {
    expect(() => selectHostTargets({ PROJECT_OPS_HOST_TARGETS: '=.' }, root)).toThrow(/empty label/)
    expect(() => selectHostTargets({ PROJECT_OPS_HOST_TARGETS: 'lab=' }, root)).toThrow(/empty path/)
    // The two halves are checked before any resolution, so nothing silently
    // points the check at the process working directory.
    expect(() => selectHostTargets({ PROJECT_OPS_HOST_TARGETS: 'lab= ,  =.' }, root)).toThrow(/empty (label|path)/)
  })

  test('a path never proves a distribution: labels are separate from verified fields', () => {
    expect(hostSourceOf(root, root)).toBe(SOURCE.checkout)
    // A real directory that is not the checkout is only a caller-supplied path.
    const other = join(directory, 'another-real-root')
    mkdirSync(other, { recursive: true })
    expect(hostSourceOf(other, root)).toBe(SOURCE.caller)
    // An unreadable path stays unknown rather than being guessed as caller-supplied.
    expect(hostSourceOf(join(directory, 'missing-for-source'), root)).toBe(SOURCE.unknown)
    const host = createHostResolver(join(root), { source: 'community-rc2' })
    expect(host.installation.source).toEqual({ kind: SOURCE.unknown, label: 'community-rc2' })
  })

  test('package identity taken from an archive decides where an install lands', () => {
    expect(installedPathFor('/tmp/node_modules', '@missher/dsh-project-ops'))
      .toBe(join('/tmp/node_modules', '@missher', 'dsh-project-ops'))
    expect(installedPathFor('/tmp/node_modules', 'plain-package'))
      .toBe(join('/tmp/node_modules', 'plain-package'))
    expect(() => installedPathFor('/tmp/node_modules', '../escape')).toThrow(/not a package name/)
    expect(isPackageName('@scope/name')).toBe(true)
    expect(isPackageName('name')).toBe(true)
    expect(isPackageName('@scope')).toBe(false)
    expect(isPackageName('')).toBe(false)

    const manifest = JSON.stringify({ name: '@missher/dsh-project-ops', version: '0.4.0' })
    expect(archiveIdentity(manifest, '@missher/dsh-project-ops')).toEqual({ name: '@missher/dsh-project-ops', version: '0.4.0' })
    // An archive that disagrees with the source package is a failure, not a rename.
    expect(() => archiveIdentity(manifest, '@missher/other')).toThrow(/differs from the source package/)
    expect(() => archiveIdentity(JSON.stringify({ version: '0.4.0' }), 'x')).toThrow(/no usable name/)
  })
})

describe('peer-range semver resolution', () => {
  test('a selected root without its own semver link fails even when an ancestor has one', () => {
    // Build a real, resolvable semver in an ancestor directory and put the
    // selected host beneath it: an unguarded require WOULD walk up and find it,
    // which is exactly the fallback the check must refuse.
    const ancestor = join(directory, 'ancestor-semver')
    const host = join(ancestor, 'host')
    mkdirSync(join(host, 'node_modules'), { recursive: true })
    writeFileSync(join(host, 'package.json'), '{"private":true}')
    const semver = join(ancestor, 'node_modules', 'semver')
    mkdirSync(semver, { recursive: true })
    writeFileSync(join(semver, 'package.json'), JSON.stringify({ name: 'semver', version: '7.0.0', main: 'index.js' }))
    writeFileSync(join(semver, 'index.js'), 'module.exports = { satisfies: () => true }\n')
    // Proof that the ancestor link is genuinely resolvable from the selected root.
    expect(createRequire(join(host, 'package.json')).resolve('semver')).toBe(join(semver, 'index.js'))

    const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-peer-ranges.mjs'), '--semver-root', host], {
      cwd: root, encoding: 'utf8', timeout: 20000, env: process.env,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('no installed semver link')
  }, 25000)

  test('the checkout itself is a valid target when it has the dependency, and fails closed when it does not', () => {
    // The default target is this checkout: it either has its own semver link
    // (then the run proceeds) or it does not (then the run fails and says how to
    // select a Host that has one). Nothing is borrowed from an ancestor.
    const linked = existsSync(join(root, 'node_modules', 'semver', 'package.json'))
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-peer-ranges.mjs')], {
      cwd: root, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, PROJECT_OPS_HOST_ROOT: root, PROJECT_OPS_SEMVER_ROOT: '' },
    })
    expect(result.error).toBeUndefined()
    if (linked) expect(result.status).toBe(0)
    else {
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('no installed semver link')
      // Fail-closed guidance: the message names how to select a real Host.
      expect(result.stderr).toContain('PROJECT_OPS_HOST_ROOT')
    }
  }, 25000)
})
