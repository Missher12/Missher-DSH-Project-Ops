export const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    receiptVersion: { type: 'integer', enum: [2, 3], required: true },
    executionId: { type: 'string' },
    sourceDigest: { type: 'string' },
    freshness: { type: 'string', enum: ['stable', 'changed', 'unavailable'] },
    taskId: { type: 'string', required: true },
    source: { type: 'string', enum: ['package', 'make', 'just'], required: true },
    workspace: { type: 'string', required: true },
    purpose: { type: 'string', enum: ['test', 'lint', 'typecheck', 'build', 'format', 'other'], required: true },
    manifestDigest: { type: 'string', required: true },
    executionMode: { type: 'string', enum: ['foreground', 'background'], required: true },
    executorTool: { type: 'string' },
    nestedCallId: { type: 'string', required: true },
    jobId: { type: 'string' },
    startedAt: { type: 'string', required: true },
    durationMs: { type: 'integer', required: true },
    outcome: { type: 'string', enum: ['running', 'succeeded', 'failed', 'blocked', 'aborted', 'unavailable'], required: true },
    exitCode: { type: 'integer' },
  },
} as const

