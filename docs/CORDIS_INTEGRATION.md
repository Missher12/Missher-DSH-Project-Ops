# Cordis 安装与宿主接入

`dsh-project-ops` 0.3.1 提供两个入口。当前切片只适配官方 Harness 0.1.5-rc.2 / @deepseek-ai/cordis 4.0.2，通用入口保持不变；历史通用宿主验收不等于新增版本的产品兼容结论。

| 入口 | 用途 | 宿主服务 |
| --- | --- | --- |
| `dsh-project-ops` | 保持 Harness Bundle 默认安装兼容 | 原生 fs、tools、jobs；Agent 指引使用 systemPrompt |
| `dsh-project-ops/cordis` | 通用 Cordis 插件，导入时不加载 Harness 包 | `projectOpsHost`，服务契约 apiVersion=1 |

Cordis 负责组合和生命周期。插件安装、服务注入、工具对 Agent 可见、实际执行通过是四个不同验收步骤。非 Cordis 宿主必须先有宿主集成；下载包或复制 Markdown 不能替代它。

## Harness：全新电脑的最短路径

1. 先安装并启动支持原生 Tools/Jobs/FS 的 Harness，配置自己的模型与目标 Profile。插件不提供模型账号或宿主安装器。
2. 从明确可信的交付位置取得 `dsh-project-ops-0.3.1.tgz` 并核对交付 SHA-256；当前版本未发布，不假设公共下载 URL 或 npm 最新版存在。
3. 使用目标宿主的 CLI 安装：`dsh plugin --profile <目标Profile> add ./dsh-project-ops-0.3.1.tgz`。
4. 重启目标 Profile，再在目标项目目录开启 Agent 会话。确认本会话能看到 `missher_project_ops_doctor`、task_list、task_plan、task_run、task_collect、verification_gate、capability_search 七个同前缀工具。
5. 先调用 `missher_project_ops_doctor`。`foreground=false` 表示当前 Agent 没有可见平台执行器；`background=false` 时不要要求后台模式。`sourceSnapshot=false` 时门禁不能宣称通过。runnerDependencies=unknown 表示尚未证明项目依赖和包管理器安装完整。
6. 用 list → plan → run → collect（运行中才需要）→ gate 完成一个项目已有的小检查。参数只能使用当前工具返回的 ID、摘要和回执；以当前工具 schema 为准。详细步骤见 [Agent 契约](AGENT_USAGE.md)。

卸载：`dsh plugin --profile <目标Profile> remove dsh-project-ops`，然后重启 Profile。卸载前用原生 Jobs 收集或取消仍在运行的任务；插件卸载不代表原生 job 已停止。回滚时卸载当前版本并安装已核对摘要的旧包，重新发现、规划和执行，不复用新版本回执。

## 其他 Cordis 宿主：安装与组合

包依赖由宿主管理，在独立的宿主目录安装本地 tgz。通用入口不要求安装 Harness peers；不要导入默认 Harness 入口。

```js
import { Context } from 'cordis'
import * as ProjectOps from 'dsh-project-ops/cordis'
import { projectOpsHost } from './your-host-adapter.js'

const ctx = new Context()
const adapter = await ctx.plugin((inner) => {
  inner.provide('projectOpsHost', projectOpsHost)
})
const plugin = await ctx.plugin(ProjectOps)
// projectOpsHost.bind() 将工具和指引挂入当前宿主的 Agent。
// 无 bind 时仅注册 projectOps 服务，不能声称 Agent 已接入。
// 停用时先卸载插件，再卸载服务适配。
await plugin.dispose()
await adapter.dispose()
```

这段是宿主组合示例，`your-host-adapter.js` 必须由宿主提供，不是包内预置文件。不要把本插件注册成另一个 Agent 的 Skill。没有适配接口时应提交宿主需求，不修改其他产品源码。

## projectOpsHost 契约

TypeScript 接口从 `dsh-project-ops/cordis` 导出。宿主实现 `ProjectOpsHost<NativeCallContext>`：

| 方法/字段 | 责任 |
| --- | --- |
| `apiVersion: 1` | 固定服务契约版本，不按同名服务猜测兼容 |
| `scope(call)` | 返回原生 session + canonical project root 的内部 identity、有界 ManifestReader、可选 snapshot(signal) |
| `signal(call)` | 返回本次原生调用的 AbortSignal |
| `capabilities(call)` | 返回宿主名称、实际版本或 unknown、当前调用者的前台/后台/取消能力 |
| `execute(task,args,call)` | 执行插件重新发现的固定 TaskInvocation，保留原生 owner、审批、沙箱、parent/root 调用关系；返回结构化结果与回执；Harness 适配必须通过 deferContext / concludeTurn 转发嵌套控制元数据，失败不得结束外层回合 |
| `collect(task,args,call)` | 向原生 Jobs 获取当前状态/输出，校验归属和任务关联；不能通过输出文字猜成功 |
| `cancel(receipt,call)` | 可选，调用原生取消接口并继续遵循归属验证 |
| `tools(call)` | 可选，只返回当前调用者实际可见的工具元数据 |
| `bind(service)` | 可选，将下表方法注册为 Agent 的原生工具并提供工作流提示；返回移除工具和提示的 disposer |

`scope.identity`、snapshot 结果和原生上下文不得直接来自模型参数。路径必须限定在授权项目根，拒绝逃逸、符号链接和截断发现。没有 execute/collect 时，对应操作返回不可用；不允许兜底启动进程。发现声明可运行并不证明包管理器或项目依赖已安装。

| 推荐 Agent 工具名 | 服务调用 |
| --- | --- |
| `missher_project_ops_doctor` | `service.doctor(nativeCall)` |
| `missher_project_ops_task_list` | `service.list(nativeCall)` |
| `missher_project_ops_task_plan` | `service.plan(nativeCall, {changedFiles, goal})` |
| `missher_project_ops_task_run` | `service.run(nativeCall, {taskId, manifestDigest, mode?, waitMs?})` |
| `missher_project_ops_task_collect` | `service.collect(nativeCall, {taskId, manifestDigest, jobId, nestedCallId, startedAt, waitMs?})` |
| `missher_project_ops_verification_gate` | `service.gate(nativeCall, {changedFiles, goal, planDigest, receipts})` |
| `missher_project_ops_capability_search` | `service.search(nativeCall, query, limit?)` |

宿主原生工具层负责输入 schema 和权限检查，CallContext 由宿主传入，不能作为模型可填写的字段。可使用导出的 `PROJECT_OPS_AGENT_GUIDANCE` 注册工作流；工具改名时同步转换指引中的名称。保留宿主指令优先级，不以普通文档冒充系统指令。

## 源码快照、产物和回执

默认内容快照读取授权项目树，包含未提交、未跟踪文件与嵌套配置；只跳过 `.git` 和 `node_modules`。限 8192 条目录项、32 层、单文件 8 MiB、总文件内容 64 MiB。遇到无法读取、符号链接或超限，快照不可用，门禁不通过；根声明读取另有 1 MiB 上限。

构建产物需要由宿主操作者明确指定目录。例如 Harness 的程序化组合：

```js
await ctx.plugin(HarnessProjectOps, {
  snapshotOutputDirectories: ['dist', 'coverage'],
})
```

这是 `apply(ctx, config)` 的插件配置；具体 Profile 配置编辑方式按宿主 Loader 文档操作。默认不排除这些目录。不能把实际输入目录填成产物；排除目录属于快照覆盖边界并参与摘要。通用宿主可复用导出的 `sourceSnapshot(reader, signal, {outputDirectories})`，或提供符合本宿主输入边界的受信快照实现。

规划、执行前后、收集和验证都核对快照。v3 回执绑定本次激活、所属 session/project、执行引用与快照；篡改、跨 session 使用、重载后重放、旧 v2 回执不能取得完整通过。已完成证据可在容量压力下淘汰，此时报告过期，不重新执行任务。最多保留 4096 份活跃/近期证据，终态证据在后续启动时收缩到约 1024 份；这不是原生 Job 保留策略。

这些是边界时刻的内容检查，不是原子文件系统快照，不证明执行期间所有瞬间、node_modules、外部服务或环境变量不变。项目若依赖这些额外输入，应由宿主扩展 snapshot 契约。门禁是项目验证辅助，不是发布授权。

## 维护验收

在本仓库构建后运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run smoke:package` 和 `npm run smoke:clean`。clean 验收在临时目录从包源安装明确版本的宿主依赖，禁止引用开发目录 node_modules；分别验证通用 Cordis 服务与隔离 DSH_HOME 的 Harness 安装、运行、卸载。

结果须记录实际 Cordis 包名/版本、宿主版本、操作系统、架构、Node 版本和包摘要。自定义验收桥接不等于所有第三方 Agent 产品或完整 LLM/UI 流程通过。未运行的平台不得声明通过。
