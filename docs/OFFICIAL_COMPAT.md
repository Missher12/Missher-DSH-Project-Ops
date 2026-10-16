# Official Harness compatibility

English | [中文](#中文)

> **历史记录（0.3.1 时代）**：本文记录的是 0.3.1 面向 Harness 0.1.5-rc.2 与 `@deepseek-ai/cordis` 4.0.2 的验收，**不代表当前版本**。当前版本的宿主来源、最低接口、缺能力降级与未测范围见 [兼容性矩阵](COMPATIBILITY.md)。

Project Ops 0.3.1 targets published Harness 0.1.5-rc.2 packages and `@deepseek-ai/cordis` 4.0.2. The source comparison reference is `fb2c4b9e698e30edb738bca4cf0618587db7d203`. Validation uses exact registry packages recorded by `pnpm-lock.yaml`; it does not substitute same-version packages built from a modified Desktop branch or claim that the published binaries were rebuilt from this Git reference.

The Harness adapter uses `ToolCallId` from `dsh-llm` and `JsonValue` from `dsh-util-values`. Every nested native tool result forwards its `additionalContexts` in order through `exec.deferContext()`. Only a successful result carrying `concludesTurn` invokes `exec.concludeTurn()`. Failure context is retained without turning a failed nested call into a terminal success. The task engine, native Jobs ownership, approvals, sandbox and cancellation remain unchanged.

Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, then `pnpm run smoke:profile`. The last command installs the archive into an isolated Harness home and starts a named Profile through the official `dsh` CLI. It derives the Profile from the official headless template, disables only its inference frontend, and loads a test-only consumer after the launcher's readiness signal. The consumer creates real Agent handles through the official factory and invokes the actual tools. It does not construct a substitute Cordis container or contact a model provider.

The Profile check covers tool/prompt activation, a declared workspace task, a passing gate, nested context and conclusion metadata, a native policy rejection, stale success after a newer failure, bounded background waiting, owner isolation, native cancellation with observed producer exit, foreground timeout, source invalidation, and absence of tools/service/prompt after CLI removal and a second Profile boot. The model-facing metadata projection is compared with `tests/fixtures/official-profile.expected.json`; this is a keyless tool-result fixture, not a full model-session replay.

Evidence is retained under `.artifacts/official-compat/profile-*/`: installed/removed reports, command logs, the tested archive, runtime entry paths/hashes, and a final `report.json`. The legacy `smoke:package` and `smoke:clean` are component/portable-host recipes; the new Profile check is the official application activation evidence. The artifact checksum and final local commit are recorded in `HANDOVER.md` and `SHA256SUMS`.

The tested platform for this slice is Intel macOS with Node 25.6.0. Windows, Linux, other runtime versions, desktop UI, interactive approval UI and live-model behavior are not validated by this result. Existing snapshot limits and activation-local receipt retention still apply. The unchanged receipt core classifies signal-terminated timeouts as `aborted`; validation checks the native `timedOut` flag separately and requires a non-passing receipt. Other Cordis/Agent adapters are outside this slice.

## 中文

Project Ops 0.3.1 面向公开精确版本 Harness 0.1.5-rc.2 与 `@deepseek-ai/cordis` 4.0.2；源码对照为 `fb2c4b9e698e30edb738bca4cf0618587db7d203`。验证依赖由锁文件记录来源与完整性，不使用 Desktop 分支修改过的同版本包，也不把公开二进制描述为从该 SHA 重新构建的产物。

适配器改用官方 `ToolCallId` 与 `dsh-util-values` 的 `JsonValue`。嵌套调用的 `additionalContexts` 按顺序经 `exec.deferContext()` 转发；只有成功结果的 `concludesTurn` 才调用 `exec.concludeTurn()`。失败上下文保留，失败不会结束外层回合。任务核心、原生 Jobs 归属、审批、沙箱和取消机制保持原有职责。

按顺序执行 `pnpm run typecheck`、`pnpm test`、`pnpm run build`、`pnpm run smoke:profile`。最后一项在隔离 HOME/DSH_HOME 中安装包，通过官方 `dsh` 启动由 headless 模板派生的命名 Profile。验收仅关闭真实推理前端，在启动器就绪后加载测试消费者，使用官方工厂创建真实 Agent handle 并调用原生工具；不另建 Cordis 容器，不请求模型服务。

验收覆盖激活、声明式 workspace 执行、验证门禁、上下文/结束标记、原生策略拒绝、旧成功不能覆盖较新失败、后台等待、跨 owner 拒绝、取消及实际子进程退出、前台超时、源码失效，以及卸载后再次启动时工具/服务/提示消失。模型可见元数据与固定 JSON 样例比较；这是无密钥工具结果样例，不是完整模型 Session 回放。

原始报告、命令日志和受测安装包保留在 `.artifacts/official-compat/profile-*/`，最终校验和见 `SHA256SUMS`，交接见 `HANDOVER.md`。原有回执会把带终止信号的超时归为 `aborted`；验收单独核对官方 `timedOut` 标记及回执不能通过，不修改任务核心的分类规则。当前只实测 Intel macOS / Node 25.6.0；Windows、Linux、其他宿主版本、桌面/交互审批 UI、真实模型及其他 Agent 产品未验收。
