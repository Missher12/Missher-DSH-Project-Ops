# Project Ops

当前 Git 交付：**0.4.0-alpha.1**，包含匹配的源码与运行文件。[验证范围与安装说明](./PUBLICATION.md)。Git 同步不会自动更新已安装设备。


[桌面端](https://github.com/Missher12/Missher-DeepseekHarness-Desktop) · [安装说明](INSTALL.md) · [开发任务文档](docs/TASK_DOCUMENTS.md)

Project Ops 为 DeepSeek Harness 提供项目任务发现、原生执行与验证回执，以及开发方案和交付记录。包名统一为 `@missher/dsh-project-ops`，沿用本仓库，没有新增兼容插件。

当前源码为 **0.4.0-alpha.1 候选**，目标 Host 为 **0.2.1-alpha.2 / Cordis 4.0.5-alpha.1**。本候选尚未发布或安装到日常桌面；最终证据见 [本轮交付记录](docs/tasks/2026-10-12-task-documents-44fc988/READY.md)。历史 0.3.1 的旧 Host 证据不能代替本候选验收。

## 找到入口

在启用插件并加载客户端的 DSH Web / Desktop 会话标题栏点击 **Project Ops**，再选择“查看方案 / 查看交付”，使用宿主原生文件预览。未生成交付记录时相应按钮禁用。安装包存在、源码升级与当前桌面已启用是不同状态。

当前会话 Agent 在有一定规模的开发任务开始时维护 `docs/tasks/<日期>-<slug>-<身份摘要>/PLAN.md`，按进展续写，交付检查后写 `READY.md`。普通问答和极小修改不强制生成；生成方案后继续已授权开发，不新增审批门。正文由当前会话提供，不调用另一模型；失败、取消、未验证、未发布和未安装均保留事实，不把任意回复或 shell 退出当任务完成。

## 工具

原有七项能力保持：`missher_project_ops_task_list`、`task_plan`、`task_run`、`task_collect`、`verification_gate`、`capability_search`、`doctor`（后六项同样带 `missher_project_ops_` 前缀）。新增 `missher_project_ops_document_read` 与 `missher_project_ops_document_write` 管理独立开发任务文档。

任务发现只读取项目声明；执行仍交给 Agent 可见的原生 shell / Jobs。新版 Host 自动把前台等待超时命令转为后台时，Project Ops 保留原生 job ID 供收集与取消。插件不接受任意执行命令，不替代审批、沙箱、调度器或 Jobs。验证门复核回执和源码快照，未知证据不能判成功。

文档写入使用 Host 文件系统与会话策略、原子版本守卫和任务身份隔离。保护根 README/READY/AGENTS，检测人工编辑和中断，重启后从磁盘续写。READY 分开记录实现、验证、Git、发布、安装和限制；文件存在不表示所有工作已完成。不会自动推 Git。详细字段与恢复语义见 [任务文档说明](docs/TASK_DOCUMENTS.md)。

## 开发与验证

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:profile
```

使用 Node `^22.19.0 || >=24.0.0`。Profile smoke 只在本仓库 `.artifacts` 内创建隔离 DSH_HOME 和合成工作区，经正式 `dsh` Profile 安装、调用、卸载。它不等于真实模型、Electron、Intel Mac 或日常安装验收。

通用 Cordis 宿主可使用 `@missher/dsh-project-ops/cordis` 与 `projectOpsHost` 适配接口，原有执行能力保留；本轮新文档与客户端能力属于 Harness 入口。历史接口与证据见 [Cordis 集成](docs/CORDIS_INTEGRATION.md)、[旧官方验收](docs/OFFICIAL_COMPAT.md)。
