/**
 * Short, host-injected onboarding contract for a freshly started Agent.
 * The full reference is shipped as docs/AGENT_USAGE.md; keep this prompt
 * procedural and bounded so it remains useful in every project.
 */
export const PROJECT_OPS_AGENT_GUIDANCE = [
  '# Project Ops task workflow',
  '',
  'Use Project Ops for substantial authorized development tasks and declared project checks/builds. Keep the host native execution tools, Jobs, approvals, sandboxing, and cancellation as the authority. Missing host capabilities must be reported, never bypassed.',
  '',
  'For substantial development, first use missher_project_ops_document_read to resume an existing task; otherwise begin with document_write and provide requirements, design, steps, acceptance and actual progress. Keep each task isolated. Ordinary questions and tiny edits do not require documents. Continue authorized implementation after PLAN is saved; do not introduce an approval gate.',
  'Update PLAN at meaningful progress/requirement changes and before interruption. Explicitly record failed or cancelled state when known. After acceptance review, finish with a factual delivery report, linking existing verification receipts when available. Never equate reply completion, shell exit, or a passed verification gate with full delivery, publication, installation or platform acceptance. Missing evidence stays unverified; do not automatically push Git or invoke another model.',
  '',
  '1. Call `missher_project_ops_task_list` when you need to understand the project task map.',
  '2. Call `missher_project_ops_task_plan` with explicit workspace-relative `changedFiles` and a `goal` (`verify`, `build`, or `all`). Resolve every discovery diagnostic before executing.',
  '3. Run planned tasks in the returned order, waiting for dependencies to succeed before starting their dependents. Pass the exact task `id` and `manifestDigest`; prefer `auto` for short or uncertain work and `background` for work that should continue. Never invent shell text or rerun a task because a wait expired. Tasks marked automatic=false require explicit selection.',
  '4. Track every running receipt. Use `missher_project_ops_task_collect` with the original task, digest, job, call, and start fields. Use native `job_output` or `job_kill` when a job survives plugin reload or no longer matters.',
  '5. Call `missher_project_ops_verification_gate` with the same changed files, goal, plan digest, and all relevant receipts. Source edits invalidate old evidence; unavailable snapshots are not verification. Treat `stale`, `failed`, `pending`, and discovery diagnostics as requiring more work; only `passed` satisfies this verification gate, not the whole development task.',
  '',
  'Do not pass arbitrary commands, bypass a denied shell call, treat output text as proof, or claim a check passed without a zero-exit receipt.',
].join('\n')

export const PROJECT_OPS_AGENT_GUIDANCE_SECTION = 'missher-project-ops:agent-guidance'
