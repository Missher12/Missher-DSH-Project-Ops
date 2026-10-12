//#region src/contracts.d.ts
/** Task declaration families supported by Project Ops. */
type TaskSource = 'package' | 'make' | 'just';
/** Stable purpose inferred only from a declared task name. */
type TaskPurpose = 'test' | 'lint' | 'typecheck' | 'build' | 'format' | 'other';
/** Fixed execution data derived from one task manifest. */
type TaskInvocation = {
  kind: 'package';
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  script: string;
  cwd: string;
} | {
  kind: 'make';
  target: string;
} | {
  kind: 'just';
  recipe: string;
};
/** One task declaration returned to the model. */
interface ProjectTask {
  id: string;
  name: string;
  description: string;
  source: TaskSource;
  manifest: string;
  manifestDigest: string;
  workspace: string;
  packageName?: string;
  purpose: TaskPurpose;
  /** Transitive package impact, independent of same-purpose execution edges. */
  workspaceDependencies?: string[];
  dependsOn: string[];
  runnable: boolean;
  /** False for recognized mutating or persistent tasks; explicit execution remains available. */
  automatic?: boolean;
  invocation?: TaskInvocation;
}
/** Host-neutral execution evidence. Version 2 is accepted only as legacy, unbound evidence. */
interface ExecutionReceipt {
  receiptVersion: 2 | 3;
  taskId: string;
  source: TaskSource;
  workspace: string;
  purpose: TaskPurpose;
  manifestDigest: string;
  executionMode: 'foreground' | 'background';
  executorTool?: string;
  nestedCallId: string;
  jobId?: string;
  startedAt: string;
  durationMs: number;
  outcome: 'running' | 'succeeded' | 'failed' | 'blocked' | 'aborted' | 'unavailable';
  exitCode?: number;
  executionId?: string;
  sourceDigest?: string;
  freshness?: 'stable' | 'changed' | 'unavailable';
}
/** Bounded task-source diagnostic that never includes manifest contents. */
interface DiscoveryDiagnostic {
  source: TaskSource | 'all';
  code: string;
  message: string;
}
/** Complete bounded task discovery result. */
interface TaskDiscoveryResult {
  tasks: ProjectTask[];
  diagnostics: DiscoveryDiagnostic[];
}
//#endregion
//#region src/task-planning.d.ts
type PlanGoal = 'verify' | 'build' | 'all';
//#endregion
//#region src/verification-gate.d.ts
type VerificationVerdict = 'passed' | 'pending' | 'failed' | 'stale';
interface VerificationGate {
  gateVersion: 1;
  verdict: VerificationVerdict;
  planDigest: string;
  requiredTaskIds: string[];
  missingTaskIds: string[];
  runningTaskIds: string[];
  failedTaskIds: string[];
  staleTaskIds: string[];
  reasonCodes: string[];
}
//#endregion
//#region src/capability-ranking.d.ts
type CapabilitySource = 'project-task' | 'tool';
/** One capability visible to the calling Agent. */
interface CapabilityCandidate {
  source: CapabilitySource;
  id: string;
  name: string;
  description: string;
}
/** Ranked capability plus the strongest deterministic match class. */
interface CapabilityMatch extends CapabilityCandidate {
  score: number;
  reason: string;
}
//#endregion
//#region src/task-discovery.d.ts
/** Read bounded task candidates and stable directory names below the project root. */
interface ManifestReader {
  readCandidate(name: string, signal?: AbortSignal): Promise<Uint8Array | undefined>;
  lockfiles(signal?: AbortSignal): Promise<readonly string[]>;
  listDirectories(path: string, signal?: AbortSignal): Promise<readonly string[]>;
}
//#endregion
//#region src/project-ops.d.ts
interface ProjectScope {
  /** Opaque, stable identity including both owning session and canonical project root. Never model supplied. */
  identity: string;
  reader: ManifestReader;
  /** Must hash the authorized input tree; return undefined when coverage cannot be established. */
  snapshot?: (signal: AbortSignal) => Promise<string | undefined>;
}
interface RunArgs {
  taskId: string;
  manifestDigest: string;
  mode?: 'foreground' | 'background' | 'auto';
  waitMs?: number;
}
interface CollectArgs {
  taskId: string;
  manifestDigest: string;
  jobId: string;
  nestedCallId: string;
  startedAt: string;
  waitMs?: number;
}
interface PlanArgs {
  changedFiles: string[];
  goal: PlanGoal;
}
interface GateArgs extends PlanArgs {
  planDigest: string;
  receipts: ExecutionReceipt[];
}
interface ExecutionResult {
  nestedContent: unknown[];
  receipt: ExecutionReceipt;
}
interface HostCapabilities {
  host: string;
  version: string;
  foreground: boolean;
  background: boolean;
  cancellation: boolean;
}
/** Trusted host bridge. All execution must retain native owner, policy, sandbox and cancellation context. */
interface ProjectOpsHost<Call = unknown> {
  apiVersion: 1;
  scope(call: Call): ProjectScope | Promise<ProjectScope>;
  signal(call: Call): AbortSignal;
  capabilities(call: Call): HostCapabilities;
  execute?: (task: ProjectTask, args: RunArgs, call: Call) => Promise<ExecutionResult>;
  collect?: (task: ProjectTask, args: CollectArgs, call: Call) => Promise<ExecutionResult>;
  tools?: (call: Call) => readonly CapabilityCandidate[];
  /** Optional owner-checked native cancellation. No new scheduler or process controller. */
  cancel?: (receipt: ExecutionReceipt, call: Call) => Promise<void>;
  /** Expose the service as native Agent tools/guidance. Must return their lifecycle disposer. */
  bind?: (service: ProjectOpsService<Call>) => (() => void);
}
/** Shared execution policy; records correlation and evidence, never schedules or owns native jobs. */
declare class ProjectOpsService<Call = unknown> {
  private readonly host;
  private readonly evidence;
  private active;
  private inflight;
  private sequence;
  constructor(host: ProjectOpsHost<Call>);
  dispose(): void;
  private scope;
  private snapshot;
  list(call: Call): Promise<TaskDiscoveryResult>;
  plan(call: Call, args: PlanArgs): Promise<{
    planDigest: string;
    sourceDigest: string | undefined;
    snapshotStatus: "unavailable" | "available";
    planVersion: 1;
    goal: PlanGoal;
    changedFiles: string[];
    changedFilesDigest: string;
    affectedWorkspaces: string[];
    tasks: ProjectTask[];
    diagnostics: DiscoveryDiagnostic[];
  }>;
  private task;
  private remember;
  run(call: Call, args: RunArgs): Promise<ExecutionResult>;
  collect(call: Call, args: CollectArgs): Promise<ExecutionResult>;
  gate(call: Call, args: GateArgs): Promise<VerificationGate>;
  search(call: Call, query: string, limit?: number): Promise<{
    matches: CapabilityMatch[];
  }>;
  doctor(call: Call): Promise<{
    executionAdapter: boolean;
    collectionAdapter: boolean;
    sourceSnapshot: boolean;
    runnerDependencies: string;
    guidance: string;
    host: string;
    version: string;
    foreground: boolean;
    background: boolean;
    cancellation: boolean;
    apiVersion: number;
  }>;
  cancel(call: Call, executionId: string): Promise<void>;
}
//#endregion
//#region src/source-snapshot.d.ts
interface SourceReader {
  entries(path: string, signal: AbortSignal): Promise<readonly {
    name: string;
    type: 'file' | 'directory' | 'unsupported';
  }[]>;
  read(path: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
}
declare const SNAPSHOT_LIMITS: {
  readonly entries: 8192;
  readonly depth: 32;
  readonly fileBytes: number;
  readonly totalBytes: number;
};
interface SnapshotOptions {
  outputDirectories?: readonly string[];
}
/** Bounded project content, including untracked files; excludes only VCS metadata and dependencies. */
declare function sourceSnapshot(reader: SourceReader, signal: AbortSignal, options?: SnapshotOptions): Promise<string>;
//#endregion
//#region src/agent-guidance.d.ts
/**
 * Short, host-injected onboarding contract for a freshly started Agent.
 * The full reference is shipped as docs/AGENT_USAGE.md; keep this prompt
 * procedural and bounded so it remains useful in every project.
 */
declare const PROJECT_OPS_AGENT_GUIDANCE: string;
//#endregion
//#region src/cordis.d.ts
/** Structural Cordis API: importing this entry does not import any Harness runtime or types. */
interface CordisContext {
  get(name: string): unknown;
  provide(name: string, value: unknown): unknown;
  effect(callback: () => (() => void)): unknown;
}
declare const name = "project-ops-core";
declare const inject: string[];
/** The bridge exposes projectOps methods as its native Agent tools and owns their disposal. */
declare function apply(ctx: CordisContext): void;
//#endregion
export { type CollectArgs, CordisContext, type ExecutionReceipt, type ExecutionResult, type GateArgs, type HostCapabilities, PROJECT_OPS_AGENT_GUIDANCE, type PlanArgs, type ProjectOpsHost, ProjectOpsService, type ProjectScope, type ProjectTask, type RunArgs, SNAPSHOT_LIMITS, type SnapshotOptions, type SourceReader, type TaskInvocation, apply, inject, name, sourceSnapshot };