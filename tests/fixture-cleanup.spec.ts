/**
 * Fixture cleanup settlement.
 *
 * The profile fixture stores its result and settles once, because a `return`
 * inside the guarded `try` bypasses any check made afterwards — a successful run
 * that leaked cleanup failures used to still report success. These tests drive
 * the same two helpers the fixture calls (`runGuardedCleanup`, `settleRun`), so
 * the decision logic cannot drift from the code under test.
 */
import { expect, test } from 'vitest'
import { runGuardedCleanup, settleRun } from '../scripts/fixtures/probe-evidence.mjs'

interface Step { (): void | Promise<void> }

/** The fixture's shape: every step guarded, failures reported, none thrown. */
async function cleanup(steps: [string, Step][]) {
  const reported: string[] = []
  const errors = await runGuardedCleanup(steps, (label, error) => {
    reported.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  })
  return { errors, reported }
}

test('a successful run with a cleanup failure is not settled as success', async () => {
  const order: string[] = []
  const { errors } = await cleanup([
    ['remove native observer', () => { order.push('observer') }],
    ['dispose agent handle', () => { order.push('dispose'); throw new Error('handle already disposed') }],
  ])
  expect(order).toEqual(['observer', 'dispose'])
  expect(errors).toEqual(['dispose agent handle: handle already disposed'])

  const result = { passed: true, checks: ['ok'] }
  // The pre-fix path returned the success object from inside `try`, so cleanup
  // failures were silently dropped; settling must refuse it.
  expect(() => settleRun(result, undefined, errors)).toThrow(/cleanup failed after a successful run/)
  expect(() => settleRun(result, undefined, errors)).toThrow(/handle already disposed/)
})

test('a business failure always wins over a cleanup failure', async () => {
  const business = new Error('gate verdict was stale')
  const { errors } = await cleanup([
    ['remove native observer', () => {}],
    ['kill job bash-1', () => { throw new Error('job already finished') }],
  ])
  expect(errors).toHaveLength(1)
  let thrown: unknown
  try {
    settleRun(undefined, business, errors)
  } catch (error) {
    thrown = error
  }
  // The first business exception is preserved verbatim, not wrapped.
  expect(thrown).toBe(business)
})

test('a clean run settles to its result unchanged', async () => {
  const order: string[] = []
  const { errors } = await cleanup([
    ['remove native observer', () => { order.push('observer') }],
    ['dispose agent handle', () => { order.push('dispose') }],
  ])
  expect(errors).toEqual([])
  const result = { passed: true, phase: 'installed', checks: ['a', 'b'] }
  expect(settleRun(result, undefined, errors)).toBe(result)
  // Every step still runs in order, and the settle point has no hidden failure.
  expect(order).toEqual(['observer', 'dispose'])
  expect(settleRun(undefined, undefined, [])).toBeUndefined()
})

test('one failing step does not stop the remaining cleanup steps', async () => {
  const done: string[] = []
  const { errors } = await cleanup([
    ['remove native observer', () => { throw new Error('observer removal failed') }],
    ['kill job bash-1', () => { done.push('kill') }],
    ['wait job bash-1', () => { done.push('wait') }],
    ['dispose agent handle', () => { done.push('dispose') }],
  ])
  expect(done).toEqual(['kill', 'wait', 'dispose'])
  expect(errors).toEqual(['remove native observer: observer removal failed'])
})

test('asynchronous steps and rejections are guarded the same way', async () => {
  const { errors } = await cleanup([
    ['wait job bash-2', async () => { throw new Error('wait rejected') }],
    ['dispose agent handle', async () => {}],
  ])
  expect(errors).toEqual(['wait job bash-2: wait rejected'])
})
