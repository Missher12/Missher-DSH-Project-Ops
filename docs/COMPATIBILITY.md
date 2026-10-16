# Project Ops 兼容性矩阵

本文说明 Project Ops 依据什么宣称"兼容某个 Host"、在哪些真实环境核验过、缺少哪一项能力时会降级成什么行为。判据是**能力**而不是版本号：插件在激活时探测自己真正调用的方法，缺哪一项就只关闭对应功能，并给出指名原因。

## 一、已核验的真实环境

| 宿主来源 | SDK / Cordis | 验收层级 |
| --- | --- | --- |
| 社区 rc.2（Missher 社区桌面封装） | 0.2.0-rc.2 / 4.0.4 | 无界面 Profile 安装/运行/卸载 + 静态接口面 |
| 社区 alpha.2（Missher 社区桌面封装） | 0.2.1-alpha.2 / 4.0.5-alpha.1 | 无界面 Profile 安装/运行/卸载 + 静态接口面 |
| 官方 npm alpha.5 | 0.2.1-alpha.5 / 4.0.5 | 无界面 Profile 安装/运行/卸载 + 真实 Web 界面验收 |

前两者是**社区封装**（Missher 社区桌面打包），不是官方 npm 原始包；两者的类型/运行件清单可能含有封装层调整，因此不能把它们的证据记成"官方原包实测"。官方 npm 线的证据只来自上表第三行。本表只描述宿主来源与验收层级，不含本机目录。

三个环境都用**固定候选包**做过无界面（headless）Profile 的安装 → 运行 → 卸载：各自独立的临时宿主环境与合成工作区，官方 alpha.5 那次未叠加社区兼容补丁，仅保留隔离测试 fixture 配置。安装后的 14 项行为检查（文档读写、真实执行、策略拒绝、owner 围栏、原生取消、超时提升后台、源码变更使回执过期等）通过，并验证卸载后工具与指导消失。因此官方 npm alpha.5 的这条记录就是**官方 npm 的真实行为证据**，而不是静态推断。

需要分清的是"合成的部分"：上述验收使用合成工作区与固定探针，**没有调用外部模型**；Web 界面验收同样是在隔离合成 Profile 中截图，未经过真实模型自主流程。Electron / Intel Mac 原生交互与真实模型轨迹仍未验证。

## 二、最低接口

必需（**整个服务缺失**时插件不会激活，这是 cordis 的 inject 语义：必需项写在 `inject` 里就是激活条件；**服务在但被探测的方法缺失**时插件照常激活，由 `doctor` 与其他工具返回指名错误）：

- FileSystem 服务：`lstat`、`resolve`、`contains`、`readBytes`、`listDir`、`processPath`、`stat`
- 工具注册表：`schemas`、`get`、`execute`、`register`
- 可见 shell 工具（`bash`，Windows 为 `pwsh`）及其 `workdir` 参数（任务位于子目录时需要）

可选（缺任一项只关闭对应功能，插件与其余工具照常可用）：

- 原生 Jobs 服务（`dsh-jobs`）的 `get`、`read`、`wait`，以及 `job_kill` / `job_list` / `job_output` 工具
- shell 工具的 `run_in_background` 参数
- 客户端 workspace 文件远端（`remote.workspaceFiles` 的 `list`、`readBytes`）
- 客户端原生文件预览（`sidebarRight.openResource`）

探测范围就是上表列出的方法：它们会被逐个检查"是否可调用"，缺失时按上表降级。**这不是对所有调用的整体保证**——例如文档存储还会调用 `writeText`，它不在当前探测表内；未列入探测表的调用如果缺失，会按其自身路径报错，而不是由本探测提前拦截。

## 三、发布范围

Host 依赖声明为范围而非精确版本，且不是 `*`：

```
@deepseek-ai/dsh-*      >=0.2.0-rc.2 <0.3.0-0 || ^0.2.1-alpha.2
@deepseek-ai/cordis     ^4.0.4 || ^4.0.5-alpha.1
react                   ^18.2.0
```

**为什么是两段**：semver 规定预发布版本只有在同一 `[major, minor, patch]` 元组上存在带预发布后缀的比较器时才被该范围接受。`0.2.0-rc.2` 与 `0.2.1-alpha.2` 分属两个元组，因此任何单段范围都会漏掉其中一个；两段分别覆盖 0.2.0 行与 0.2.1 行。开发依赖中的 SDK 仍精确定版，保证本地构建可复现；发布的 peer 范围与本地开发锚点解耦。

包含性由 Host 自带的真实 `semver` 实测（`scripts/check-peer-ranges.mjs`），包含例：`0.2.0-rc.2`、`0.2.1-alpha.2`、`0.2.1-alpha.5`、`0.2.1`、`0.2.5`；排除例：`0.2.0-rc.1`、`0.2.1-alpha.1`、`0.3.0-alpha.1`、`0.3.0`、`1.0.0`。Cordis 包含 `4.0.4`、`4.0.5-alpha.1`、`4.0.5`、`4.1.0`，排除 `4.0.3`、`5.0.0`。

## 四、缺能力时的降级

| 缺失 | 插件是否仍加载 | 行为 |
| --- | --- | --- |
| 整个 FileSystem / 工具注册表服务 | 否（激活阶段） | 必需服务写在 `inject` 里，服务缺失时插件不激活，由 Host 报告缺失的必需服务 |
| 工具注册表的 `register` 方法 | 否（注册阶段） | 注册第一个工具前就明确报错：`requires a Host tool registry exposing register()`，而不是在注册过程中抛 `TypeError` |
| 其他被探测方法（如 FS 的 `lstat`、注册表的 `schemas`） | 是 | 插件照常激活；`doctor` 报 `scope: unavailable` 与指名原因（例如 `FileSystem service does not expose lstat`），其余工具以同样原因拒绝 |
| 原生 Jobs 服务 | 是 | 前台执行照常；`doctor` 报 `background: false`、`cancellation: false`；显式后台模式在派发前拒绝并说明原因；收集同样指名拒绝 |
| shell 的 `run_in_background` | 是 | 同上，原因改为"可见 shell 未暴露 run_in_background" |
| `job_kill` 工具 | 是 | 仅取消不可用，其余不变 |
| 客户端 workspaceFiles 远端 | 是 | 面板显示"此 Host 未提供工作区文件读取能力"，**不**渲染成"尚无开发任务"；技术服务名放在 tooltip |
| 客户端 sidebarRight | 是 | 任务仍列出，两个文档入口禁用并给出同一原因 |

后台任务被 Host 自动提升（前台超时转后台）时，即使本 Host 没有 Jobs 服务，回执仍保留原生 `jobId`、`outcome: running` 与后续收集提示：原生任务不被丢弃，也不会被写成成功。

## 五、加载顺序与模块表

- 插件 `inject` 只保留 `fs`、`tools`：cordis 4.x 的 plugin `inject` 是"服务名→配置"映射，写进去就是硬性激活条件，因此 `jobs` 改为调用时惰性探测。
- `dsh.client.inject` 保留 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-workspace-files`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-locale`，去掉 `@deepseek-ai/dsh-client-ui-sidebar-right`。客户端模块加载器对**不存在的**依赖行直接跳过，对**加载失败**的依赖行才会级联报错；因此保留前四项是为了让面板依赖的槽位与远端按序就绪，去掉可选预览包是为了不让它成为失败级联点。
- 客户端 bundle 只 `require` 平台模块表行：`react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives`（构建门禁强制）。两个已核验的 Web shell 都暴露同一张表；官方 alpha.5 未链接独立 primitives 包时，以 Web shell 内联的模块表为准，不判作"服务缺失"，也不引入第二份 React。

## 六、证据与运行命令

已执行结果（2026-10-17，隔离环境）：类型检查与构建通过；修复后的针对性回归 3 文件 13 项（含 7 项真实 cordis 回归）通过；peer 范围实测、三套真实目标的静态接口面、归档声明消费（strict、`skipLibCheck=false`，在已定版的开发 SDK 上针对归档 tgz）与三套目标的 UI 契约检查均通过。UI 契约在官方 alpha.5 上因 primitives 内联而把导出级校验标为静态不可验，该点随后由官方 alpha.5 的真实 Web 加载与四状态验收证明。此前的 114 项全量测试属于历史记录，不作为本轮的资源通过证据。

静态证据（编辑期即可完成，不产生运行副作用）：

- `scripts/check-host-surface.mjs`：对三个真实目标逐一记录发行标签、SDK/Cordis 版本与 manifest SHA-256，并核对上表"最低接口"的成员是否存在于该 Host 的编译产物中。它是**静态成员存在性**检查，不等于行为通过。
- `scripts/check-peer-ranges.mjs`：用 Host 自带 semver 实测范围包含性。

动态证据（需在隔离环境顺序执行，输出留档）：

```bash
# 1. 范围包含性（任选一个真实 Host 的 semver）
node scripts/check-peer-ranges.mjs --semver-root "<host-root>"

# 2. 三个真实目标的接口面
node scripts/check-host-surface.mjs

# 3. 类型与行为回归
npx tsc -p tsconfig.json --noEmit
npx vitest run

# 4. 包与声明消费（先构建，再用固定 tgz 的 SHA）
node scripts/build.mjs
npm pack --pack-destination .artifacts/pack
PROJECT_OPS_ARCHIVE=<tgz> PROJECT_OPS_ARCHIVE_SHA256=<sha256> node scripts/check-declarations.mjs

# 5. 选定 Host 的原生 Profile 装载（脚本按 Host 实际版本运行，可选 PROJECT_OPS_HOST_VERSION 严格定版）
PROJECT_OPS_HOST_ROOT="<host-root>" node scripts/smoke-profile.mjs
```

归档只包含白名单内的源码与文档（`package.json` 的 `files` 列表），隔离证据、学习数据与个人会话不在其中。

## 七、未测范围

- 版本范围允许但**未被核验**的版本：只核验了上表三个锚点，不宣称范围内其他版本已测。
- 社区封装的官方原包一致性：社区封装可能调整类型面与运行件清单，本文件不据此宣称官方原包结论。
- 真实模型自主轨迹、Electron / Intel Mac 原生交互与日常安装：未验证，不在本轮范围。
- 安装包摘要：以对应 Release 资产的 `SHA256SUMS` 为准，本文件不预先声明。
- 官方类型依赖：本机沙箱下无法安装 `@deepseek-ai/dsh-client-ui-primitives` 与 `@types/react-dom`，客户端保留经目标 Host 产物核验的窄声明（见 `src/client/platform.d.ts` 文件头）；该声明由 `check:ui` 对照真实产物复核，漂移即失败。
