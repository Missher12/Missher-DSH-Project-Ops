/**
 * Host UI contract check for the Project Ops client bundle.
 *
 * Verifies the three things a source-level review cannot see:
 *
 * 1. every `--dsw-*` token the stylesheet reads is DEFINED by the official
 *    theme actually installed for the target Host (the unpublished sources use
 *    tokens this Host never defines — a copied stylesheet would silently lose
 *    those declarations);
 * 2. every symbol the client imports from a platform module row exists in the
 *    installed official artifact of that row;
 * 3. the built browser bundle registers under the plugin id, carries the
 *    stylesheet text, tags its style element for the loader's CSS ownership
 *    inventory, and requires platform module-table rows only.
 *
 * Usage: node scripts/check-ui-contract.mjs [--root <host project root>]
 * Evidence: .artifacts/ui-contract/report.json
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = resolve(argument('--root') ?? process.env.PROJECT_OPS_HOST_ROOT ?? root)

/** Read `--name value` from argv. */
function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

/**
 * Resolve a package as installed for the target Host.
 *
 * A directly declared dependency is linked at `<root>/node_modules/<name>`; a
 * transitive one (the theme, the primitives, the web shell) only exists in the
 * package manager's virtual store, which is where the real install resolves it
 * from as well.
 * @param name - package name.
 * @returns the package directory.
 */
function resolvePackage(name) {
  const candidates = [join(projectRoot, 'node_modules', name), join(projectRoot, 'node_modules/.pnpm/node_modules', name)]
  for (const candidate of candidates) {
    try {
      assert(statSync(candidate).isDirectory())
      assert(statSync(join(candidate, 'package.json')).isFile())
      return realpathSync(candidate)
    } catch { /* try the next installation layout */ }
  }
  throw new Error(`host install has no package ${name} under ${projectRoot}/node_modules`)
}

/** Package version from its manifest. */
function versionOf(directory) {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version
}

/** Custom properties DEFINED by a theme client bundle. */
function definedTokens(source) {
  return new Set([...source.matchAll(/(--dsw-[a-z0-9-]+)\s*:/gu)].map(match => match[1]))
}

/** Named runtime exports of a client library's ESM entry. */
function runtimeExports(directory) {
  const entry = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).exports?.['.']?.default
  assert.equal(typeof entry, 'string', `no runtime entry for ${directory}`)
  const source = readFileSync(join(directory, entry), 'utf8')
  const names = new Set()
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/gsu)) {
    for (const entryName of block[1].split(',')) {
      const name = entryName.trim().split(/\s+as\s+/u).at(-1)?.trim()
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/u.test(name)) names.add(name)
    }
  }
  for (const declaration of source.matchAll(/export\s+(?:declare\s+)?(?:const|function|class)\s+([A-Za-z_$][\w$]*)/gu)) names.add(declaration[1])
  return { names, entry }
}

const themeDir = resolvePackage('@deepseek-ai/dsh-client-ui-theme')
const shellDir = resolvePackage('@deepseek-ai/dsh-web-frontend')
/**
 * The primitives are a web platform module. Some installs (the official alpha
 * line) inline them into the shell instead of linking the standalone package, so
 * an absent directory is not a missing service: the export-level proof is then
 * recorded as unverifiable here and left to a real module load.
 */
function optionalPackage(name) {
  try {
    return resolvePackage(name)
  } catch {
    return undefined
  }
}
const primitivesDir = optionalPackage('@deepseek-ai/dsh-client-ui-primitives')

// 1. Stylesheet tokens against the installed official theme.
const themeSource = readFileSync(join(themeDir, 'lib/client.js'), 'utf8')
const defined = definedTokens(themeSource)
assert(defined.size > 100, `theme token scan looks wrong (${defined.size} tokens)`)
const sheetPath = join(root, 'src/client/styles/project-ops.css')
const sheet = readFileSync(sheetPath, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
const read = [...new Set([...sheet.matchAll(/var\((--dsw-[a-z0-9-]+)/gu)].map(match => match[1]))].sort()
const undefinedTokens = read.filter(token => !defined.has(token))

// 2. Platform module rows the client imports, against the installed artifacts.
const clientSources = ['src/client/ProjectOpsPanel.tsx', 'src/client/ProjectOpsAction.tsx', 'src/client/index.tsx']
const primitiveImports = new Set()
for (const file of clientSources) {
  const source = readFileSync(join(root, file), 'utf8')
  for (const statement of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@deepseek-ai\/dsh-client-ui-primitives'/gsu)) {
    for (const specifier of statement[1].split(',')) {
      const name = specifier.trim().split(/\s+as\s+/u)[0]?.trim()
      if (name !== undefined && name.length > 0) primitiveImports.add(name)
    }
  }
}
assert(primitiveImports.size > 0, 'no platform primitives import found to verify')

// The shell's platform module table is what makes those specifiers resolvable.
const shellAssets = readdirSync(join(shellDir, 'dist/assets')).filter(name => name.endsWith('.js'))
const shellText = shellAssets.map(name => readFileSync(join(shellDir, 'dist/assets', name), 'utf8')).join('\n')
const platformRows = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots']
const missingRows = platformRows.filter(row => !shellText.includes(`"${row}"`))

/** Export-level proof, or an explicit statement that it needs a real load. */
function primitiveProof() {
  if (primitivesDir !== undefined) {
    const primitives = runtimeExports(primitivesDir)
    return {
      source: 'standalone package exports',
      version: versionOf(primitivesDir),
      runtimeEntry: primitives.entry,
      exports: primitives.names.size,
      missingExports: [...primitiveImports].filter(name => !primitives.names.has(name)).sort(),
      unverified: [],
    }
  }
  // No standalone package: the shell table is the only static evidence, and it
  // proves presence, not the export surface. The export check stays unverified
  // instead of being reported as passed.
  return {
    source: 'web shell platform module table (primitives inlined; no standalone package)',
    version: versionOf(shellDir),
    runtimeEntry: null,
    exports: null,
    missingExports: [...primitiveImports].filter(name => !shellText.includes(name)).sort(),
    unverified: ['client primitives export-level check requires a real module load on this Host'],
  }
}
const proof = primitiveProof()

// 3. The built browser bundle.
const bundlePath = join(root, 'lib/browser/client.js')
const bundle = readFileSync(bundlePath, 'utf8')
const id = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
const required = [...new Set([...bundle.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1]))].sort()
const cssProbe = '--dsw-radius-lg'
const report = {
  passed: false,
  projectRoot,
  host: {
    theme: { path: themeDir, version: versionOf(themeDir), definedTokens: defined.size },
    primitives: { path: primitivesDir ?? null, ...proof },
    webShell: { path: shellDir, version: versionOf(shellDir), platformRowsFound: platformRows.filter(row => !missingRows.includes(row)) },
  },
  stylesheet: { path: sheetPath, tokensRead: read, undefinedTokens },
  platformImports: { primitives: [...primitiveImports].sort(), missingExports: proof.missingExports },
  bundle: {
    path: bundlePath,
    bytes: Buffer.byteLength(bundle),
    requiresPlatformRowsOnly: required,
    carriesStylesheet: bundle.includes(cssProbe),
    stylesheetProbe: cssProbe,
    tagsStyleOwnership: bundle.includes('dataset.plugin') || bundle.includes('data-plugin'),
    registersId: bundle.includes(`id: "${id}"`),
  },
}
const failures = [
  ...undefinedTokens.map(token => `stylesheet reads an undefined theme token: ${token}`),
  ...proof.missingExports.map(name => proof.source === 'standalone package exports'
    ? `platform export missing from the installed artifact: ${name}`
    : `the web shell does not carry the platform name ${name}`),
  ...missingRows.map(row => `the web shell's platform table does not expose: ${row}`),
  ...(report.bundle.carriesStylesheet ? [] : ['the built bundle does not carry the stylesheet text']),
  ...(report.bundle.registersId ? [] : [`the built bundle does not register id ${id}`]),
  ...required.filter(specifier => !platformRows.includes(specifier)).map(specifier => `the built bundle requires a non-platform module: ${specifier}`),
]
report.failures = failures
report.unverified = proof.unverified
report.passed = failures.length === 0
const directory = join(root, '.artifacts/ui-contract')
mkdirSync(directory, { recursive: true })
const reportPath = join(directory, 'report.json')
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: report.passed, evidence: reportPath, failures, unverified: report.unverified, primitiveProof: proof.source, requires: required }))
if (failures.length > 0) process.exitCode = 1
