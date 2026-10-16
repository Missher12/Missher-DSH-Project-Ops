import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * How a target came to be selected. A path, or a caller's own label, says
 * nothing about distribution provenance: the manifest name/version and its
 * digest verify which installed artifact this is, not who published it, so the
 * two are recorded as separate fields.
 */
export const SOURCE = {
  checkout: 'checkout',
  caller: 'caller supplied',
  unknown: 'unknown',
}

/**
 * Label one selected root.
 * @param directory - target root.
 * @param root - the repository root, when the caller knows it.
 * @returns `checkout` for the repository's own install, otherwise `caller supplied`; never a distribution claim.
 */
export function hostSourceOf(directory, root) {
  try {
    if (root !== undefined && realpathSync(root) === realpathSync(directory)) return SOURCE.checkout
    return SOURCE.caller
  } catch {
    return SOURCE.unknown
  }
}

/**
 * Read the selected Host set from the environment.
 *
 * `PROJECT_OPS_HOST_TARGETS` is an optional `label=path` list (comma or newline
 * separated; a bare path is accepted and labelled by the caller side only).
 * `PROJECT_OPS_HOST_ROOT` selects exactly one target. With neither, the
 * checkout's own installed SDK is used. Nothing is scanned or downloaded, and a
 * target that does not exist is an error rather than a fallback.
 * @param env - environment to read.
 * @param root - repository root used for the default target.
 * @returns one target per entry, in order.
 */
export function selectHostTargets(env, root) {
  const targets = []
  const list = env.PROJECT_OPS_HOST_TARGETS
  if (typeof list === 'string' && list.trim() !== '') {
    for (const row of list.split(/[\n,]/u).map(value => value.trim()).filter(value => value !== '')) {
      const separator = row.indexOf('=')
      if (separator === -1) {
        targets.push({ label: SOURCE.caller, directory: resolve(row) })
        continue
      }
      // `=path` and `label=` are rejected: resolving an empty path would point
      // the whole check at the current working directory and pass by accident.
      const label = row.slice(0, separator).trim()
      const path = row.slice(separator + 1).trim()
      assert(label !== '', `PROJECT_OPS_HOST_TARGETS entry has an empty label: ${row}`)
      assert(path !== '', `PROJECT_OPS_HOST_TARGETS entry has an empty path: ${row}`)
      targets.push({ label, directory: resolve(path) })
    }
  }
  const single = env.PROJECT_OPS_HOST_ROOT
  if (targets.length === 0 && typeof single === 'string' && single.trim() !== '') {
    targets.push({ label: SOURCE.caller, directory: resolve(single) })
  }
  if (targets.length === 0) targets.push({ label: SOURCE.checkout, directory: resolve(root) })
  for (const target of targets) {
    assert(existsSync(target.directory) && statSync(target.directory).isDirectory(),
      `selected Host target does not exist: ${target.label}; set PROJECT_OPS_HOST_ROOT=<host root> or PROJECT_OPS_HOST_TARGETS=<label>=<path>[,<label>=<path>]`)
  }
  return targets
}

/**
 * Whether a package name is a plain npm name, scoped or not.
 * @param name - candidate name.
 * @returns true when it is usable as an install argument and a node_modules path.
 */
export function isPackageName(name) {
  return typeof name === 'string' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)
}

/**
 * node_modules path of one installed package.
 *
 * A scoped name is two path segments, so the identity read from the archive
 * manifest — never a constant — decides where the install actually lands.
 * @param nodeModules - a `node_modules` directory.
 * @param name - verified package name.
 * @returns the package directory.
 */
export function installedPathFor(nodeModules, name) {
  assert(isPackageName(name), `not a package name: ${String(name)}`)
  return join(nodeModules, ...name.split('/'))
}

/**
 * Package identity taken from an archive manifest, cross-checked against the
 * source manifest so the check cannot drift from what was actually packed.
 * @param manifestText - `package/package.json` contents from the archive.
 * @param expectedName - the source package's own name.
 * @returns the verified name and version.
 */
export function archiveIdentity(manifestText, expectedName) {
  const manifest = JSON.parse(manifestText)
  const name = manifest.name
  assert(isPackageName(name), `archive manifest has no usable name: ${String(name)}`)
  assert.equal(name, expectedName, `archive manifest name ${name} differs from the source package ${expectedName}`)
  return { name, version: typeof manifest.version === 'string' ? manifest.version : null }
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
    // A caller label is only a label: it is recorded beside the verified fields,
    // never merged into them.
    source: { kind: options.sourceKind ?? SOURCE.unknown, label: options.source ?? options.sourceKind ?? SOURCE.unknown },
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
 * caller did not pin: root, caller label, SDK and Cordis identity, and the
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
