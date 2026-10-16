# Project Ops 安装

包名 `@missher/dsh-project-ops`，当前源码版本 **0.4.0**，面向 DeepSeek Harness 0.2 系列的多个宿主版本（已核验环境与最低接口见 [兼容性矩阵](docs/COMPATIBILITY.md)），不要求某个精确的 Host 版本。

安装前以你实际取得的包为准核对摘要：`sha256sum <tgz>` 与交付记录中的 SHA-256 一致，并确认该包来自你信任的交付位置。随包交付记录见 [交付记录](docs/tasks/2026-10-14-wide-host-compat-5f76a32a7990cb98/READY.md)；版本、环境与尚未验证项以该记录及其后续更新为准。界面与已核验环境见 [兼容性矩阵](docs/COMPATIBILITY.md)。

获准集成时通过目标桌面匹配的 `dsh plugin --profile <目标profile> add <已核验tgz>` 安装。旧无 scope 包 `dsh-project-ops` 如已存在，先记录其准确版本和 Bundle 状态，再通过正式插件管理入口移除旧 Bundle，避免同时加载同名服务；保留全部项目文档与会话数据。不得用另一宿主的 CLI 或覆盖 profile 目录代替安装。

重载目标 profile 后确认插件无加载错误，Agent 工具包含七项既有能力与 document_read/document_write，会话标题栏出现 **Project Ops**。在合成工作区创建 PLAN，再经交付检查创建 READY，并测试两项预览入口。客户端入口取决于该 Host 能否加载插件的 dsh.client 扩展；工具注册不代替可见入口验收。

卸载只使用 `dsh plugin --profile <目标profile> remove @missher/dsh-project-ops`；不删除项目 `docs/tasks`、会话、笔记或学习数据。回退通过保留的原包与原配置执行，不能用旧源码的 lib 冒充冻结包。

源码开发与隔离 smoke 命令见 README；报告须分别列出源码、包、Host、原生平台、真实模型、发布与安装状态。
