import { ProjectOpsService, type ProjectOpsHost } from './project-ops.ts'
export { ProjectOpsService } from './project-ops.ts'
export type { ProjectOpsHost, ProjectScope, RunArgs, CollectArgs, PlanArgs, GateArgs, ExecutionResult, HostCapabilities } from './project-ops.ts'
export type { ExecutionReceipt, ProjectTask, TaskInvocation } from './contracts.ts'
export { sourceSnapshot, SNAPSHOT_LIMITS, type SourceReader, type SnapshotOptions } from './source-snapshot.ts'
export { PROJECT_OPS_AGENT_GUIDANCE } from './agent-guidance.ts'

/** Structural Cordis API: importing this entry does not import any Harness runtime or types. */
export interface CordisContext {
  get(name: string): unknown
  provide(name: string, value: unknown): unknown
  effect(callback: () => (() => void)): unknown
}

export const name = 'project-ops-core'
export const inject = ['projectOpsHost']

/** The bridge exposes projectOps methods as its native Agent tools and owns their disposal. */
export function apply(ctx: CordisContext): void {
  const host = ctx.get('projectOpsHost') as ProjectOpsHost | undefined
  if (!host) throw new Error('Project Ops requires a projectOpsHost adapter')
  const service = new ProjectOpsService(host)
  ctx.effect(() => () => service.dispose())
  ctx.provide('projectOps', service)
  if (host.bind) ctx.effect(() => host.bind!(service))
}
