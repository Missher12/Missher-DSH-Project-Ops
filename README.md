# dsh-project-ops

[← 桌面端与安装包](https://github.com/Missher12/Missher-DeepseekHarness-Desktop) · [全部插件](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/blob/main/plugins/README.zh.md) · [通用安装指南](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/blob/main/docs/cookbook/install-cordis-plugins.zh.md)

## 新手上手：项目任务执行

让 Agent 发现项目声明的任务、选择受改动影响的检查、运行后台任务并收集验证回执。

| 你需要知道的事 | 说明 |
| --- | --- |
| 插件包名 | `dsh-project-ops` |
| 当前源码版本 | `0.3.1` |
| 装好后在哪里使用 | Agent 工具；INSTALL.md 与 docs/AGENT_USAGE.md |
| 下载 / 源码 | [下载 0.3.1 安装包](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v0.3.1) |

### 安装、启用与第一次使用

1. 先从[桌面端主页](https://github.com/Missher12/Missher-DeepseekHarness-Desktop)下载适合电脑的应用，完成模型配置。这个仓库是可选插件，不是独立桌面应用。
2. 阅读[通用安装指南](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/blob/main/docs/cookbook/install-cordis-plugins.zh.md)及本页原有安装说明，核对宿主与插件版本。桌面版使用“插件 → 添加插件”；Web/CLI 使用自己的目标配置组，不混用两种安装位置。
3. 安装后按宿主提示启用并重新加载，进入上表列出的入口。更新已有插件前保留配置和数据，不同时启用旧包名与新包名。
4. 先让 Agent 列出项目任务并生成检查计划，再运行明确选定的任务；区分执行输出和可核验的回执。

### 使用前了解这些边界

它复用宿主的命令权限、沙箱和 Jobs，不会绕过审批。当前公开兼容基线是 Harness 0.1.5-rc.2 / Cordis 4.0.2。

如果页面或功能没出现，先检查当前应用版本、插件是否启用以及加载错误。反馈时附版本、复现步骤和已脱敏错误；不要上传 API Key、真实会话、账号 Cookie 或学习数据库。Git 中的代码更新不会自动替换电脑上已安装的插件。

### 继续阅读

下文保留本插件的详细行为、配置、开发和验证说明。跨平台是否实际通过，以对应版本的验证记录为准；桌面安装包能启动，不代表全部插件和外部服务都已验收。

---

English | [中文](README.zh.md)

`dsh-project-ops` is an independently installable Cordis project execution plugin with a compatible DeepSeek Harness Bundle entry. It gives an Agent a bounded map of declared project tasks, plans checks affected by changed files, hands long work to Harness's existing Jobs runtime, and evaluates output-free verification receipts.

It does not patch Harness source, replace a Desktop-managed Profile, accept arbitrary command text, or create another shell, job registry, workflow engine, reviewer, or sandbox. Harness remains the authority for tool scope, approvals, execution policy, cancellation, output retention, and owner isolation.

The official compatibility slice updates tool-call identifiers, the JSON value type import, and forwarding of nested `additionalContexts` / `concludesTurn`. Task discovery, planning, snapshots and receipt rules retain their existing behavior. Acceptance launches the installed plugin with an official `dsh` Profile; see [official compatibility evidence](docs/OFFICIAL_COMPAT.md).

## Quick install

Ask your Harness Agent: “Install Project Ops from https://github.com/Missher12/dsh-project-ops using its INSTALL.md guide, then verify it in my current Harness profile.”

With the target Harness CLI available, install the fixed release archive:

```sh
dsh plugin --profile web add https://github.com/Missher12/Missher-DSH-Project-Ops/releases/download/v0.3.1/dsh-project-ops-0.3.1.tgz
```

See [INSTALL.md](INSTALL.md) for Desktop CLI selection, checksum verification, first use and removal. DSH Market uses the exact name `dsh-project-ops`; its catalog entry is a separate publication step.

## Choose an entry

- Harness users: install the Bundle below; its existing six tools are preserved and a read-only doctor is added.
- Other Cordis hosts: load `dsh-project-ops/cordis` and provide `projectOpsHost`. This entry has no Harness runtime dependency. A host bridge exposes native Agent tools and retains execution policy and cancellation.
- Full setup, lifecycle, adapter interfaces and first-use checks: [Cordis integration](docs/CORDIS_INTEGRATION.md).

## Compatibility

The `0.3.1` Harness entry targets these exact runtime versions:

- DeepSeek Harness packages `0.1.5-rc.2`;
- `@deepseek-ai/cordis` `4.0.2` for Harness;
- Node.js `^22.19.0 || >=24.0.0`.

The Profile must provide `fs`, `tools`, `jobs`, and the standard `systemPrompt` service, plus an Agent-visible `bash` tool on POSIX or `pwsh` on Windows. Auto/background execution additionally requires that visible shell definition to expose `run_in_background` and that the Profile load the ordinary Harness job controller tools.

Treat another Harness release as unverified until typecheck, tests, build, and the isolated package lifecycle smoke pass against it. Runtime peers are optional in the npm manifest only to avoid false Profile-install warnings; the Harness Host still has to supply them.

Restart that Profile so its Loader recomposes the Bundle row. Remove only this Bundle with:

```sh
dsh plugin --profile web remove dsh-project-ops
```

To build the same Bundle from source:

```sh
pnpm install --frozen-lockfile
pnpm run build
npm pack
```

## Agent onboarding on a fresh computer

The installable reference is [docs/AGENT_USAGE.md](docs/AGENT_USAGE.md). Markdown inside an installed package is not automatically read as project instructions: Harness's `AGENTS.md` loader reads the current project's directory chain. During Bundle activation Project Ops therefore registers a short version of that workflow in the native `systemPrompt` service. A normal Profile should expose `fs`, `tools`, `jobs`, and `systemPrompt`; the standard Harness `ToolRuntime` already depends on `systemPrompt`, so a custom host must provide it before this Bundle can be used normally.

First call `missher_project_ops_doctor` to inspect current host capabilities and source snapshot readiness. Dependency installation remains unknown until separately verified. The Agent workflow is fixed: discover with `missher_project_ops_task_list`, plan with explicit changed files using `missher_project_ops_task_plan`, resolve diagnostics, run only the returned declarations with their exact digest, collect every background receipt, and finish with `missher_project_ops_verification_gate`. The Agent must keep Harness responsible for shell execution, approvals, sandboxing, Jobs ownership, and cancellation.

For project-specific guidance, add a small repository-root `AGENTS.md` that explains how to obtain changed files and which declared checks are required. Do not put arbitrary shell commands or approval bypasses in that file.

### `missher_project_ops_task_list`

Lists tasks from the Session cwd root and bounded declared package workspaces. Each row contains task identity, source manifest and SHA-256 digest, relative workspace, optional package name, inferred purpose, dependency task IDs, and runnable state. It never returns task command text.

### `missher_project_ops_task_plan`

Accepts one through 256 workspace-relative `changedFiles` and a goal:

- `verify`: test, lint, and typecheck tasks;
- `build`: build tasks;
- `all`: the four safe check purposes above; formatting and arbitrary `other` scripts are not auto-selected.

The planner finds directly affected workspaces, reverse local dependents, task dependencies, and matching root tasks. It returns stable topological order, affected workspace names, diagnostics, a changed-files digest, and a plan digest bound to the owning project and content snapshot. Recognized fix/update/watch tasks remain discoverable but are excluded from automatic plans (`automatic=false`). Name/flag inference is not a read-only security boundary. Wait for prerequisite tasks to succeed before dispatching dependents. Root-level changes conservatively affect every declared workspace.

### `missher_project_ops_task_run`

Accepts a fresh task ID and matching manifest digest plus an optional mode:

- `foreground` (default for backward compatibility): wait for the visible shell tool;
- `background`: start through the shell's existing `run_in_background` route and return its Harness job ID;
- `auto`: start through the same background route, wait 1–10000 ms (default 3000), and return a terminal receipt when the task finishes quickly or a running receipt when it remains live.

Harness cannot promote an already-started foreground process. Auto mode is therefore background-first with a bounded wait. It falls back to foreground only when background capability is absent before dispatch; a started job is never rerun.

Every task is rediscovered immediately before dispatch. Changed manifests, missing tasks, hidden executors, or non-runnable declarations fail closed. Package workspace tasks execute in their declared workspace through the Agent-visible shell.

### `missher_project_ops_task_collect`

Polls or waits for a job returned by Project Ops. Harness's JobRegistry enforces caller ownership. The collector also verifies an activation-local dispatch binding (task, digest, owning project, call ID and start time), then checks the job's internal shell label against the original dispatched task. Collection remains available after configuration edits; changed inputs make the receipt stale.

### `missher_project_ops_verification_gate`

Recomputes the affected-task plan from `changedFiles` and `goal`, then checks the supplied plan digest and version-3 receipts against current manifests, source snapshot and activation-local native evidence. Legacy version-2, altered, cross-session and reloaded receipts cannot pass. Verdicts are:

- `passed`: every required task has a fresh successful receipt;
- `pending`: required evidence is missing or still running;
- `failed`: a required task failed, was blocked, aborted, or unavailable;
- `stale`: the plan, required task set, task metadata, or manifest digest changed.

The gate returns task IDs and reason codes only. It does not repeat changed paths, commands, output, call metadata, environment values, or approval content.

### `missher_project_ops_capability_search`

Ranks only the calling Agent's visible Harness tool schemas plus tasks discovered in its current project. It does not search a hidden global registry or widen tool scope.

## Discovery boundary

Root candidates remain `package.json`, GNUmakefile/Makefile variants, and Justfile variants. Package workspaces come only from `package.json#workspaces` or the list under `pnpm-workspace.yaml#packages`.

Workspace patterns may contain literal path segments, `*`, and terminal `**`. Absolute paths, parent traversal, negation, backslashes in declarations, unsupported glob syntax, and symlink directories are rejected or skipped. Bounds are:

- 1 MiB per manifest;
- 64 workspace package directories;
- 128 workspace patterns;
- traversal depth 8 and 256 inspected directories;
- 256 tasks total;
- 256 changed paths, at most 512 characters each.

Nested packages inherit the root package manager when they do not declare one. A local package dependency adds same-purpose task edges when both packages declare that purpose. Root Make targets must be simple explicit targets with a following tab recipe; Just recipes must be public and parameterless.

## Receipt boundary

Version-3 receipts add an opaque execution ID, source digest and freshness status. They contain task/source/workspace/purpose identity, manifest digest, execution mode, optional executor and job ID, nested call ID, start time, duration, outcome, and optional exit code. They deliberately exclude commands, absolute paths, output, environment variables, sandbox policy text, and approval text.

Receipts are evidence, not authority. The verification gate always rediscovers manifests and recomputes the plan before accepting them.

## Verification boundary

`pnpm run smoke:package` packs the previously built output into a whitelist-checked archive, scans it for source paths and secret-shaped text, installs it under a temporary `DSH_HOME`, composes a temporary Profile, exercises an installed workspace task and verification receipt, removes the Bundle, and compares a hash-only top-level sentinel for the live `~/.dsh` directory.

The current maintenance run verifies Intel macOS with Node 25.6.0 and Harness 0.1.5-rc.2. CI is configured for Linux/macOS/Windows, but this version has not been run on Linux or Windows. No platform result from 0.2.0 is carried forward.

`pnpm run smoke:profile` installs the archive in an isolated official Profile, boots it through `dsh`, creates real Agent handles, calls native tools, and verifies removal in a second boot. The keyless fixture records the model-facing nested context projection; it makes no external model request.

The older generic Cordis validation recipe, `pnpm run smoke:clean`, additionally installs Cordis and the packed plugin in a new directory without Harness, runs a native fixture task through the adapter, checks disposal/reload and uninstalls. It then independently installs the pinned Harness dependencies and runs the isolated lifecycle without developer node_modules links.

## 0.3.1 stability changes and limits

- `manifestDigest` is now a declaration-context digest: all discovered manifests, workspace declarations, root lockfiles, `.npmrc`, `.yarnrc.yml`, `tsconfig.json`, `turbo.json`, `nx.json`, and the selected invocation. Re-list, re-plan and rerun tasks after upgrading; 0.2.0 digests and receipts are intentionally stale. Each configuration file is bounded to 1 MiB; unreadable, oversized or symlink files fail closed.
- Reverse package impact propagates independently of task purpose, including scriptless intermediate dependencies. Same-purpose edges still determine execution order. Unsupported workspace syntax, duplicate package names, truncation and cycles prevent a passing gate; resolve discovery diagnostics before dispatch. An empty check plan is pending, not passed.
- Unknown shell results never imply success; successful receipts require a structured zero exit code. For the same dispatch, a terminal receipt supersedes its running receipt. Different attempts at the same timestamp retain conservative failure precedence.
- Evidence is private to one plugin activation, bounded to 4096 entries including in-flight dispatches; settled evidence is evicted under pressure rather than consuming a lifetime start quota. Collect jobs before reloading. After reload, use native `job_output` / `job_kill` for old jobs; Project Ops cannot mint new receipts without its original binding.
- `waitMs` is a wait budget, not a job lifetime. Background jobs retain the host's no-timeout behavior and must be stopped with native `job_kill`. Foreground timeout and cancellation remain host-owned. A cancelled outer wait can leave an already-started job alive; recover its ID through native `job_list` and collect or cancel it, never blindly rerun.
- Source freshness now covers the bounded project content tree, including untracked files and nested configuration, excluding `.git`, `node_modules` and operator-declared output directories. Source changes invalidate old receipts; missing snapshots cannot pass. The scan is not atomic and does not prove external inputs, installed dependencies or environment stability. Output directory configuration and limits are documented in the integration guide; this gate is not release authorization.

The package smoke loads the installed entry with the pinned host peers and real Cordis Tools, local filesystem, shell, subprocess and Jobs services. It checks policy denial, ownership, cancellation, bounded waiting, foreground timeout, config invalidation and uninstall. The synthetic Agent avoids an LLM/network call. This does not test a Desktop UI, interactive approval UI or OS sandbox enforcement.
