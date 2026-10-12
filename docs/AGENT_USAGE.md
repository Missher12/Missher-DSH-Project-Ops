# 0.4 开发任务文档

当前主名称 Project Ops，包名 `@missher/dsh-project-ops`。调用 `missher_project_ops_document_read` / `missher_project_ops_document_write` 管理 PLAN 与 READY，先阅读 [任务文档说明](TASK_DOCUMENTS.md)。下文是保留的声明任务执行流程；原 systemPrompt 指引已扩展为开发文档加原生执行，普通问答不强制使用。

# Project Ops Agent 使用契约

这份文件是 `dsh-project-ops` 随包提供的可查阅说明。它不会被当作宿主系统提示自动读取。Bundle 激活时会把同一套短流程注册到 Harness 原生 `systemPrompt`，所以正常 Profile 不需要把这份文件复制到项目里。

通用 Cordis 入口由宿主的 `projectOpsHost.bind` 注册工具和指引；具体安装及服务契约见 [CORDIS_INTEGRATION.md](CORDIS_INTEGRATION.md)。下方工具名是推荐契约，宿主改名时须同步指引。

## 新电脑上的接入条件

先把 Bundle 安装到目标 Profile，并重启 Profile 让 Loader 重新组合 Bundle。Profile 需要提供：

- `fs`：读取当前 Agent Session 的项目目录；
- `tools`：注册插件工具，并向 Agent 暴露 POSIX `bash` 或 Windows `pwsh`；
- `jobs`：使用 Harness 原生后台任务、持有者隔离、等待和取消；
- `systemPrompt`：让插件把下面的工作流提示自动交给 Agent。

标准 Harness 的 `ToolRuntime` 本身依赖 `systemPrompt`。如果自定义宿主没有这个服务，应先补齐宿主组合；仅把 Markdown 放进项目不能替代它。

## Agent 必须遵循的流程

1. 首次接入先调用 `missher_project_ops_doctor` 检查可见执行能力和快照；不要把依赖状态 unknown 当成已安装。需要了解项目任务时，调用 `missher_project_ops_task_list`。
2. 调用 `missher_project_ops_task_plan`，明确传入 workspace 相对 `changedFiles` 和 `goal`：`verify`、`build` 或 `all`。
3. 规划返回的 `diagnostics` 必须先解决。不能用不完整发现结果执行或宣称通过。
4. 按计划返回的顺序执行，等待依赖任务成功完成后再启动其依赖方；按顺序启动后台 job 不等于依赖已完成。`automatic=false` 的任务只在明确选中时执行。每次传入原样的 `task.id` 和 `manifestDigest`。短任务或不确定时使用 `auto`；预计较长的任务使用 `background`。
5. 保存每个回执。仍在运行的任务使用 `missher_project_ops_task_collect`，并原样传入任务、摘要、job、嵌套调用和开始时间字段。
6. 插件重载后，旧 job 由 Harness 原生 `job_output` / `job_kill` 管理；不能伪造一个新的 Project Ops 回执。
7. 最后调用 `missher_project_ops_verification_gate`，传入相同的 `changedFiles`、`goal`、`planDigest` 和相关回执。
8. 源码变化后重新规划和执行，旧回执不能证明新内容通过。快照不可用、重载后缺失证据均不能自行补写成功回执。只有 `verdict: passed` 才能报告验证完成。`pending`、`failed`、`stale` 和任何发现诊断都需要继续处理。

## 明确禁止

- 不向 Project Ops 传入任意 shell 文本；任务命令只能来自发现到的声明式任务。
- 不绕过 Harness 的审批、沙箱、Jobs owner fence 或取消机制。
- 不因为 `waitMs` 到期就重新运行同一任务；等待结束不代表 job 已终止。
- 不把输出文字当作成功证明；成功回执必须有结构化的零退出码。
- 不把门禁当成独立的安全或发布权威。它核对当前声明、内容快照和激活期内的原生回执，不证明未覆盖的环境或外部输入。

## 项目自己的 `AGENTS.md`

项目可以在仓库根目录写自己的 `AGENTS.md`，告诉 Agent 如何获得可靠的变更文件列表、哪些检查属于项目验收、哪些目录不能触碰。项目规则比这份通用契约更具体时，Agent 应同时满足两者；项目规则不能授权任意命令、绕过宿主审批或改变 Project Ops 的声明式边界。

推荐最小内容：

```md
# Project checks

- Use Project Ops for declared checks and builds.
- Before execution, obtain the changed files from the review or VCS context.
- Resolve every Project Ops discovery diagnostic before running tasks.
- Report the verification gate verdict and reason codes with the final result.
```

这段项目文件是给当前仓库的 Agent 指令，不是插件安装步骤，也不应复制插件的内部命令实现。
