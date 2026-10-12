# Project Ops 安装

本轮 Git 交付包名 `@missher/dsh-project-ops`、版本 **0.4.0-alpha.2**，针对 DSH 0.2.1-alpha.2 / Cordis 4.0.5-alpha.1。本机 Ubuntu 日常桌面已安装并验证新版入口；GitHub Release 和 Intel Mac 原生验收尚未完成。不要使用旧 0.3.1 下载链接代替本版，其他设备安装前应核对版本、目标 Host 与包摘要。验证及限制见 [PUBLICATION.md](PUBLICATION.md)。

获准集成时通过目标桌面匹配的 `dsh plugin --profile <目标profile> add <已核验tgz>` 安装。旧无 scope 包 `dsh-project-ops` 如已存在，先记录其准确版本和 Bundle 状态，再通过正式插件管理入口移除旧 Bundle，避免同时加载同名服务；保留全部项目文档与会话数据。不得用另一宿主的 CLI 或覆盖 profile 目录代替安装。

重载目标 profile 后确认插件无加载错误，Agent 工具包含七项既有能力与 document_read/document_write，会话标题栏出现 **Project Ops**。在合成工作区创建 PLAN，再经交付检查创建 READY，并测试两项预览入口。客户端入口取决于该 Host 能否加载插件的 dsh.client 扩展；工具注册不代替可见入口验收。

卸载只使用 `dsh plugin --profile <目标profile> remove @missher/dsh-project-ops`；不删除项目 `docs/tasks`、会话、笔记或学习数据。回退通过保留的原包与原配置执行，不能用旧源码的 lib 冒充冻结包。

源码开发与隔离 smoke 命令见 README；报告须分别列出源码、包、Host、原生平台、真实模型、发布与安装状态。
