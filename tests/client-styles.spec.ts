/**
 * Two cross-artifact guards for the panel stylesheet.
 *
 * The sheet ships as text inside the client bundle, so a class the component
 * binds but the sheet never defines would silently lose its style, and a
 * literal color would silently stop following the Host theme. Both are
 * assertions about the shipped artifact, not a copy of the stylesheet's
 * declarations; theme-token conformance is verified against the installed
 * official theme by `scripts/check-ui-contract.mjs` (`npm run check:ui`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { styleClassNames, styles } from '../src/client/styles.ts'

const sheetPath = fileURLToPath(new URL('../src/client/styles/project-ops.css', import.meta.url))
/** Declarations only: a comment is not a style. */
const sheet = readFileSync(sheetPath, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

/** Class selectors declared by the sheet. */
const declared = new Set([...sheet.matchAll(/\.(po-[a-z0-9-]+)/gu)].map(match => match[1]!))

test('the sheet and the components agree on every class', () => {
  expect(styleClassNames.filter(name => !declared.has(name))).toEqual([])
  const bound = new Set(Object.values(styles))
  expect([...declared].filter(name => !bound.has(name))).toEqual([])
})

test('the panel is placed by CSS anchor positioning, not the removed geometry hook', () => {
  // DSH 0.2.2 removed `useAnchoredPosition` from the primitives row; the
  // trigger/panel pair must use the replacement CSS API instead.
  expect(sheet).toMatch(/\.po-trigger\s*\{[^}]*anchor-name:\s*var\(--po-anchor-name\)/u)
  expect(sheet).toMatch(/\.po-menu\s*\{[^}]*position-anchor:\s*var\(--po-anchor-name\)/u)
  expect(sheet).toContain('position-try-fallbacks')
  const action = readFileSync(fileURLToPath(new URL('../src/client/ProjectOpsAction.tsx', import.meta.url)), 'utf8')
  expect(action).not.toContain('useAnchoredPosition')
})

test('the sheet declares no color of its own, so both themes follow the Host', () => {
  expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
  expect(sheet).not.toMatch(/\b(?:rgb|hsl|oklch|color)\(/u)
  expect(sheet).not.toMatch(/:\s*(?:white|black|gray|grey|red|green|amber)\b/u)
})
