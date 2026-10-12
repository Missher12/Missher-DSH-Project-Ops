import { RECEIPT_SCHEMA } from './receipt-schema.ts'
import type { ExecutionReceipt } from './contracts.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ProjectOpsService } from './project-ops.ts'
import { DocumentStore } from './document-store.ts'

/** Explicit development-task lifecycle; no turn-end or shell-exit completion hook. */
export function registerDocumentTools(ctx: Context, service: ProjectOpsService<ToolRunContext>): void {
  const store = new DocumentStore(ctx)
  ctx.tools.register(defineTool({
    name: 'missher_project_ops_document_read',
    description: 'Project Ops: list current Session development tasks, or read one PLAN and its checked READY. Read before resuming or retrying. Ordinary questions need no task documents.',
    parameters: { taskId: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) {
      if (args.taskId === undefined) return { tasks: await store.list(exec) }
      const saved = await store.get(args.taskId, exec)
      return { ...store.summary(saved.record, saved.readyValid), plan: { ...saved.record.plan }, planMarkdown: saved.plan.content!, readyMarkdown: saved.readyValid ? saved.ready.content! : null }
    },
    presentCall: () => ({ card: 'generic', title: 'Project Ops · 查看方案 / 查看交付' }),
  }))
  ctx.tools.register(defineTool({
    name: 'missher_project_ops_document_write',
    description: 'Project Ops: explicitly begin/update a substantial authorized development task, or record delivery after acceptance review. Reuses Host Session, permissions and filesystem. Never pushes Git or calls another model. PLAN data: title, requirements, design, steps[], acceptance[], progress. Finish data: implementation, checks[{criterion,status:reported-pass|failed|unverified,evidence}], artifacts[], git, release, installation, limitations[], rollback. Evidence text is a Session report, not automatic proof. Failed/cancelled tasks require explicit active update before finish. Continue authorized work after writing PLAN.',
    parameters: {
      action: { type: 'string', enum: ['begin', 'update', 'finish'], required: true },
      slug: { type: 'string', description: 'Begin only: short lowercase ASCII task name.' },
      taskId: { type: 'string', description: 'Exact taskId returned by begin/read; required for update/finish.' },
      expectedRevision: { type: 'integer', description: 'Revision read from PLAN, required for update/finish.' },
      status: { type: 'string', enum: ['active', 'failed', 'cancelled'], description: 'Update only; cancellation/failure never means complete.' },
      data: { type: 'json', required: true, description: 'PLAN or delivery report object, as described above. No secrets or full private conversations.' },
      verification: { type: 'object', additionalProperties: false, properties: { changedFiles: { type: 'array', items: { type: 'string' }, required: true }, goal: { type: 'string', enum: ['verify', 'build', 'all'], required: true }, planDigest: { type: 'string', required: true }, receipts: { type: 'array', items: RECEIPT_SCHEMA, required: true } }, description: 'Finish only: existing verification_gate arguments; missing evidence remains unverified.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) {
      if (args.action === 'begin') return store.begin(args.slug ?? '', args.data, exec)
      if (!args.taskId || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision! < 1) throw new Error('taskId and expectedRevision from document_read are required')
      if (args.action === 'update') return store.update(args.taskId, args.expectedRevision!, args.data, args.status ?? 'active', exec)
      let verification = '未验证：未提供可核验的原生 Project Ops 回执；验收文字仅为会话报告。'
      if (args.verification !== undefined) {
        const gate = await service.gate(exec, { ...args.verification, goal: args.verification.goal as 'verify' | 'build' | 'all', receipts: args.verification.receipts as ExecutionReceipt[] })
        verification = `原生回执门：${gate.verdict}；planDigest=${gate.planDigest}；原因=${gate.reasonCodes.join(',') || '无'}。此结果核验文档写入前的源码快照，不代表发布、安装或其他平台通过。`
      }
      return store.finish(args.taskId, args.expectedRevision!, args.data, verification, exec)
    },
    presentCall: args => ({ card: 'generic', title: `Project Ops · ${args.action === 'finish' ? '记录交付' : '维护方案'}` }),
  }))
}
