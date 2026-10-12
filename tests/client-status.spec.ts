import { expect, test } from 'vitest'
import { documentStatus } from '../src/client/document-status.ts'
import { digest, encodePlan, type TaskRecord } from '../src/task-documents.ts'
const record: TaskRecord = { format: 1, taskId: '2026-10-12-test-0123456789abcdef', sessionId: 'session', originCallId: 'call', created: '2026-10-12', revision: 1, status: 'active', plan: { title: '中文任务', requirements: 'r', design: 'd', steps: ['s'], acceptance: ['a'], progress: 'p' } }
test('client distinguishes missing, current, historical and edited delivery without claiming acceptance', async () => {
  expect((await documentStatus(record.taskId, encodePlan(record), undefined)).delivery).toBe('missing')
  const reviewed = { ...record, delivery: { readyHash: digest('ready'), verification: '未验证', report: { implementation: 'i', checks: [{ criterion: 'a', status: 'unverified' as const, evidence: 'e' }], artifacts: [], git: 'g', release: 'r', installation: 'i', limitations: [], rollback: 'r' } } }
  expect(await documentStatus(record.taskId, encodePlan(reviewed), 'ready')).toEqual({ title: '中文任务', delivery: 'current' })
  expect((await documentStatus(record.taskId, encodePlan({ ...record, previousReadyHash: digest('ready') }), 'ready')).delivery).toBe('historical')
  expect((await documentStatus(record.taskId, encodePlan(reviewed), 'ready edited')).delivery).toBe('inspect')
  expect((await documentStatus(record.taskId, encodePlan(record) + 'manual edit', 'ready')).delivery).toBe('inspect')
  expect((await documentStatus('other', encodePlan(record), undefined)).delivery).toBe('inspect')
})
