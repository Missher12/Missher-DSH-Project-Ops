# Project Ops 安装

包名 `@missher/dsh-project-ops`，当前源码版本 **0.4.1**，面向 DeepSeek Harness 0.2 系列的多个宿主版本（已核验环境与最低接口见 [兼容性矩阵](docs/COMPATIBILITY.md)），不要求某个精确的 Host 版本。当前 main 包含文件分类、打开位置与精简界面等新改动；本次更新仅提交源码，没有执行 npm 发布，也没有新增 tag。

## 从当前 main 源码生成本地包

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination dist
```

`pnpm build` 重新生成 `lib/`；`pnpm pack` 按 `package.json` 的 `files` 打包，其中包含插件详情页用的简短介绍（`locale/*.json` 与 `docs/PLUGIN_DETAIL*.md`）。安装时使用本次生成的 `.tgz` 文件。

## 安装与更新

- 通过目标桌面匹配的 `dsh plugin --profile <目标profile> add dist/missher-dsh-project-ops-0.4.1.tgz` 安装。
- 旧无 scope 包 `dsh-project-ops` 如已存在，先记录其准确版本和 Bundle 状态，再通过正式插件管理入口移除旧 Bundle，避免同时加载同名服务；保留全部项目文档与会话数据。不得用另一宿主的 CLI 或覆盖 profile 目录代替安装。
- 已安装旧版时，用同一插件管理入口先移除再安装新包，然后重载目标 profile。
- 重载 profile 后**刷新 DSH 页面**加载新客户端界面，确认插件无加载错误、Agent 工具包含七项既有能力与 document_read/document_write、会话标题栏出现 **Project Ops**；测试“方案/交付记录”预览与文件条目的“打开位置”。客户端入口取决于该 Host 能否加载插件的 dsh.client 扩展；工具注册不代替可见入口验收。
- 插件管理器的详情页读取包内 `locale/<语言>.json` 的 `meta.detail`，显示 `docs/PLUGIN_DETAIL*.md` 的简短中文/英文介绍；GitHub 的 README 保留详细说明。
- 历史交付记录（[0.4.0](docs/tasks/2026-10-14-wide-host-compat-5f76a32a7990cb98/READY.md)）只代表 0.4.0，不代表当前 main；当前 main 的功能与真实验证范围见 [README](README.zh.md)。

## 卸载

只使用 `dsh plugin --profile <目标profile> remove @missher/dsh-project-ops`；不删除项目 `docs/tasks`、会话、笔记或学习数据。回退通过保留的原包与原配置执行，不能用旧源码的 lib 冒充冻结包。

源码开发与隔离 smoke 命令见 README；报告须分别列出源码、包、Host、原生平台、发布与安装状态。
