# Project Ops 1.0.0

1.0.0 提供会话文件分类、文件预览与打开位置、独立的项目方案、精简界面与窄栏图标。本轮修复了 0.4.2 遗留的本机构建环境问题，安装包由当前源码重新构建。

## 构建根因与修复（2026-11-05，macOS）

- 旧 `node_modules` 中的原生绑定与 npm registry 发布内容不一致，旧 yuku 绑定加载即崩溃，导致 `tsdown` 无法完成类型产物构建。
- 本机 DSH 自带的 hardened Node 无法加载 npm 的未签名原生绑定，报 `mapped file has no cdhash`。
- 按锁文件重新安装依赖（`pnpm install --frozen-lockfile`），并用标准 Node v24.22.1 构建后成功。未修改依赖签名或系统安全设置；构建脚本保留失败时恢复上一份 `lib` 的保护，并补充了修复提示。

## 真实检查（2026-11-05）

- DSH 完成依赖重装和构建后，Codex 独立执行 `pnpm run build` 再次成功，生成服务端、客户端与类型产物；重新生成的 `lib` 与仓库产物一致。
- `tsc --noEmit` 通过；vitest 23 个文件 191 项全部通过；`check:ui` 通过；打包后的归档检查通过。

安装包 `missher-dsh-project-ops-1.0.0.tgz`，SHA-256 `6d88bbc8272a6d92c01d11d23d834aaa04512a5a78e01ddec16471600c53fa08`，`267468` bytes。

## 下载与安装

[v1.0.0 Release](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v1.0.0) 提供安装包与 `SHA256SUMS`，安装步骤见 [INSTALL.md](INSTALL.md)。本轮未执行 npm 发布，未安装到日常 profile，未做新的界面复测。

## 未覆盖

其他平台、旧 Host 版本及所有模型组合不在本轮范围；1.0.0 的界面与功能验收沿用 0.4.2 已记录的范围，不重复声称新的界面验收。

## 历史交付

### Project Ops 0.4.2：交付文件分类与界面精简（历史）

本版把 `main` 上 0.4.1 之后的功能提交转为正式发布：按 Word / Excel 等类别整理当前会话交付的实际文件，在访达中定位文件，精简入口与面板界面，并保持文档预览、权限与版本保护不变。

本地验证（macOS，2026-11-02）：TypeScript 类型检查、UI 合约检查、peer 范围检查通过；vitest 23 个文件 191 项全部通过。构建脚本因本机 Node 24 对 rolldown 原生绑定的代码签名限制未能重跑；安装包中的 `lib` 沿用 `main` 提交 `5efe61c` 的已提交构建，本次版本差异只在 `package.json` 与文档。该构建限制已在 1.0.0 查明并修复。

冻结安装包 `missher-dsh-project-ops-0.4.2.tgz`，SHA-256 `189d096c4de0e1a2d8919e2c6feb728de5e21b7f5921780fb9fb3db0ff6a94cf`，267236 bytes。源码交付与正式 Release 分开记录：下载资产是否已发布以 [Releases](https://github.com/Missher12/Missher-DSH-Project-Ops/releases) 为准。

[本版正式 Release](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v0.4.2) 已公开，非草稿、非预发布。

### Project Ops 0.4.1：标题栏文字对齐

Project Ops 入口跟随宿主提供的共享文字基线，与会话标题、智能体团队和模式标签对齐。旧宿主没有该布局能力时保持原来的居中方式，不新增版本限制。任务面板与后端行为沿用 0.4.0。

本次通过 15 项定向测试、客户端 UI 合约和官方 RC.2 隔离加载。Ubuntu 首轮实际窗口已确认对齐；旧宿主回退由源码与编译产物合约检查，未声称完成所有宿主的真实界面复测。

冻结安装包 `missher-dsh-project-ops-0.4.1.tgz`，SHA-256 `be7941410e67e9c13564180b2282e33d5747a126727bf1f089415e416dd6439d`。源码交付与正式 Release 分开记录：下载资产是否已发布以 [Releases](https://github.com/Missher12/Missher-DSH-Project-Ops/releases) 为准。

[本版正式 Release](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v0.4.1) 已公开，非草稿、非预发布；安装包与校验文件已匿名下载复核，摘要与本机安装候选一致。当前 Ubuntu 已安装并完成标题栏原生截图检查。

### Project Ops 0.4.0

本版将宿主精确版本限制改为版本范围，并按可用接口降级可选功能；修复官方 alpha.5 的客户端远端服务访问。任务入口采用 DSH 主题、紧凑两行列表，方案与交付打开原生文件预览。原生执行、后台任务归属、权限和文档版本保护保留。

[安装包与校验和](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v0.4.0) · [安装步骤](INSTALL.md) · [界面截图](README.zh.md#界面) · [全部插件](https://github.com/Missher12/Missher-DeepseekHarness-Desktop)

本版在社区 rc.2、社区 alpha.2、官方 npm alpha.5 三个宿主完成隔离安装、运行、卸载；官方 alpha.5 Web 的亮暗主题、宽窄窗口、四种文档状态、PLAN/READY 预览与键盘焦点已验。类型检查、构建、定向回归、声明消费和版本范围检查通过。详细范围见 [兼容矩阵](docs/COMPATIBILITY.md) 与 [交付记录](docs/tasks/2026-10-14-wide-host-compat-5f76a32a7990cb98/READY.md)。

包 SHA-256：`c48e2895dd077421470ba5866e86016432201788fc222bcf4b1b15b6b7bd94ce`，249145 bytes。24 个包文件与此版本仓库一致，正式包的运行字节与受测预览包一致。

此版本日常安装尚未核验；Electron、Intel Mac 原生交互、真实模型自主流程和其他宿主版本不在已通过范围。0.4.0-alpha.2 的既有日常安装证据仍保留在 Git 历史，不转用于证明本版。
