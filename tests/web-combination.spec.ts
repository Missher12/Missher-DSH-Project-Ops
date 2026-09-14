import { expect, test } from 'vitest'
import { createWebProbeAgent } from '../scripts/fixtures/web-combination.mjs'

test('joins the configured Web default preset inside the unpublished Agent setup', async () => {
  const agentCtx = { marker: 'unpublished-scope' }
  const operations: string[] = []
  const handle = { agent: {} }
  const ctx = {
    agentPresets: {
      async resolve(id: unknown) { expect(id).toBeUndefined(); operations.push('resolve'); return { id: 'standard' } },
      async mount(scope: unknown, id: string) { expect(scope).toBe(agentCtx); expect(id).toBe('standard'); operations.push('mount') },
    },
    agents: { async create(options: { meta: unknown; setup: (scope: unknown) => Promise<void> }) {
      expect(options.meta).toEqual({ cwd: '/fixture', agentPreset: 'standard' })
      await options.setup(agentCtx)
      operations.push('published')
      return handle
    } },
  }
  expect(await createWebProbeAgent(ctx, 'fixture-session', '/fixture')).toBe(handle)
  expect(operations).toEqual(['resolve', 'mount', 'published'])
})
