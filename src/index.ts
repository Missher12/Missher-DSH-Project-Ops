import { RECEIPT_SCHEMA } from './receipt-schema.ts'
import { registerDocumentTools } from './document-tools.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ProjectTask, ExecutionReceipt } from './contracts.ts'
import { receiptContent } from './task-execution.ts'
import type { PlanGoal } from './task-planning.ts'
import { ProjectOpsService } from './project-ops.ts'
import { createHarnessHost, type HarnessConfig } from './harness-host.ts'
export type { HarnessConfig } from './harness-host.ts'
import { PROJECT_OPS_AGENT_GUIDANCE, PROJECT_OPS_AGENT_GUIDANCE_SECTION } from './agent-guidance.ts'
type Service = ProjectOpsService<ToolRunContext>
/** Stable Cordis plugin name. */
export const name = 'missher-project-ops'

/** Harness services required by Project Ops. */
export const inject = ['fs', 'tools', 'jobs']

const TASK_LIST = 'missher_project_ops_task_list'
const TASK_PLAN = 'missher_project_ops_task_plan'
const TASK_RUN = 'missher_project_ops_task_run'
const TASK_COLLECT = 'missher_project_ops_task_collect'
const VERIFICATION_GATE = 'missher_project_ops_verification_gate'
const CAPABILITY_SEARCH = 'missher_project_ops_capability_search'
interface PublicTask {
  id: string
  name: string
  description: string
  source: ProjectTask['source']
  manifest: string
  manifestDigest: string
  workspace: string
  packageName?: string
  purpose: ProjectTask['purpose']
  dependsOn: string[]
  runnable: boolean
  automatic?: boolean
}

interface TaskRunValue {
  nestedContent: JsonValue[]
  receipt: ExecutionReceipt
}

function publicTask(task: ProjectTask): PublicTask {
  const {
    id,
    name: taskName,
    description,
    source,
    manifest,
    manifestDigest,
    workspace,
    packageName,
    purpose,
    dependsOn,
    runnable,
    automatic,
  } = task
  return {
    id,
    name: taskName,
    description,
    source,
    manifest,
    manifestDigest,
    workspace,
    ...packageName === undefined ? {} : { packageName },
    purpose,
    dependsOn,
    runnable,
    ...automatic === undefined ? {} : { automatic },
  }
}

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    source: { type: 'string', enum: ['package', 'make', 'just'], required: true },
    manifest: { type: 'string', required: true },
    manifestDigest: { type: 'string', required: true },
    workspace: { type: 'string', required: true },
    packageName: { type: 'string' },
    purpose: { type: 'string', enum: ['test', 'lint', 'typecheck', 'build', 'format', 'other'], required: true },
    dependsOn: { type: 'array', items: { type: 'string' }, required: true },
    runnable: { type: 'boolean', required: true },
    automatic: { type: 'boolean' },
  },
} as const

const DIAGNOSTIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', enum: ['package', 'make', 'just', 'all'], required: true },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const


const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gateVersion: { type: 'integer', const: 1, required: true },
    verdict: { type: 'string', enum: ['passed', 'pending', 'failed', 'stale'], required: true },
    planDigest: { type: 'string', required: true },
    requiredTaskIds: { type: 'array', items: { type: 'string' }, required: true },
    missingTaskIds: { type: 'array', items: { type: 'string' }, required: true },
    runningTaskIds: { type: 'array', items: { type: 'string' }, required: true },
    failedTaskIds: { type: 'array', items: { type: 'string' }, required: true },
    staleTaskIds: { type: 'array', items: { type: 'string' }, required: true },
    reasonCodes: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

function renderJson(value: JsonValue): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function taskListTool(service: Service): ToolDefinition {
  return defineTool({
    name: TASK_LIST,
    description: 'List bounded root and declared-workspace tasks in the current Agent Session project.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: { type: 'array', items: TASK_SCHEMA, required: true },
          diagnostics: { type: 'array', items: DIAGNOSTIC_SCHEMA, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      const discovered = await service.list(exec)
      return { tasks: discovered.tasks.map(publicTask), diagnostics: discovered.diagnostics }
    },
  })
}

function taskPlanTool(service: Service): ToolDefinition {
  return defineTool({
    name: TASK_PLAN,
    description: 'Plan safe affected verification/build tasks from explicit workspace-relative changed files.',
    parameters: {
      changedFiles: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'One through 256 workspace-relative changed file paths.',
      },
      goal: { type: 'string', enum: ['verify', 'build', 'all'], required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          planVersion: { type: 'integer', const: 1, required: true },
          goal: { type: 'string', enum: ['verify', 'build', 'all'], required: true },
          changedFilesDigest: { type: 'string', required: true },
          planDigest: { type: 'string', required: true },
          sourceDigest: { type: 'string' },
          snapshotStatus: { type: 'string', enum: ['available', 'unavailable'], required: true },
          affectedWorkspaces: { type: 'array', items: { type: 'string' }, required: true },
          tasks: { type: 'array', items: TASK_SCHEMA, required: true },
          diagnostics: { type: 'array', items: DIAGNOSTIC_SCHEMA, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const plan = await service.plan(exec, { changedFiles: args.changedFiles, goal: args.goal as PlanGoal })
      return {
        planVersion: plan.planVersion,
        goal: plan.goal,
        changedFilesDigest: plan.changedFilesDigest,
        planDigest: plan.planDigest,
        ...plan.sourceDigest === undefined ? {} : { sourceDigest: plan.sourceDigest },
        snapshotStatus: plan.snapshotStatus,
        affectedWorkspaces: plan.affectedWorkspaces,
        tasks: plan.tasks.map(publicTask),
        diagnostics: plan.diagnostics,
      }
    },
  })
}

function taskRunTool(service: Service): ToolDefinition {
  return defineTool({
    name: TASK_RUN,
    description: 'Run one fresh declared task in foreground, background, or background-first auto mode.',
    parameters: {
      taskId: { type: 'string', required: true, description: `Task id returned by ${TASK_LIST} or ${TASK_PLAN}.` },
      manifestDigest: { type: 'string', required: true, description: 'Matching lowercase SHA-256 manifest digest.' },
      mode: {
        type: 'string',
        enum: ['foreground', 'background', 'auto'],
        description: 'Defaults to foreground for backward compatibility.',
      },
      waitMs: { type: 'integer', description: 'Auto-mode wait from 1 through 10000 ms; defaults to 3000.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nestedContent: { type: 'array', items: { type: 'json' }, required: true },
          receipt: { ...RECEIPT_SCHEMA, required: true },
        },
      },
      render: (_args, value) => {
        const output = value as unknown as TaskRunValue
        return receiptContent(output.nestedContent as unknown as ContentBlock[], output.receipt)
      },
    },
    async execute(args, exec) {
      const result = await service.run(exec, args)
      return { receipt: result.receipt, nestedContent: result.nestedContent as JsonValue[] }
    },
  })
}

function taskCollectTool(service: Service): ToolDefinition {
  return defineTool({
    name: TASK_COLLECT,
    description: 'Poll or wait for one Project Ops background task and return a fresh owner-fenced receipt.',
    parameters: {
      taskId: { type: 'string', required: true },
      manifestDigest: { type: 'string', required: true },
      jobId: { type: 'string', required: true },
      nestedCallId: { type: 'string', required: true },
      startedAt: { type: 'string', required: true },
      waitMs: { type: 'integer', description: 'Optional wait from 1 through 10000 ms; omission polls immediately.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nestedContent: { type: 'array', items: { type: 'json' }, required: true },
          receipt: { ...RECEIPT_SCHEMA, required: true },
        },
      },
      render: (_args, value) => {
        const output = value as unknown as TaskRunValue
        return receiptContent(output.nestedContent as unknown as ContentBlock[], output.receipt)
      },
    },
    async execute(args, exec) {
      const result = await service.collect(exec, args)
      return { receipt: result.receipt, nestedContent: result.nestedContent as JsonValue[] }
    },
  })
}

function verificationGateTool(service: Service): ToolDefinition {
  return defineTool({
    name: VERIFICATION_GATE,
    description: 'Recompute an affected-task plan and decide whether supplied Project Ops receipts are fresh and complete.',
    parameters: {
      changedFiles: { type: 'array', items: { type: 'string' }, required: true },
      goal: { type: 'string', enum: ['verify', 'build', 'all'], required: true },
      planDigest: { type: 'string', required: true },
      receipts: { type: 'array', items: RECEIPT_SCHEMA, required: true },
    },
    output: { schema: GATE_SCHEMA, render: (_args, value) => renderJson(value) },
    async execute(args, exec) {
      return service.gate(exec, { changedFiles: args.changedFiles, goal: args.goal as PlanGoal,
        receipts: args.receipts as ExecutionReceipt[], planDigest: args.planDigest })
    },
  })
}

function capabilitySearchTool(service: Service): ToolDefinition {
  return defineTool({
    name: CAPABILITY_SEARCH,
    description: 'Search tools visible to this Agent and tasks declared by its current project workspaces.',
    parameters: {
      query: { type: 'string', required: true, description: 'Capability or task to find.' },
      limit: { type: 'integer', description: 'Maximum matches from 1 through 10; defaults to 5.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', enum: ['project-task', 'tool'], required: true },
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                score: { type: 'integer', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return service.search(exec, args.query, args.limit ?? 5)
    },
  })
}

/** Register the Project Ops model tools. */
export function apply(ctx: Context, config: HarnessConfig = {}): void {
  const service = new ProjectOpsService(createHarnessHost(ctx, config))
  ctx.effect(() => () => service.dispose())
  ctx.provide('projectOps', service)
  const systemPrompt = ctx.get('systemPrompt') as { section?: (section: {
    name: string
    order: number
    text: string
  }) => unknown } | undefined
  if (systemPrompt?.section !== undefined) {
    systemPrompt.section({
      name: PROJECT_OPS_AGENT_GUIDANCE_SECTION,
      order: 145,
      text: PROJECT_OPS_AGENT_GUIDANCE,
    })
  }
  registerDocumentTools(ctx, service)
  ctx.tools.register(taskListTool(service))
  ctx.tools.register(taskPlanTool(service))
  ctx.tools.register(taskRunTool(service))
  ctx.tools.register(taskCollectTool(service))
  ctx.tools.register(verificationGateTool(service))
  ctx.tools.register(capabilitySearchTool(service))
  ctx.tools.register(defineTool({
    name: 'missher_project_ops_doctor',
    description: 'Read-only Project Ops host capability and source snapshot readiness check. Does not install dependencies.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderJson(value) },
    execute: (_args, exec) => service.doctor(exec),
  }))
}
