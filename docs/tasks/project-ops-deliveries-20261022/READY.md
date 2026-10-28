# Project Ops 交付总览与标题输入修正 · 静态候选交付记录

状态：**静态候选，未验证、未冻结、未发布、未安装**。本记录只描述本轮静态编辑；所有检查均未运行，不能作为验收或兼容性证明。

## 实现

- **输入契约**（`src/task-documents.ts`、`src/document-store.ts`、`src/document-tools.ts`、`src/agent-guidance.ts`）
  - 新增 `PLAN_FIELDS` 与 `mergePlan`：`update` 在读取记录并用 `expectedRevision` 校验修订**之后**合并局部字段，仅缺省字段保留原值。
  - 修订校验前移：旧修订即使内容相同或传空对象也被拒绝，不再可能看起来像 no-op 成功。
  - 字段级错误：`null`、空串、错误类型、超 16000 字符、未知字段名都带字段名与补救提示；值从不截断、不伪造。
  - `begin` 的工具描述给出完整六字段与最小合法示例；systemPrompt 指引补上原先漏列的 `title` 与局部更新说明。
  - 完整六字段旧调用保持兼容；CAS、owner、原子写、失败/取消状态、READY 恢复路径未改语义。
- **交付总览**（`src/client/index.tsx`、`src/client/task-view.ts`、`src/client/document-status.ts`）
  - 发现范围：工作区根 `PLAN.md`/`READY.md` + `docs/tasks` 下任何含其中之一的直接目录；不再按 16 位摘要命名过滤，旧命名、普通记录、孤立 READY 均可见。
  - 无托管元数据 → 普通记录/待核对；元数据头存在但不合法或不在开头 → 待核对（损坏）；单目录/文档失败保留该行并带原因；`docs/tasks` 列表失败仍保留根记录并给出告警。
  - 分页：宿主 `remote.workspaceFiles.list` 无游标，故由客户端按“加载代”保存目录快照（在**每个 session 的 Face 闭包**内），首批之后的批次只按偏移读取同一快照；刷新（offset 0）或会话切换重建。两个会话交错加载互不覆盖。宿主列表 `truncated` 明确提示，删除静默前 100 项上限。
  - 每行展示标题、相对位置、来源标签、四种交付状态、方案/交付入口；托管交付的产物与验收句标为“会话报告”，产物为纯文本（不生成链接、不自动打开），摘要截断提示“完整内容见 READY”，待核对/缺失不显示旧验收句。
- **面板交互**（`src/client/ProjectOpsAction.tsx`、`src/client/ProjectOpsPanel.tsx`、`src/client/locales.ts`、`src/client/styles.ts`、`src/client/styles/project-ops.css`）
  - 刷新/会话切换带代数票据并中止在途读取；关闭面板中止读取；每批读取有界（固定批次、最多 4 个并发）。
  - 本地检索框按标题/目录名/相对路径过滤已加载记录；`FOCUSABLE` 纳入 `input/select/textarea`，检索框进入既有 Tab 焦点遍历。
  - 保留 0.4.1 已接受的 `align-self: var(--dsh-conversation-header-label-align, auto)` 修复与既有主题 token 用法。

## 改动文件

- `src/task-documents.ts`、`src/document-store.ts`、`src/document-tools.ts`、`src/agent-guidance.ts`
- `src/client/index.tsx`、`src/client/task-view.ts`、`src/client/document-status.ts`、`src/client/ProjectOpsAction.tsx`、`src/client/ProjectOpsPanel.tsx`、`src/client/locales.ts`、`src/client/styles.ts`、`src/client/styles/project-ops.css`
- `tests/task-documents.spec.ts`、`tests/client-status.spec.ts`、`tests/client-panel.spec.ts`、`tests/client-capability.spec.ts`
- `docs/TASK_DOCUMENTS.md`、`README.md`、`README.zh.md`
- 本目录 `PLAN.md`、`READY.md`

未修改：`lib/`、`package.json`、锁文件、版本号（保持 0.4.1）、`cordis.patch.yml`、`scripts/`、工作流与任何 Host/其他插件。

## 检查状态（全部未运行）

| 验收项 | 状态 | 说明 |
| --- | --- | --- |
| 1 局部 update 成功且只改所传字段；完整调用兼容 | unverified | 静态候选，测试未运行 |
| 2 begin/update 错误带字段名；null/空/错类型/未知字段/旧修订（含相同内容与空 patch）拒绝且不写文件 | unverified | 同上 |
| 3 根 READY/孤立 READY/旧命名/普通记录/损坏元数据可见；docs/tasks 失败保留根记录与告警 | unverified | 同上 |
| 4 同代快照分页稳定、两个会话隔离、宿主截断提示、无静默 100 上限 | unverified | 同上 |
| 5 产物/验收标为会话报告；截断指向 READY；待核对不冒称验收 | unverified | 同上 |
| 6 定向测试、类型检查、构建与包检查通过 | unverified | 本轮禁止执行，待根串行租约 |

### 建议的最小验证命令（未执行）

```bash
npx vitest run tests/task-documents.spec.ts tests/client-status.spec.ts tests/client-panel.spec.ts tests/client-capability.spec.ts tests/client-styles.spec.ts
npx tsc -p tsconfig.json --noEmit
```

构建与打包由发布责任人排期：`node scripts/build.mjs` 后按既有 `scripts/package-inspection.mjs` / `scripts/check-declarations.mjs` 流程冻结候选。

## 产物与发布

- 产物：无。本轮未构建、未打包，因此没有 tgz 与 SHA。
- Git：未提交、未推送。
- 版本：保持 `0.4.1`；0.4.2 版本号与冻结在验收通过后由发布责任人执行。
- 安装：未安装任何 profile（日常或隔离）。

## 限制与未验证

- **根因未取证**：没有捕获到那次 `Invalid title` 失败调用的正文。局部 `update` 原先强制完整六字段这一代码路径是最可能原因，但**不能断言已被现场证实**，也不能断言所有历史报错都来自同一原因。
- 未运行任何测试、类型检查、构建、打包或 Host；表中的 unverified 不是"通过"。
- 真实 RC.2 页面交互、窄宽度、刷新、原生文件预览截图均未进行。
- 新面板的视觉与交互（来源标签、产物/验收行、显示更多、检索框焦点顺序）只做了静态实现，需真实浏览器验收。
- 宿主目录列表自身的条目上限仍是宿主行为；客户端只能明确提示，无法突破。

## 回退

本轮改动均为源码/测试/文档，未触及构建产物与安装。回退只需还原上表列出的文件；未发布的 `lib/` 与既有候选不受影响。
