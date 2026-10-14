# Project Ops

[桌面端](https://github.com/Missher12/Missher-DeepseekHarness-Desktop) · [安装说明](INSTALL.md) · [开发任务文档](docs/TASK_DOCUMENTS.md)

Project Ops 为 DeepSeek Harness 提供项目任务发现、原生执行与验证回执，以及开发方案和交付记录。包名统一为 `@missher/dsh-project-ops`，沿用本仓库，没有新增兼容插件。

当前产品版本为 **0.4.0-alpha.2**，已提供[正式安装包](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/latest)。本机 Ubuntu 已安装并查看新版入口和任务面板；其他设备请通过各自宿主的插件管理器更新。已测宿主、能力要求与限制分别列在下方和[交付说明](PUBLICATION.md)；[本轮 READY](docs/tasks/2026-10-12-project-ops-dsh-native-ui-9ab213e2baf81a6e/READY.md)保留开发时的记录。

## 宿主兼容

维护目标是支持合理的 DSH 版本范围，并持续适配最新版。兼容性取决于 Cordis、Agent、文件系统、Jobs、LLM、工具与客户端扩展能力；测试时的版本是验证基线，不是维护目标的上限。

当前包已在 DSH `0.2.1-alpha.2` / Cordis `4.0.5-alpha.1` 完成接口与隔离 Web 检查，并在配套 Ubuntu 桌面加载。当前冻结包的 Host peer 仍是精确声明，其他版本需要核对依赖安装与接口，尚不能宣称依赖范围已经放宽。Intel Mac 的完整插件原生交互尚未验证；桌面安装器通过不等于所有插件功能通过。

## 找到入口

在启用插件并加载客户端的 DSH Web / Desktop 会话标题栏点击 **Project Ops**。入口是与宿主标题栏动作一致的轻量按钮（无浏览器默认按钮外观），面板只使用宿主 `--dsw-*` 主题变量，随亮/暗主题自动适配。

面板列出当前会话工作区的开发任务：以中文标题为主体，目录名仅在读不到标题时回退显示，完整目录名始终保留在任务行的 `title` 中。四种交付状态简洁区分——交付关联当前方案、历史交付（方案已更新）、待核对、尚未生成交付；**“关联当前”只表示记录与当前方案修订一致，不代表验收通过**。

“查看方案 / 查看交付”打开宿主原生右侧文件预览；未生成的文档按钮禁用；打开文件后面板自动收起。面板固定在视口内并做钳制，窄宽度下内容内滚动；`Escape` 或点击面板外关闭，关闭后焦点回到入口按钮。刷新使用可取消读取（最多四并发），不会与上一次读取竞争。安装包存在、源码升级与当前桌面已启用是不同状态。

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
