# dsh-project-ops 项目上下文

## 项目目标

`dsh-project-ops` 是一个独立发布、独立安装的 Cordis 项目执行插件，保留 DeepSeek Harness Bundle 兼容入口。它为 Agent 提供有界 monorepo 任务地图、受影响任务规划、原生 Jobs 托管、执行回执、验证门禁和当前能力搜索，不修改 Harness 源码。

## 技术架构

- 默认入口通过 `cordis.patch.yml` 注册 Harness Bundle；`dsh-project-ops/cordis` 提供无需 Harness 依赖的通用 Cordis 入口，通过 projectOpsHost 服务适配宿主。
- 读取 Session cwd 根目录任务清单，以及 `package.json#workspaces` 或 `pnpm-workspace.yaml` 明确声明的有界 package workspace。
- 根据显式相对变更文件生成稳定的受影响任务图；不会自动选择格式化或任意 other 脚本。
- 只把完整发现且声明上下文摘要匹配的声明式任务分派给 Agent 可见的 `bash` 或 `pwsh`。
- 自动/后台模式复用 shell 的 `run_in_background` 和 `ctx.jobs`；插件不注册自己的 job。
- 验证门禁重算计划、清单与有界内容快照；v3 回执须匹配激活期原生证据、所属项目与最新执行。源码变动、快照不可用、旧 v2/篡改/跨 session/重载回执均不能通过；快照不是原子的，也不证明环境或外部服务不变。
- 审批、沙箱、取消和工具结果仍由 Harness 主机管理。

## 文件结构

- `src/cordis.ts` / `src/project-ops.ts`：通用 Cordis 入口、宿主契约与共享服务。
- `src/index.ts` / `src/harness-host.ts`：Harness 工具 schema、提示注册、FS 与原生执行适配。
- `src/source-snapshot.ts`：有界项目内容指纹，明确产物目录策略；其余 src 文件提供发现、规划、回执和门禁规则。
- `tests/`：单元、插件契约和打包回归测试。
- `scripts/smoke.mjs`：临时 `DSH_HOME` 下的真实打包、安装、组合、执行和卸载 smoke。
- `scripts/smoke-clean.mjs` / `scripts/fixtures/cordis-host.mjs`：全新依赖目录下的真实 Cordis 与 Harness 包生命周期；样例执行器只在验收脚本，不进入插件包。
- `docs/CORDIS_INTEGRATION.md`：新电脑安装、宿主接入、能力检测及快照边界。
- `cordis.patch.yml`：Harness Bundle 组合入口。

## 安全不变量

1. 不接受任意 shell 文本，只执行发现到的声明式任务。
2. 执行前必须重新读取清单并校验 SHA-256 摘要。
3. 回执不保存命令、绝对路径、环境变量或审批文本。
4. 发布物不包含源码路径、source map、凭据或 Harness 主仓库文件。
5. 安装和 smoke 使用临时 `DSH_HOME`，不修改开发者的真实 `~/.dsh`。
6. 后台任务访问由 Harness JobRegistry 的 owner fence 决定；收集前还要核对 job 与声明式任务命令的内部绑定。
7. 验证门禁输出不重复变更路径、命令、输出或调用元数据。

## 发布边界

- 源码、Issue、CI 和 Release 只存放在独立的 `Missher12/dsh-project-ops` 仓库。
- 每个版本只产生一个 canonical `.tgz`，公网重新下载后必须与本地字节和 SHA-256 一致。
- DeepSeek Harness Desktop 仓库不嵌入插件源码，只通过标准 `dsh plugin` 命令安装。

## 当前进度

- `0.3.1`（S2 本地候选，未发布）：从 0.3.0 / 06849534c3352dd26b6fc2e38e9ef30e49fbf9ef 接续，只适配官方 Harness 0.1.5-rc.2 / Cordis 4.0.2：ToolCallId、JsonValue 来源、嵌套上下文与成功结束标记转发。任务核心及通用 Cordis 入口保持零改动。新增官方 dsh Profile 安装/实际调用/卸载验收与 keyless 工具结果样例，详见 docs/OFFICIAL_COMPAT.md。
- `0.3.0`（本地未发布）：Cordis 通用入口、Harness 薄适配、doctor、受信 v3 回执及源码指纹、后台配置变更后继续收集、证据容量淘汰、自动任务过滤和 pnpm 顶格列表修复。用户已明确授权实施；具体接口见 docs/CORDIS_INTEGRATION.md，验收记录见 HANDOVER.md。
- `0.2.2`（本地未发布）：随包提供 `docs/AGENT_USAGE.md`，并在宿主存在 `systemPrompt` 时自动注册 Agent 的发现→规划→执行→收集→门禁流程；标准 Harness 的 ToolRuntime 本身依赖 `systemPrompt`。
- `0.2.1`（本地未发布）：修复配置新鲜度、跨用途包影响传播、后台分派关联、未知结果误判成功、终态回执覆盖 running、取消传播和不完整发现门禁；真实安装包使用原版宿主 Tools/Jobs/subprocess 验收。
- `0.2.0`：加入 monorepo 任务地图、受影响检查规划、后台优先 auto 执行、owner-fenced 收集和确定性验证门禁。
- `0.1.2`：从 Desktop 开发分支迁移为自包含的独立仓库；运行时功能与已验证的 `0.1.1` 保持一致。

## 已知问题

- 历史 0.2.0 有三平台 CI 记录。0.3.0 验收限定 Intel macOS、Node 25.6.0、Harness 0.1.1-rc.2、@deepseek-ai/cordis 4.0.1 与独立 cordis 4.0.0-rc.9；Linux/Windows、其他 Node/宿主版本、Desktop UI、交互审批 UI 和 OS 沙箱强制隔离均未验收。
- Windows ARM 和其他未列出架构没有稳定验收 runner，不声明支持。
- Auto 是后台优先的有界等待，不是对已经启动的前台进程做提升；这是 Harness Jobs 接口的明确限制。
- 本版本不提供提示词伪装的“只读代码审查器”；通用 subagent 暂无每调用强制只读工具过滤边界。

## 2026-09-06 历史维护基线与数据流（0.2.x）

- 原始独立仓库：`Missher12/dsh-project-ops`，main 基线 `f6f7d0117bf448c50b945afbf499e7bcac04ba9c`，开始时干净，无仓库内 AGENTS.md；遵循用户会话指令。
- 隔离工作树：`/Users/missher/Documents/ChatGPT/dsh-project-ops-maintenance`；分支 `codex/project-ops-stability-20260906`。其他策略工作树保持原状。
- 执行链：有界发现与上下文指纹 → 包影响闭包与同用途拓扑 → 新鲜度/完整性校验 → Agent 可见原生 shell（parent/rootCallId/signal 不变）→ 原生 Jobs → 分派关联校验 → 输出无关回执 → 重算门禁。
- `manifestDigest` 字段保持兼容形状，含义扩展；旧摘要会失效，须重新发现/规划/执行。摘要覆盖全部发现清单、根 lockfile、.npmrc、.yarnrc.yml、tsconfig.json、turbo.json、nx.json 和调用信息。每个文件限 1 MiB，不递归读取配置引用。
- 收集绑定仅在插件激活期间存在，最多 4096 次后台启动；不维护 job 状态、不调度、不启动自有定时器。重载后用原生 job_output/job_kill 处理旧 job，不能伪造恢复插件回执。
- 不完整发现阻止执行及通过；空计划 pending。未知执行结果 unavailable；成功必须有零退出码。waitMs 是等待预算，后台无寿命超时，取消外层调用不承诺取消已分离 job。
- 依赖复用源仓库的既有 node_modules（只读链接），未在其他会话工作树安装或修改依赖。
- 详细验收和剩余接口方案见 HANDOVER.md；本会话没有推送、tag、Release 或真实用户 Profile 安装。

## 0.3.0 当前边界

- 内容快照默认包含未跟踪文件、嵌套配置，排除 .git/node_modules。产物目录由宿主显式配置并参与摘要；8192 目录项、32 层、单文件 8 MiB、总量 64 MiB，缺失覆盖不能取得通过。声明配置读取仍限 1 MiB，大 lockfile 尚需后续接口预算改进。
- 原生 Jobs 的归属、审批、沙箱、取消、有界等待和前台超时继续由宿主管理。通用插件不启动进程、不调度、不替代原生任务生命周期。
- 证据仅在当前激活期内，最多 4096 份含进行中的调用；终态在容量压力下淘汰。旧成功不能掩盖已知较新的失败尝试。重载和证据淘汰后使用原生 Jobs 管理旧任务，重新验证时需新执行。
- 原版 Harness 默认入口保持原有六个工具并新增 doctor；通用 Cordis bridge.bind 负责实际 Agent 工具与指引注册，缺少 bridge 不能声称任意 Agent 已接入。

## 0.3.0 最终本机验收

2026-09-08：69/69 测试、类型检查、双入口构建、包白名单与校验、独立 Cordis 干净安装/真实样例运行/卸载，以及隔离 DSH_HOME 下原版 Harness 安装/实际运行/卸载均通过。实际环境 macOS 15.7.4 Intel x64、Node 25.6.0、Harness 0.1.1-rc.2、@deepseek-ai/cordis 4.0.1、cordis 4.0.0-rc.9。完整边界见 HANDOVER.md。最终包 37,351 bytes，SHA-256 b9dc564958fdbb1fce04e3b56196a5b74939ab3832736da901763ff1326e8045；未发布。

## 2026-09-12 版本策略

总指挥 2026-09-12 15:28:17 UTC 核验：Project Ops 最新公开版为 0.2.0，远端默认 HEAD 为 f6f7d0117bf448c50b945afbf499e7bcac04ba9c；本轮承接较新的本地 0.3.0 / 06849534c3352dd26b6fc2e38e9ef30e49fbf9ef。官方最新已发布为 0.1.5-rc.2 / fb2c4b9e698e30edb738bca4cf0618587db7d203（npm next），npm latest 仍为 0.1.5-rc.1。官方 master c291e7961a515f6d7af9304e7fd1d257929aef26 仅作开发对照，不切换基线。Desktop 参考 d1e8bd9c6d49f980405888099087f931ddd26d83，不消费其分支私有构建。

## R5 与 S2 收束

按最新 R5，官方新发布先交付桌面，插件只维护必要兼容性，兼容则沿用。当前 0.3.1 是保留的局部兼容候选，不是强制跟随官方升版本或新增功能。71/71 测试、类型检查、构建、准确 peer 检查、官方 dsh Profile 安装/激活/实际调用/卸载与补充组件 smoke 均已通过；原始报告位于 .artifacts/official-compat/profile-ZxOZ3e/report.json。受测包 SHA-256 为 9fed65a24615211a06867223fd6f5510f51e9f775522294ead3a1d7a8fbe98c9。任务核心不变；原有信号超时归类 aborted 的限制见 HANDOVER.md。

## R7 消费验收收尾

2026-09-13：保留 S2 运行时提交 a08ce80def7876a82dc2b3e51cb653a81b1f846a 及同字节 0.3.1 包。本轮只补充源码侧验收工具：固定包及摘要检查、严格 NodeNext 声明消费、显式宿主/Node/组合 patch 输入和实际子进程环境记录。3/3 针对性测试、归档声明检查与显式固定包的隔离 Profile 安装/调用/卸载通过；沿用 S2 产品测试与构建证据，未机械重跑。操作入口见 docs/R7-CONSUMPTION.md，报告与限制见 HANDOVER.md。最终 Desktop SHA/运行时/组合 overlay 尚待总指挥提供，当前无插件源码阻断，不宣称最终桌面或新增平台通过。

R7 局部复审修正：ecedc69 的 createRequire 会向祖先搜索依赖，缺失/空显式宿主未被拒绝。两个消费入口现共用 selected-host.mjs，验证真实项目与安装目录，仅从显式包链接读取准确名称/版本，并记录逻辑及实际路径。修复前 6 个拒绝用例失败；修复后宿主选择 10 项加归档 3 项通过。pnpm 真实包链接投影的严格声明通过；原 71 项产品测试与包字节未受影响。Profile 复验细节及首次失败记录保留在 HANDOVER.md。

最终组合诊断准备：Profile 每次激活创建独立 attempt，原生/工具返回和错误在关键断言前落盘，缺失事实明确 unavailable，首次 installed.json/removed.json 仅允许首次创建。driver 在启动前记录宿主身份，CLI 退出信息与任务信息分开。3 项 instrumentation 加 10 项 selected-host 定向验证通过；此轮没有再跑完整 Profile 或 71 项产品测试。产品包不变，vilN8t 原因仍未知，最终组合须验证同一首个前台任务。
