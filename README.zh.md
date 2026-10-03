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

[English](README.md) | 中文

`dsh-project-ops` 是可独立安装的 Cordis 项目执行插件，保留 DeepSeek Harness Bundle 兼容入口。它让 Agent 在有界范围内理解项目声明的任务，按变更文件规划受影响检查，把长任务交给 Harness 原生 Jobs，并用不含输出的回执判断验证是否完整通过。

它不修改 Harness 源码，不替换 Desktop 管理的 Profile，不接受任意命令文本，也不会重复实现 Shell、任务注册表、工作流、审查器或沙箱。工具作用域、审批、执行策略、取消、输出保留和任务持有者隔离仍由 Harness 决定。

本次官方兼容切片更新工具调用 ID、JSON 类型来源，以及嵌套工具 `additionalContexts` / `concludesTurn` 转发。任务发现、规划、快照和回执规则保持原有行为。安装验收通过官方 `dsh` 启动实际 Profile，详见 [官方兼容证据](docs/OFFICIAL_COMPAT.md)。

## 快速安装

可以直接对 Harness Agent 说：“请按照 https://github.com/Missher12/dsh-project-ops 的 INSTALL.md，在我当前使用的 Harness 中安装 Project Ops，并验证已经加载可用。”

已有目标 Harness CLI 时，复制这一条命令安装固定版本：

```sh
dsh plugin --profile web add https://github.com/Missher12/Missher-DSH-Project-Ops/releases/download/v0.3.1/dsh-project-ops-0.3.1.tgz
```

Desktop 内置 CLI 的选择、校验、首次使用与卸载见 [INSTALL.md](INSTALL.md)。DSH Market 使用完整名称 `dsh-project-ops` 搜索，目录收录属于单独的发布步骤。

## 选择接入方式

- Harness 用户：继续按下方命令安装 Bundle，保留原有六个工具，新增只读 doctor。
- 其他 Cordis 宿主：加载 `dsh-project-ops/cordis` 并提供 `projectOpsHost` 服务。通用入口不加载 Harness 运行时，由宿主适配器暴露 Agent 工具并保留原生权限和取消机制。
- 完整安装、服务组合、适配接口和首次使用流程见 [Cordis 接入文档](docs/CORDIS_INTEGRATION.md)。

## 兼容性

`0.3.1` 的 Harness 入口以以下准确版本为兼容目标：

- DeepSeek Harness 软件包 `0.1.5-rc.2`；
- Harness 使用 `@deepseek-ai/cordis` `4.0.2`；
- Node.js `^22.19.0 || >=24.0.0`。

Profile 必须提供 `fs`、`tools`、`jobs` 和标准 `systemPrompt` 服务，并在 POSIX 上向 Agent 暴露 `bash`，或在 Windows 上暴露 `pwsh`。自动/后台执行还要求该可见 shell 定义提供 `run_in_background`，并且 Profile 已加载 Harness 常规任务控制工具。

其他 Harness 版本必须重新通过类型检查、测试、构建和隔离包生命周期 smoke 后，才能视为已验证兼容。npm 清单把运行时 peer 标记为 optional 只是为了避免 Profile 安装时的错误警告；Harness Host 仍须提供这些软件包。

重启该 Profile，让 Loader 重新组合 Bundle。只卸载本 Bundle：

```sh
dsh plugin --profile web remove dsh-project-ops
```

从源码构建同一个 Bundle：

```sh
pnpm install --frozen-lockfile
pnpm run build
npm pack
```

## 全新电脑上的 Agent 接入

可安装包会附带 [docs/AGENT_USAGE.md](docs/AGENT_USAGE.md)。安装包里的 Markdown 不会自动变成项目指令：Harness 的 `AGENTS.md` 加载器读取的是当前项目目录链。Bundle 激活时，Project Ops 会把这套流程的短版本注册到原生 `systemPrompt`。正常 Profile 应提供 `fs`、`tools`、`jobs` 和 `systemPrompt`；原版 Harness 的 `ToolRuntime` 本身就依赖 `systemPrompt`，自定义宿主必须先补齐它。

先调用 `missher_project_ops_doctor` 检查当前宿主能力与内容快照；依赖是否安装仍需另行核验。Agent 应固定按以下顺序使用：先调用 `missher_project_ops_task_list`，再用明确的变更文件调用 `missher_project_ops_task_plan`，解决所有诊断，只执行带原始摘要的声明式任务，收集后台回执，最后调用 `missher_project_ops_verification_gate`。Shell 执行、审批、沙箱、Jobs 持有者隔离和取消仍由 Harness 负责。

项目可以在仓库根目录增加简短的 `AGENTS.md`，说明如何取得变更文件以及哪些声明式检查属于验收。不要在其中放任意 shell 命令或绕过审批的规则。

### `missher_project_ops_task_list`

列出 Session cwd 根目录及有界声明式 package workspace 中的任务。每行包含任务身份、来源清单及 SHA-256、相对 workspace、可选包名、推断用途、依赖任务 ID 和可运行状态；不会返回脚本命令正文。

### `missher_project_ops_task_plan`

接收 1 到 256 个 workspace 相对 `changedFiles` 和一个目标：

- `verify`：测试、lint 和类型检查；
- `build`：构建任务；
- `all`：以上四类安全检查；格式化和任意 `other` 脚本不会被自动选择。

规划器会查找直接受影响的 workspace、本地反向依赖、任务依赖及匹配的根任务，返回稳定拓扑顺序、受影响 workspace、诊断、变更文件摘要及绑定所属项目与内容快照的计划摘要。已识别的 fix/update/watch 等任务保留在发现结果中，以 `automatic=false` 排除自动规划；名称和参数推断不构成只读安全保证。依赖任务成功结束后才能启动其依赖方。根目录级变更会保守地影响所有声明式 workspace。

### `missher_project_ops_task_run`

接收新鲜任务 ID、对应清单摘要和可选模式：

- `foreground`：前台等待可见 shell；为兼容旧版，它仍是默认值；
- `background`：通过 shell 原生 `run_in_background` 路径启动并返回 Harness job ID；
- `auto`：从同一后台路径启动，等待 1–10000 毫秒（默认 3000）；短任务直接返回终态回执，仍在运行的任务返回 running 回执。

Harness 无法把已在前台启动的进程提升成后台任务，因此 auto 是“先后台启动、再有界等待”。只有在执行前确认后台能力不存在时才退回前台；已经启动的 job 绝不会被重复执行。

每次分派前都会重新发现任务。清单变化、任务消失、执行器隐藏或声明不可运行都会安全失败。package workspace 任务通过 Agent 可见 shell 在其声明目录中执行。

### `missher_project_ops_task_collect`

轮询或等待 Project Ops 返回的 job。Harness JobRegistry 负责调用方持有者隔离；收集器还会核对激活期内的任务/项目/调用关联，并比较原生 job 标签与原始分派命令。配置变化后仍可收集结果，但内容变化会使回执失效。

### `missher_project_ops_verification_gate`

根据 `changedFiles` 和 `goal` 重新生成受影响任务计划，再把传入的计划摘要、version-3 回执与当前清单、内容快照及激活期内的原生执行证据比较。旧 v2、篡改、跨会话及重载后重放的回执不能通过。结果为：

- `passed`：全部必需任务都有新鲜的成功回执；
- `pending`：证据缺失或任务仍在运行；
- `failed`：必需任务失败、被阻止、取消或不可用；
- `stale`：计划、必需任务集合、任务元数据或清单摘要已变化。

门禁只返回任务 ID 和原因码，不重复变更路径、命令、输出、调用元数据、环境值或审批内容。

### `missher_project_ops_capability_search`

只排序当前调用 Agent 可见的 Harness 工具 schema 和当前项目任务，不搜索隐藏的全局注册表，也不会扩大工具作用域。

## 发现边界

根候选仍是 `package.json`、GNUmakefile/Makefile 变体和 Justfile 变体。package workspace 只来自 `package.json#workspaces` 或 `pnpm-workspace.yaml#packages` 下的列表。

workspace 模式只允许字面路径段、`*` 和末尾 `**`。绝对路径、父目录穿越、取反、声明中的反斜杠、不支持的 glob 语法和符号链接目录会被拒绝或跳过。固定上限为：

- 每份清单 1 MiB；
- 64 个 workspace package 目录；
- 128 个 workspace 模式；
- 遍历深度 8、检查目录 256；
- 总任务 256；
- 变更路径 256 个，每个最长 512 字符。

嵌套 package 没有声明包管理器时继承根包管理器。本地 package 依赖双方都声明同用途任务时，会生成同用途任务边。根 Make 只接受下一行含 Tab recipe 的简单显式目标；Just 只接受公开且无参数的 recipe。

## 回执边界

Version-3 回执增加不透明执行引用、源码摘要和新鲜度状态，并包含任务/来源/workspace/用途身份、清单摘要、执行模式、可选执行器和 job ID、嵌套调用 ID、开始时间、耗时、结果和可选退出码。它刻意不保存命令、绝对路径、输出、环境变量、沙箱策略文字或审批文字。

回执只是证据，不是权限。验证门禁在接受回执前始终重新发现清单并重算计划。

## 验证边界

`pnpm run smoke:package` 会将已构建的输出打成白名单校验归档，扫描源码路径和疑似密钥，在临时 `DSH_HOME` 中安装并组合临时 Profile，执行已安装插件的 workspace 任务和验证回执，再卸载 Bundle，并用仅哈希的顶层哨兵确认真实 `~/.dsh` 未变化。

本次维护仅实测 Intel macOS、Node 25.6.0、Harness 0.1.5-rc.2。CI 配置包含 Linux/macOS/Windows，但本版本未执行 Linux 或 Windows 验收，不沿用 0.2.0 的平台结论。

`pnpm run smoke:profile` 将安装包加入隔离的官方 Profile，经 `dsh` 启动，创建真实 Agent handle、调用原生工具，并在卸载后再次启动检查残留。无密钥 fixture 记录模型可见的嵌套上下文投影，不请求外部模型。

既有通用 Cordis 验收脚本 `pnpm run smoke:clean` 另在临时目录安装 Cordis 与插件包，不加载 Harness，验证适配后的真实样例任务及卸载/重载；随后独立安装固定版本 Harness 依赖，运行不引用开发目录 node_modules 的隔离安装生命周期。

## 0.3.1 稳定性修复与限制

- `manifestDigest` 扩大为声明上下文摘要：已发现的清单、workspace 声明、根 lockfile、`.npmrc`、`.yarnrc.yml`、`tsconfig.json`、`turbo.json`、`nx.json` 和选定调用。升级后须重新发现、规划及执行；旧摘要和回执会失效。每个配置文件限 1 MiB；不可读、超限或符号链接配置会阻止执行。
- 反向包影响传播不再要求两端有同用途脚本，支持无脚本中间包；执行顺序仍使用同用途任务边。不支持的 workspace 语法、重复包名、截断和依赖环不能通过门禁。执行前须解决发现诊断；无检查任务返回 pending。
- 未知 shell 结果不再算成功；成功回执必须有结构化的零退出码。同一次执行的终态覆盖 running，不同执行同时间戳仍保守处理失败证据。
- 后台收集除了宿主 owner fence 和 shell 标签，还核对插件激活期内的任务、摘要、cwd、调用 ID、开始时间绑定，活跃及近期证据连同进行中的分派最多 4096 份；终态证据会在容量压力下淘汰，不再累计消耗终身启动配额。重载前先收集；重载后旧任务仍可用原生 `job_output` / `job_kill` 管理，但不能重新生成 Project Ops 回执。
- `waitMs` 只限制等待时间。后台任务沿用宿主无超时语义，用原生 `job_kill` 取消；前台超时和取消由宿主管理。取消外层等待时，已启动 job 可能继续运行，应通过原生 `job_list` 找回并收集或取消，不能盲目重跑。
- 内容新鲜度覆盖有界项目树，包括未跟踪文件与嵌套配置；跳过 `.git`、`node_modules` 及操作者明确指定的产物目录。源码变化使旧回执失效，快照不可用不能通过。它不是原子文件系统快照，不证明外部输入、已安装依赖或环境不变；产物配置与读取上限见接入文档，门禁不是发布授权。

包 smoke 加载隔离安装后的入口，使用固定版本的真实 Cordis Tools、本地文件系统、shell、子进程和 Jobs 服务，覆盖策略拒绝、归属、取消、有界等待、前台超时、配置失效及卸载。Agent 是无需 LLM 联网的测试身份；不代表 Desktop UI、交互审批 UI 或操作系统沙箱强制隔离已验收。
