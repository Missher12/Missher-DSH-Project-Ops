import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('Bundle package', () => {
  test('declares one isolated Bundle row', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      name: string
      dsh: { bundle: { patch: string } }
    }
    expect(manifest.name).toBe('@missher/dsh-project-ops')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')).toBe(
      '- insert:\n    - id: missher-project-ops\n      name: "@missher/dsh-project-ops"\n',
    )
  })

  test('marks Host-provided runtime peers optional for Profile installation', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      version: string
      peerDependencies: Record<string, string>
      peerDependenciesMeta: Record<string, { optional?: boolean }>
    }
    expect(manifest.version).toBe('0.4.0')
    // The published range must name the tested release lines, not a wildcard:
    // inclusion against the two real Hosts is proven by scripts/check-peer-ranges.mjs.
    const hostRange = manifest.peerDependencies['@deepseek-ai/dsh-jobs']!
    expect(hostRange).toContain('0.2.0-rc.2')
    expect(hostRange).toContain('0.2.1-alpha.2')
    expect(hostRange).not.toMatch(/^\*$|\blatest\b/u)
    expect(Object.keys(manifest.peerDependenciesMeta).sort()).toEqual(Object.keys(manifest.peerDependencies).sort())
    expect(Object.values(manifest.peerDependenciesMeta).every(meta => meta.optional === true)).toBe(true)
  })

  test('ships a concrete Agent onboarding contract', () => {
    const guide = readFileSync(resolve(root, 'docs/AGENT_USAGE.md'), 'utf8')
    expect(guide).toContain('missher_project_ops_task_list')
    expect(guide).toContain('missher_project_ops_task_plan')
    expect(guide).toContain('missher_project_ops_verification_gate')
    expect(guide).toContain('systemPrompt')
  })
})
