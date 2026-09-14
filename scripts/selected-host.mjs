import assert from 'node:assert/strict'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Resolve packages only through a selected project's explicit installation links, including pnpm links. */
export function createHostResolver(directory) {
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
  const installation = { root, manifestPath: realpathSync(manifestPath),
    nodeModules, realNodeModules: realpathSync(nodeModules), packages: {} }
  return {
    installation,
    resolvePackage(name, expectedVersion) {
      assert.match(name, /^(?:@[a-z0-9_-]+\/)?[a-z0-9_-]+$/u)
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
      assert.equal(pkg.version, expectedVersion, `selected host package version mismatch: ${name}`)
      installation.packages[name] = { anchor, manifestPath: path, version: pkg.version }
      return { manifestPath: path, manifest: pkg }
    },
  }
}
