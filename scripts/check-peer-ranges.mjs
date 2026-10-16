/**
 * Peer-range evidence check.
 *
 * The published ranges must admit the Host combinations we actually verified
 * and must not become a blanket `*`. Semver has one rule that decides this: a
 * prerelease version only satisfies a range when at least one comparator with
 * the SAME [major, minor, patch] tuple also carries a prerelease. That is why a
 * single comparator cannot cover both `0.2.0-rc.2` and `0.2.1-alpha.2` — the
 * range needs an explicit branch per release line.
 *
 * The check runs against the real `semver` shipped inside a selected Host, so
 * the answer comes from an implementation rather than from this file's opinion.
 *
 * Usage: node scripts/check-peer-ranges.mjs [--semver-root <host root>]
 * Evidence: .artifacts/compat/peer-ranges.json
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectHostTargets } from './selected-host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * Hosts whose in-tree semver may be used as the reference implementation: the
 * explicit `--semver-root` / `PROJECT_OPS_SEMVER_ROOT` override, otherwise the
 * selected Host targets from the shared selection rule (which defaults to this
 * checkout). A selected target without semver is an error — the check never
 * switches to a different Host on its own.
 */
const argument = process.argv.indexOf('--semver-root')
const override = argument !== -1 ? process.argv[argument + 1] : process.env.PROJECT_OPS_SEMVER_ROOT
const TARGETS = typeof override === 'string' && override.trim() !== ''
  ? [{ label: 'caller supplied', directory: resolve(override) }]
  : selectHostTargets(process.env, root)

/**
 * Locate a real semver implementation among the selected targets.
 *
 * Only the target's own installed link counts: `createRequire` would otherwise
 * walk up the directory tree and borrow a `semver` from an unrelated ancestor,
 * which would silently "pass" for a target that has none. A target without the
 * package is reported as such; nothing falls back to another Host.
 */
function loadSemver() {
  const attempted = []
  for (const target of TARGETS) {
    if (!existsSync(join(target.directory, 'package.json'))) {
      attempted.push(`${target.label}: no package.json in the selected root`)
      continue
    }
    const linked = join(target.directory, 'node_modules', 'semver', 'package.json')
    if (!existsSync(linked)) {
      attempted.push(`${target.label}: no installed semver link at node_modules/semver`)
      continue
    }
    try {
      const require = createRequire(linked)
      const manifest = JSON.parse(readFileSync(linked, 'utf8'))
      return { semver: require('semver'), version: manifest.version,
        hostRoot: target.directory, anchor: linked, source: target.label }
    } catch (cause) {
      attempted.push(`${target.label}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  throw new Error(`no selected Host provides \`semver\` through its own installed link: ${attempted.join('; ')}; pass --semver-root <host root> or PROJECT_OPS_HOST_ROOT=<host root>`)
}

const { semver, version: semverVersion, hostRoot, anchor, source: semverSource } = loadSemver()

/**
 * Versions each peer range must admit, and must reject. The included set is
 * exactly the real Host anchors: community rc.2 (`0.2.0-rc.2`), community
 * alpha.2 (`0.2.1-alpha.2`) and official npm alpha.5 (`0.2.1-alpha.5`, Cordis
 * `4.0.5`).
 */
const HOST_ANCHORS = ['0.2.0-rc.2', '0.2.1-alpha.2', '0.2.1-alpha.5']
const EXPECTATIONS = {
  '@deepseek-ai/dsh-fs': { include: [...HOST_ANCHORS, '0.2.1', '0.2.5'], exclude: ['0.2.0-rc.1', '0.2.1-alpha.1', '0.3.0-alpha.1', '0.3.0', '0.1.9', '1.0.0'] },
  '@deepseek-ai/dsh-tools': { include: HOST_ANCHORS, exclude: ['0.3.0', '1.0.0'] },
  '@deepseek-ai/dsh-jobs': { include: HOST_ANCHORS, exclude: ['0.3.0', '1.0.0'] },
  '@deepseek-ai/dsh-agent': { include: HOST_ANCHORS, exclude: ['0.3.0', '1.0.0'] },
  '@deepseek-ai/dsh-llm': { include: HOST_ANCHORS, exclude: ['0.3.0', '1.0.0'] },
  '@deepseek-ai/dsh-util-values': { include: HOST_ANCHORS, exclude: ['0.3.0', '1.0.0'] },
  '@deepseek-ai/cordis': { include: ['4.0.4', '4.0.5-alpha.1', '4.0.5', '4.1.0'], exclude: ['4.0.3', '3.9.9', '5.0.0-alpha.1', '5.0.0'] },
  'react': { include: ['18.2.0', '18.3.1'], exclude: ['17.0.2', '19.0.0'] },
}

const failures = []
const rows = []
for (const [name, expectation] of Object.entries(EXPECTATIONS)) {
  const range = manifest.peerDependencies[name]
  assert.equal(typeof range, 'string', `missing peer range for ${name}`)
  const included = expectation.include.map(v => [v, semver.satisfies(v, range, { includePrerelease: false })])
  const excluded = expectation.exclude.map(v => [v, semver.satisfies(v, range, { includePrerelease: false })])
  for (const [v, ok] of included) if (!ok) failures.push(`${name} ${range} must include ${v}`)
  for (const [v, ok] of excluded) if (ok) failures.push(`${name} ${range} must exclude ${v}`)
  rows.push({ name, range, included, excluded })
}

// A blanket wildcard would pass every inclusion test and prove nothing.
const blanket = rows.filter(row => /^\*$|^x$|^>=0\.0\.0$/u.test(row.range.trim()))
for (const row of blanket) failures.push(`${row.name} uses a blanket range: ${row.range}`)

// The SDK anchor stays exactly pinned so a local build is reproducible; the
// surrounding toolchain (typescript, vitest, tsdown, type packages) keeps the
// caret ranges it ships with.
const sdkDevDependencies = Object.entries(manifest.devDependencies).filter(([name]) => name.startsWith('@deepseek-ai/'))
const floating = sdkDevDependencies
  .filter(([, range]) => !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(range))
  .map(([name, range]) => `${name}@${range}`)
for (const entry of floating) failures.push(`SDK development dependency is not exactly pinned: ${entry}`)

const report = {
  passed: failures.length === 0,
  semver: { version: semverVersion, hostRoot, anchor, source: semverSource },
  hostAnchors: HOST_ANCHORS,
  version: manifest.version,
  peers: rows,
  sdkDevDependencyPins: sdkDevDependencies.length,
  floatingDevDependencies: floating,
  failures,
}
const directory = join(root, '.artifacts/compat')
mkdirSync(directory, { recursive: true })
const reportPath = join(directory, 'peer-ranges.json')
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: report.passed, evidence: reportPath, semver: semverVersion, semverSource, hostRoot, failures }))
if (failures.length > 0) process.exitCode = 1
