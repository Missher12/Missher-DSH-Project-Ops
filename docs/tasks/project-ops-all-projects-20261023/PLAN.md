# Project Ops 全项目生产与交付总览 · 2026-10-23

状态：**静态候选，未验证、未构建、未冻结、未发布、未安装**。本回合只做静态实现与针对性测试代码；测试、类型检查、构建、打包、Host 与真实 UI 由 Codex 审查后按根窗口排期（阶段 B/C）。

## 需求

用户直接授权：所有已登记 DSH 项目的交付、构建产物、发布与安装状态都在同一 Project Ops 入口可见；范围为"所有项目 / 当前项目"，DSH 原生风格；保留 0.4.2 与 R5 全部功能及 header 对齐修复。生产外链仅 http(s)，本地路径限工作区相对；发布/安装是独立阶段，记录是会话报告，缺失状态未知。

## 接口事实（本机 0.2.1-rc.2 预检）

- `ctx.get('workspaces')` 的 `list.getSnapshot()` 返回 `{ items: [{ workspaceId, path, title, sessionIds, createdAt, updatedAt }] }`；`ctx.get('sessions')` 的 `list.getSnapshot()` 返回 `{ ids, byId }`，行含 `id` 与 `cwd`。
- 文件 remote 仍是 `list(sessionId, path)` / `readBytes(sessionId, path, {range}, signal)`，以会话为入口，无目录游标。
- 两套登记服务均为**可选**（能力检测），缺失时"所有项目"明确降级，当前项目视图不受影响；不新增硬依赖、不伪造 Host 接口、不修改 Host。

## 设计

- **数据面**（`src/client/index.tsx`）：`surface()` 增加 `projects` 能力位；`overview(signal, { projectOffset | group })` 读取登记快照，按**加载代**捕获项目列表快照（首批捕获，后续项目页沿用，刷新重建），并给每个项目缓存目录快照；仅当会话 `cwd` 规范化后**完全等于**登记 `path` 时才用作读取入口（异目录会话拒绝，项目标 `no-session`）。首批包含项目根 `PLAN.md`/`READY.md` 行，更深目录批量不重复。组续读前复核项目身份与同一会话，仍可用才继续。根或 `docs/tasks` 读取失败标 `incomplete`，不把空列表当成"已查全"。
- **生产字段**（纯模块 `src/production.ts`）：`DeliveryReport.production?` 记录 `kind(artifact|build|release|install)`、`name`、`target?`（http(s) 无凭据，或工作区相对路径：拒绝绝对路径、`..`、反斜杠与其他 scheme）、`version?`、`summary?`、`source`、`recordedAt`、`outcome?(succeeded|failed|unverified)`、`environment?`、`platform?`；每项有界，未知字段/错误类型按字段名拒绝；缺省 `production` 表示未知，旧报告与旧 READY 保持兼容。READY 正文新增"生产与发布记录（会话报告）"，`productionLine` 渲染 target/summary/环境/平台与来源时间。
- **展示**（`task-view.ts`、`ProjectOpsPanel.tsx`、`ProjectOpsAction.tsx`、`locales.ts`、`styles.ts`、CSS）：入口新增"所有项目/当前项目"切换；项目行含标题、相对路径、状态（可读/无可读会话/读取失败）、交付条目与每项目"更多"；行内生产信息标"会话报告"，展示 kind/名称/版本/结果/target/summary/环境/平台/来源与时间，>5 条提示完整内容在 READY；外链只作文本，不自动请求；本地证据仍走原生预览。检索在已加载范围内筛选，分页/取消/刷新/会话切换由代数票据隔离。
- **文档链**：`finish` 的 `data.production` 进入 `parseReport`→`encodeReady`→`decodePlan` 校验链；交付工具描述与 Agent 指引给出输入路径与"构建≠发布≠安装"的规则；owner/CAS/原子写语义未改。

## 阶段边界

- 阶段 A（本回合，完成）：静态实现 + 针对性测试代码。未运行任何命令。
- 阶段 B（待 Codex）：审查、类型、定向测试、构建与包检查。
- 阶段 C（待根）：合成多项目在隔离 Host 验证归属、覆盖、错误隔离、来源、原生预览与 DSH 风格。

## 改动文件

- 新增：`src/production.ts`、本 PLAN
- 修改：`src/task-documents.ts`、`src/document-tools.ts`、`src/agent-guidance.ts`、`src/client/document-status.ts`、`src/client/task-view.ts`、`src/client/index.tsx`、`src/client/ProjectOpsAction.tsx`、`src/client/ProjectOpsPanel.tsx`、`src/client/locales.ts`、`src/client/styles.ts`、`src/client/styles/project-ops.css`
- 测试：`tests/task-documents.spec.ts`、`tests/client-capability.spec.ts`、`tests/client-panel.spec.ts`
- 未改：`lib/`、`package.json`（版本仍 0.4.2）、锁文件、Host、日常 Profile、Git。

## 验收标准（全部未验证）

1. 全部登记项目都出现：无会话、无记录、读取失败的项目也列出，且不显示为成功或零交付。
2. 会话 `cwd` 与登记 `path` 不等时拒绝作为数据源；缺少登记服务时"所有项目"明示不可用，当前项目仍可用。
3. 同名任务跨项目不冲突：行携带真实项目身份与产生它的会话；原生预览用该会话打开。
4. 分页与组续读绑定同一加载代快照，刷新重建；取消、关闭、会话/范围切换不串数据；宿主截断与不完整读取明确提示。
5. 生产字段可选、有界：非法 target/未知字段/错误类型被拒；缺省为未知；构建、发布、安装互不推导；记录按会话报告展示并带来源与时间；READY 可见完整证据。
6. 既有的标题输入、局部更新、文档预览、header 对齐、主题、键盘与窄宽适配不回归。

## 建议最小检查（未运行）

```bash
npx vitest run tests/task-documents.spec.ts tests/client-capability.spec.ts tests/client-panel.spec.ts tests/client-status.spec.ts tests/client-styles.spec.ts
npx tsc -p tsconfig.json --noEmit
```

## 限制

- 本回合未捕获运行时证据；接口形状来自本机 0.2.1-rc.2 的已安装类型与实现，开发 SDK 可能更旧，因此代码只用能力检测与本地结构契约，不做硬依赖。
- 未做真实多项目 UI（窄宽、亮暗、键盘、原生预览）验证；未写 READY，未改版本，未发布或安装。
