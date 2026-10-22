import { expect, test } from 'vitest'
import { documentStatus, headingTitle } from '../src/client/document-status.ts'
import { digest, encodePlan, type TaskRecord } from '../src/task-documents.ts'
const record: TaskRecord = { format: 1, taskId: '2026-10-12-test-0123456789abcdef', sessionId: 'session', originCallId: 'call', created: '2026-10-12', revision: 1, status: 'active', plan: { title: '中文任务', requirements: 'r', design: 'd', steps: ['s'], acceptance: ['a'], progress: 'p' } }
const report = {
  implementation: 'i',
  checks: [{ criterion: 'a', status: 'unverified' as const, evidence: 'e' }],
  artifacts: ['src/example.ts', 'dist/'],
  git: 'g',
  release: 'r',
  installation: 'i',
  limitations: [],
  rollback: 'r',
}

test('client distinguishes missing, current, historical and edited delivery without claiming acceptance', async () => {
  const missing = await documentStatus(record.taskId, encodePlan(record), undefined)
  expect(missing).toMatchObject({ title: '中文任务', delivery: 'missing', managed: true, artifacts: [] })

  const reviewed = { ...record, delivery: { readyHash: digest('ready'), verification: '未验证：未提供原生回执', report } }
  const current = await documentStatus(record.taskId, encodePlan(reviewed), 'ready')
  // The recorded acceptance sentence and artifacts travel with a linked delivery,
  // but nothing here marks the work as accepted.
  expect(current).toMatchObject({
    title: '中文任务', delivery: 'current', managed: true,
    artifacts: ['src/example.ts', 'dist/'],
    verification: '未验证：未提供原生回执',
  })

  expect((await documentStatus(record.taskId, encodePlan({ ...record, previousReadyHash: digest('ready') }), 'ready')).delivery).toBe('historical')
  // A READY that no longer matches the record is a review item, not a current acceptance.
  expect((await documentStatus(record.taskId, encodePlan(reviewed), 'ready edited'))).toMatchObject({ delivery: 'inspect' })
  // A manually edited PLAN is damaged: it must never parse as a valid managed record.
  expect((await documentStatus(record.taskId, encodePlan(record) + 'manual edit', 'ready'))).toMatchObject({ delivery: 'inspect', managed: false, damaged: true })
  expect((await documentStatus('other', encodePlan(record), undefined)).delivery).toBe('inspect')
})

test('plain and legacy documents stay visible as review items instead of being hidden', async () => {
  const plainPlan = '# 人工方案\n\n正文\n'
  // No metadata header at all: a plain PLAN is not an error, it is a record to check.
  expect(await documentStatus('some-dir', plainPlan, undefined)).toEqual({ delivery: 'missing', managed: false, artifacts: [] })
  expect(await documentStatus('some-dir', plainPlan, '# 人工交付\n')).toEqual({ delivery: 'inspect', managed: false, artifacts: [] })
  // An orphan READY with no PLAN is still a visible review item.
  expect(await documentStatus('some-dir', undefined, '# 孤立交付\n')).toEqual({ delivery: 'inspect', managed: false, artifacts: [] })
  // A metadata header that does not decode is damaged, never silently plain.
  expect(await documentStatus('some-dir', '[project-ops-v1]: <data:application/json;base64,bm90LWpzb24=>\n\n正文\n', undefined))
    .toMatchObject({ delivery: 'inspect', managed: false, damaged: true })
})

test('a long artifact or verification summary is cut and says the full record is in READY', async () => {
  const long = 'a'.repeat(400)
  const reviewed = {
    ...record,
    delivery: {
      readyHash: digest('ready'),
      verification: long,
      report: { ...report, artifacts: [long, 'ok.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'] },
    },
  }
  const status = await documentStatus(record.taskId, encodePlan(reviewed), 'ready')
  expect(status.artifacts).toHaveLength(5)
  expect(status.artifacts[0]).toHaveLength(300)
  expect(status.artifactsTruncated).toBe(true)
  expect(status.verification).toHaveLength(300)
  expect(status.verificationTruncated).toBe(true)
})

test('a heading supplies a plain record title and never invents one', () => {
  expect(headingTitle('# 旧交付标题\n\n正文')).toBe('旧交付标题')
  expect(headingTitle('## 二级标题')).toBe('二级标题')
  expect(headingTitle('没有标题的正文')).toBeUndefined()
  expect(headingTitle(undefined)).toBeUndefined()
})
