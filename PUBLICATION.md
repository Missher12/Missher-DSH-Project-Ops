# 0.4.0-alpha.2 Git 交付

本次同步包含新版 Project Ops 界面源码和匹配冻结包的运行文件。入口采用 DSH 主题与锚定面板，提供紧凑任务行、方案和交付预览；文档与 Jobs 后端行为保持不变。实现由 DSH 原生 DeepSeek-V4.1-Flash/max 完成，Codex 负责独立审查和 Git 交付。

类型检查、112 项测试、公开声明消费和 Host UI 契约检查通过。在官方 0.2.1-alpha.2 隔离 Web 中，亮暗主题、四种状态、缺少 READY 时禁用、两项预览、键盘焦点、外部点击关闭、窄窗口和滚动均通过，控制台错误为 0。

本机 Ubuntu 日常桌面已通过正式 CLI 安装，包内 18 个文件逐字节一致，重启后的插件处于 active；实际查看新版入口、空面板和当前任务面板通过。55 个会话日志及保留的用户设置、有效设置保持一致。这项安装不代表其他设备已同步。

尚未创建 GitHub Release，Intel Mac 原生尚未验证。官方类型依赖受原生沙箱限制，保留了经目标 Host 契约核查的窄声明；读取取消与四并发未做专项压力测试。Project Ops 本轮自身任务回执门仍为 stale，独立测试通过不会将它改写成原生验证门通过。开发时冻结的 PLAN/READY 保留当时状态，后续独立验收和日常安装以上述记录为准。

冻结包 SHA-256：`1d58e94f06c2f9f08faea45dfac141fe770ecc61343c179cda60668f5421b558`，大小 63,464 bytes。源码归档和运行件摘要见 [GIT_DELIVERY.json](GIT_DELIVERY.json)。公开导出只补充交付说明、同步 README 状态及沿用个人路径占位符；业务源码与冻结运行件未改。

[桌面与全部插件入口](https://github.com/Missher12/Missher-DeepseekHarness-Desktop) · [安装说明](INSTALL.md)
