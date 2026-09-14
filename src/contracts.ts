/** Task declaration families supported by Project Ops. */
export type TaskSource = 'package' | 'make' | 'just'

/** Stable purpose inferred only from a declared task name. */
export type TaskPurpose = 'test' | 'lint' | 'typecheck' | 'build' | 'format' | 'other'

/** Fixed execution data derived from one task manifest. */
export type TaskInvocation =
  | { kind: 'package'; manager: 'npm' | 'pnpm' | 'yarn' | 'bun'; script: string; cwd: string }
  | { kind: 'make'; target: string }
  | { kind: 'just'; recipe: string }

/** One task declaration returned to the model. */
export interface ProjectTask {
  id: string
  name: string
  description: string
  source: TaskSource
  manifest: string
  manifestDigest: string
  workspace: string
  packageName?: string
  purpose: TaskPurpose
  /** Transitive package impact, independent of same-purpose execution edges. */
  workspaceDependencies?: string[]
  dependsOn: string[]
  runnable: boolean
  /** False for recognized mutating or persistent tasks; explicit execution remains available. */
  automatic?: boolean
  invocation?: TaskInvocation
}

/** Host-neutral execution evidence. Version 2 is accepted only as legacy, unbound evidence. */
export interface ExecutionReceipt {
  receiptVersion: 2 | 3
  taskId: string
  source: TaskSource
  workspace: string
  purpose: TaskPurpose
  manifestDigest: string
  executionMode: 'foreground' | 'background'
  executorTool?: string
  nestedCallId: string
  jobId?: string
  startedAt: string
  durationMs: number
  outcome: 'running' | 'succeeded' | 'failed' | 'blocked' | 'aborted' | 'unavailable'
  exitCode?: number
  executionId?: string
  sourceDigest?: string
  freshness?: 'stable' | 'changed' | 'unavailable'
}

/** Bounded task-source diagnostic that never includes manifest contents. */
export interface DiscoveryDiagnostic {
  source: TaskSource | 'all'
  code: string
  message: string
}

/** Complete bounded task discovery result. */
export interface TaskDiscoveryResult {
  tasks: ProjectTask[]
  diagnostics: DiscoveryDiagnostic[]
}
