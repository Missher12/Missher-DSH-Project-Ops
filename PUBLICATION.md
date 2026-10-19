# Project Ops 0.4.1：标题栏文字对齐

Project Ops 入口跟随宿主提供的共享文字基线，与会话标题、智能体团队和模式标签对齐。旧宿主没有该布局能力时保持原来的居中方式，不新增版本限制。任务面板与后端行为沿用 0.4.0。

本次通过 15 项定向测试、客户端 UI 合约和官方 RC.2 隔离加载。Ubuntu 首轮实际窗口已确认对齐；旧宿主回退由源码与编译产物合约检查，未声称完成所有宿主的真实界面复测。

冻结安装包 `missher-dsh-project-ops-0.4.1.tgz`，SHA-256 `be7941410e67e9c13564180b2282e33d5747a126727bf1f089415e416dd6439d`。源码交付与正式 Release 分开记录：下载资产是否已发布以 [Releases](https://github.com/Missher12/Missher-DSH-Project-Ops/releases) 为准。

## 历史交付

Project Ops 0.4.0

本版将宿主精确版本限制改为版本范围，并按可用接口降级可选功能；修复官方 alpha.5 的客户端远端服务访问。任务入口采用 DSH 主题、紧凑两行列表，方案与交付打开原生文件预览。原生执行、后台任务归属、权限和文档版本保护保留。

[安装包与校验和](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v0.4.0) · [安装步骤](INSTALL.md) · [界面截图](README.zh.md#界面) · [全部插件](https://github.com/Missher12/Missher-DeepseekHarness-Desktop)

本版在社区 rc.2、社区 alpha.2、官方 npm alpha.5 三个宿主完成隔离安装、运行、卸载；官方 alpha.5 Web 的亮暗主题、宽窄窗口、四种文档状态、PLAN/READY 预览与键盘焦点已验。类型检查、构建、定向回归、声明消费和版本范围检查通过。详细范围见 [兼容矩阵](docs/COMPATIBILITY.md) 与 [交付记录](docs/tasks/2026-10-14-wide-host-compat-5f76a32a7990cb98/READY.md)。

包 SHA-256：`c48e2895dd077421470ba5866e86016432201788fc222bcf4b1b15b6b7bd94ce`，249145 bytes。24 个包文件与此版本仓库一致，正式包的运行字节与受测预览包一致。

此版本日常安装尚未核验；Electron、Intel Mac 原生交互、真实模型自主流程和其他宿主版本不在已通过范围。0.4.0-alpha.2 的既有日常安装证据仍保留在 Git 历史，不转用于证明本版。
