import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Exact Host package versions from this plugin's committed lockfile, including runtime peer services. */
export function lockedHostDependencies(root) {
  const packages = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').split('\nsnapshots:')[0]
  // Platform binaries stay optional dependencies of their wrapper; never promote other OS/CPU packages to direct deps.
  const dependencies = [...packages.matchAll(/^  '(@deepseek-ai\/[^'()]+@[0-9][^'()]*)':\n((?: {4}[^\n]*\n)*)/gm)]
    .filter(match => !/^    (?:os|cpu):/m.test(match[2]))
    .map(match => match[1])
  if (dependencies.length === 0) throw new Error('no locked Host dependencies found')
  return [...new Set(dependencies)].sort()
}
