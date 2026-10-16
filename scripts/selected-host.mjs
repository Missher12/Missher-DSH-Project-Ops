import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Known real Host roots, labelled by distribution. The first two are the Missher
 * community desktop build (the rc.2 fixture extracted from the retained local
 * deb and the installed alpha.2 app); the third is the official npm alpha line.
 * A caller may also select any other real project root explicitly.
 */
export const KNOWN_HOSTS = {
  'community-rc2': '/home/missher/Projects/DSH-Recovery-20261012/desktop-upgrade/shared-host-fixtures/rc2-root/opt/DeepSeek Harness/resources/app/dsh',
  'community-alpha2': '/opt/DeepSeek Harness/resources/app/dsh',
  'official-alpha5': '/home/missher/Projects/DSH-Recovery-20261012/usage-review/completion-20261017/official-alpha5',
}

/**
 * Label a selected Host root for reports. Only a path that resolves to one of
 * the known roots is labelled; anything else stays `custom` rather than being
 * described as a distribution it is not.
 * @param directory - Host root.
 * @returns the distribution label.
 */
export function hostSourceOf(directory) {
  let resolved
  try {
    resolved = realpathSync(directory)
  } catch {
    return 'custom'
  }
  for (const [label, known] of Object.entries(KNOWN_HOSTS)) {
    try {
      if (realpathSync(known) === resolved) return label
    } catch { /* a known root that is not installed here cannot label anything */ }
  }
  return 'custom'
}

/** Resolve packages only through a selected project's explicit installation links, including pnpm links. */
export function createHostResolver(directory, options = {}) {
  const root = resolve(directory)
  const manifestPath = join(root, 'package.json')
  const nodeModules = join(root, 'node_modules')
  let manifest
  try {
    assert(statSync(root).isDirectory())
    assert(statSync(manifestPath).isFile())
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert(manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest))
    assert(statSync(nodeModules).isDirectory())
  } catch (cause) {
    throw new Error(`selected host requires a real project manifest and node_modules: ${root}`, { cause })
  }
  const installation = {
    root,
    source: options.source ?? hostSourceOf(root),
    manifestPath: realpathSync(manifestPath),
    nodeModules,
    realNodeModules: realpathSync(nodeModules),
    packages: {},
  }
  return {
    installation,
    /**
     * Resolve one installed package of the selected Host.
     *
     * The version argument is an exact pin for a strict check and is optional on
     * purpose: the published peers are ranges now, so a caller that only needs
     * "whatever this Host actually installed" records the real version instead of
     * asserting an equality that a range can never satisfy.
     * @param name - package name.
     * @param expectedVersion - exact version to require, or omitted to accept the installed one.
     * @returns the resolved manifest, its version and its manifest digest.
     */
    resolvePackage(name, expectedVersion) {
      assert.match(name, /^(?:@[a-z0-9_-]+\/)?[a-z0-9_-]+$/u)
      if (expectedVersion !== undefined) {
        assert.match(expectedVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
          `resolvePackage takes an exact version or nothing, received ${expectedVersion}`)
      }
      const anchor = join(nodeModules, name, 'package.json')
      let path, pkg
      try {
        path = realpathSync(anchor)
        assert(statSync(path).isFile())
        pkg = JSON.parse(readFileSync(path, 'utf8'))
      } catch (cause) {
        throw new Error(`selected host has no installed package at ${anchor}`, { cause })
      }
      assert.equal(pkg.name, name, `selected host package name mismatch: ${anchor}`)
      if (expectedVersion !== undefined) {
        assert.equal(pkg.version, expectedVersion, `selected host package version mismatch: ${name}`)
      }
      const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
      installation.packages[name] = { anchor, manifestPath: path, version: pkg.version, sha256 }
      return { manifestPath: path, manifest: pkg, version: pkg.version, sha256 }
    },
  }
}

/**
 * Record what a selected Host actually is, without asserting a version the
 * caller did not pin: root, distribution label, SDK and Cordis identity, and the
 * manifest digests the verification reports cite.
 * @param host - a resolver from {@link createHostResolver}.
 * @returns the host identity record.
 */
export function describeHost(host) {
  const sdk = host.resolvePackage('@deepseek-ai/dsh')
  const cordis = host.resolvePackage('@deepseek-ai/cordis')
  return {
    root: host.installation.root,
    source: host.installation.source,
    manifestPath: host.installation.manifestPath,
    sdk: { version: sdk.version, sha256: sdk.sha256, manifestPath: sdk.manifestPath },
    cordis: { version: cordis.version, sha256: cordis.sha256, manifestPath: cordis.manifestPath },
    packages: Object.fromEntries(Object.entries(host.installation.packages)
      .map(([name, row]) => [name, { version: row.version, sha256: row.sha256 }])),
  }
}

/** CLI entry inside a resolved `@deepseek-ai/dsh` package. */
export function cliOf(dshManifestPath) {
  return join(dirname(dshManifestPath), 'lib/bin.js')
}
