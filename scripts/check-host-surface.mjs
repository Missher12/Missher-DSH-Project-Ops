/**
 * Real-target surface check.
 *
 * For every real Host we can read — community rc.2, community alpha.2, official
 * npm alpha.5 — this records the distribution label, the SDK/Cordis versions and
 * manifest digests, then verifies that the *compiled artifacts* of that Host
 * still expose every service member Project Ops calls.
 *
 * Two honest limits are built in:
 *   - member presence is a static property of a compiled bundle, not a
 *     behavioural run; the report marks it as such.
 *   - the client primitives are usually served from the web shell's platform
 *     module table. Where the standalone package is not linked (the official
 *     alpha.5 install), the table itself is the evidence, and a missing
 *     standalone package is NOT reported as a missing service.
 *
 * Usage: node scripts/check-host-surface.mjs [--host-root <root>] [--source <label>]
 * Evidence: .artifacts/compat/host-surface.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCE, createHostResolver, describeHost, selectHostTargets } from './selected-host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Node-side services that must be installed as packages on the selected Host. */
const NODE_SERVICES = {
  '@deepseek-ai/dsh-fs-local': ['lstat', 'contains', 'readBytes', 'listDir', 'processPath', 'resolve', 'stat'],
  '@deepseek-ai/dsh-jobs-local': ['wait', 'read', 'get', 'kill'],
  '@deepseek-ai/dsh-tools': ['schemas', 'register', 'get', 'execute'],
  '@deepseek-ai/dsh-tool-bash': ['run_in_background', 'workdir'],
  '@deepseek-ai/dsh-tool-jobs': ['job_kill', 'job_list', 'job_output'],
}

/**
 * Client-side services. An install may deliver these by the standalone package
 * OR inline them in the web shell (the official alpha line inlines the
 * primitives); an absent standalone package is therefore NOT a missing service,
 * and the shell is checked instead — still as a static clue, with the
 * export-level proof marked unverified.
 */
const CLIENT_SERVICES = {
  '@deepseek-ai/dsh-client-ui-slots': ['inject', 'register'],
  '@deepseek-ai/dsh-client-locale': ['register'],
  '@deepseek-ai/dsh-api-workspace-files': ['list', 'readBytes'],
  '@deepseek-ai/dsh-client-ui-sidebar-right': ['openResource'],
}

/** Names the client bundle imports from the platform module table. */
const PRIMITIVE_EXPORTS = [
  'StateDot', 'useAnchoredPosition', 'useDismissOnOutsidePointer',
  'IconArchiveOutlineRegular', 'IconChecklistOutlineRegular', 'IconChevronDownOutlineRegular',
  'IconCloseOutlineRegular', 'IconDeliverDocRegular', 'IconInspectOutlineRegular', 'IconRefreshOutlineRegular',
]

/** Platform module-table rows our closure factory requires at runtime. */
const PLATFORM_ROWS = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']

/** Concatenated JavaScript of one installed package. */
function packageJavaScript(directory) {
  const lib = join(directory, 'lib')
  if (!existsSync(lib)) return { files: 0, text: '' }
  const files = []
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.js')) files.push(path)
    }
  }
  walk(lib)
  return { files: files.length, text: files.map(file => readFileSync(file, 'utf8')).join('\n') }
}

/** Concatenated web-shell assets, which carry the platform module table and may inline the primitives. */
function webShellAssets(hostRoot) {
  const assets = join(hostRoot, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
  if (!existsSync(assets)) return { available: false, text: '' }
  const files = readdirSync(assets).filter(name => name.endsWith('.js'))
  return { available: true, text: files.map(name => readFileSync(join(assets, name), 'utf8')).join('\n') }
}

/** Check one Host root and return its row. */
function inspectHost(hostRoot, label, sourceKind) {
  const row = { label, root: hostRoot, available: true,
    method: 'static clue scan of compiled artifacts', staticClueOnly: true, behavioural: false, packages: {}, missing: [] }
  const host = createHostResolver(hostRoot, { source: label, sourceKind })
  row.host = describeHost(host)
  const shell = webShellAssets(hostRoot)
  for (const [name, members] of Object.entries(NODE_SERVICES)) {
    // Keys are already scoped package names; adding the scope twice would make
    // every target look like it is missing the package.
    const directory = join(hostRoot, 'node_modules', name)
    if (!existsSync(directory)) {
      row.packages[name] = { installed: false, staticClueOnly: true }
      row.missing.push(`${name} is not installed in this Host`)
      continue
    }
    const { files, text } = packageJavaScript(directory)
    // Presence of the member name in the compiled bundle is a static clue, not a
    // callable-export proof and not a behavioural result; the report says so.
    const absent = members.filter(member => !text.includes(member))
    row.packages[name] = { installed: true, libFiles: files, staticClueOnly: true, absentNames: absent }
    for (const member of absent) row.missing.push(`${name} carries no static clue for ${member}`)
  }

  for (const [name, members] of Object.entries(CLIENT_SERVICES)) {
    const directory = join(hostRoot, 'node_modules', name)
    if (existsSync(directory)) {
      const { files, text } = packageJavaScript(directory)
      const absent = members.filter(member => !text.includes(member))
      row.packages[name] = { installed: true, source: 'standalone package', libFiles: files, staticClueOnly: true, absentNames: absent }
      for (const member of absent) row.missing.push(`${name} carries no static clue for ${member}`)
      continue
    }
    if (shell.available) {
      const absent = members.filter(member => !shell.text.includes(member))
      row.packages[name] = { installed: false, source: 'web shell bundle (inlined)', staticClueOnly: true,
        exportProofUnverified: true, absentNames: absent,
        note: 'no standalone package on this Host; the shell bundle is the only static evidence' }
      for (const member of absent) row.missing.push(`neither ${name} nor the web shell carries a static clue for ${member}`)
      continue
    }
    row.packages[name] = { installed: false, staticClueOnly: true, absentNames: members }
    row.missing.push(`${name} is neither installed nor inlined in a web shell on this Host`)
  }

  // Client primitives: standalone when linked, otherwise the web shell's platform table.
  const primitives = join(hostRoot, 'node_modules/@deepseek-ai/dsh-client-ui-primitives')
  if (existsSync(primitives)) {
    const { text } = packageJavaScript(primitives)
    const absent = PRIMITIVE_EXPORTS.filter(name => !text.includes(name))
    row.clientPrimitives = { source: 'standalone package', staticClueOnly: true, absent }
    for (const name of absent) row.missing.push(`client primitives do not export ${name}`)
  } else if (shell.available) {
    const absent = PRIMITIVE_EXPORTS.filter(name => !shell.text.includes(name))
    row.clientPrimitives = { source: 'web shell platform module table (inlined)', staticClueOnly: true,
      exportProofUnverified: true, absent,
      note: 'the standalone primitives package is not linked; the shell module table is the only static evidence' }
    for (const name of absent) row.missing.push(`the web shell does not carry ${name}`)
  } else {
    row.clientPrimitives = { source: 'unavailable', absent: PRIMITIVE_EXPORTS }
    row.missing.push('neither the primitives package nor a web shell build is present, so the client surface cannot be checked here')
  }
  if (shell.available) {
    row.platformRows = PLATFORM_ROWS.filter(platformRow => shell.text.includes(`"${platformRow}"`))
    for (const platformRow of PLATFORM_ROWS.filter(name => !shell.text.includes(`"${name}"`))) {
      row.missing.push(`the web shell platform table does not expose ${platformRow}`)
    }
  }
  return row
}

const argumentHost = process.argv.indexOf('--host-root')
const argumentSource = process.argv.indexOf('--source')
// One explicit root, or the shared selection rule (`PROJECT_OPS_HOST_TARGETS` /
// `PROJECT_OPS_HOST_ROOT`, defaulting to this checkout). Nothing is discovered
// by scanning, and a selected target that is absent fails the run.
const targets = argumentHost === -1
  ? selectHostTargets(process.env, root).map(target => ({ label: target.label, directory: target.directory, sourceKind: target.label === SOURCE.checkout ? SOURCE.checkout : SOURCE.caller }))
  : [{ label: argumentSource === -1 ? SOURCE.caller : process.argv[argumentSource + 1], directory: process.argv[argumentHost + 1], sourceKind: SOURCE.caller }]

const hosts = []
for (const [label, hostRoot, sourceKind] of targets.map(target => [target.label, target.directory, target.sourceKind])) {
  if (!existsSync(hostRoot)) {
    // An absent target is recorded as unavailable, never as a passed check.
    hosts.push({ label, root: hostRoot, available: false, note: 'selected target is not present on this machine' })
    continue
  }
  try {
    hosts.push(inspectHost(hostRoot, label, sourceKind))
  } catch (cause) {
    hosts.push({ label, root: hostRoot, available: true, error: cause instanceof Error ? cause.message : String(cause) })
  }
}

const checked = hosts.filter(host => host.available === true && host.error === undefined)
const failures = checked.flatMap(host => host.missing.map(issue => `${host.label}: ${issue}`))
// A run that inspected nothing, or that lost an explicit target to its own
// error, cannot pass: every selected target must be either inspected or reported
// as a failing target.
const targetFailures = hosts
  .filter(host => host.error !== undefined)
  .map(host => `${host.label}: inspection failed: ${host.error}`)
const unavailable = hosts.filter(host => host.available === false)
if (checked.length === 0) targetFailures.push('no Host target was actually inspected')
const report = {
  passed: failures.length === 0 && targetFailures.length === 0,
  method: 'static clue scan of the selected Host compiled artifacts; NOT an export proof, NOT a service proof, NOT a behavioural run',
  hosts,
  failures,
  targetFailures,
  checkedTargets: checked.map(host => host.label),
  unavailableTargets: unavailable.map(host => host.label),
}
const directory = join(root, '.artifacts/compat')
mkdirSync(directory, { recursive: true })
const reportPath = join(directory, 'host-surface.json')
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: report.passed, evidence: reportPath, checkedTargets: report.checkedTargets, unavailableTargets: report.unavailableTargets, failures: [...failures, ...targetFailures] }))
if (!report.passed) process.exitCode = 1
