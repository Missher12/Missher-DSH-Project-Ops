# Project Ops 会话文件产物与窄入口 · 2026-10-29

状态：**源码候选，未运行、未构建、未验收**。本回合集中实现 REQUEST 与 COMPACT-TRIGGER-ADDENDUM；测试只写未跑，由协调会话静态审查后统一写 READY。

## 需求

1. 独立“文件产物”视图：不需要 PLAN/READY，不按扩展名白名单发现；显示文件名、大小、路径、真实来源会话或“项目文件，生成会话未确认”、准确存在性。
2. 优先持久 presented 记录；不能只靠已载入对话或模型正文猜路径；有界分页、取消、去重、注册项目/会话身份校验；旧 Host 缺能力时关闭该来源并清晰提示。
3. 项目内按需有界浏览 `dist`/`build`/`out`/`exports`/`release` 与根目录输出；不按 Git/@file/mtime 猜作者，不把无权限/部分读取显示为“没有文件”。
4. Excel/PDF/图片走现有 `sessionFileAddress`/`sidebarRight` 预览；其他二进制保留文件项；EXE 不执行；只有真实公开能力才提供位置/复制/下载。
5. Agent 指引：有原生 `present` 时登记最终文件，不把路径抄进 READY。
6. 头部入口按会话头可用宽度收缩为图标，保留 title/aria-label/焦点/键盘/弹层；侧栏/分栏变窄有效；测量容器而非按钮，避免抖动。
7. 修 R2 三项：session registry `phase: pending`；`filterGroups` 已筛选 rows 进入 Panel 渲染；订阅只对就绪/身份变化通知，current 视图不受全局无关刷新。

## 已实现（静态）

- `src/client/files.ts`：根目录常量、文件类型/预览类型、安全路径、排序/去重/过滤、大小格式化、`ProjectOption`。
- `src/client/index.tsx`：`files()`（真实目录列举，`offset` 分页，缺失目录 `missing`，宿主截断 `truncated`，`other` 类型计为告警）、`projects()`、`openFile()`、`surface().files`；`readSessionCwds` 增加 pending/loading 降级；`observe` 以“就绪/项目与会话身份”签名过滤通知。
- `src/client/ProjectOpsAction.tsx`：第三个视图与目录/项目/层级状态、代数票据取消、ResizeObserver 测容器 + 滞回（120/168px）折叠入口；仅 all 视图响应注册表变化。
- `src/client/ProjectOpsPanel.tsx`：三视图切换、文件视图（根切换、项目选择、面包屑、大小/路径/类型、目录展开、预览按钮、EXE/未知类型只读说明、缺失/截断/告警/更多）、`ProjectSection` 直接渲染 shell 传入的 rows（R2-2）、窄态入口只留图标。
- `src/client/locales.ts`、`styles.ts`、`styles/project-ops.css`：文案与主题 token 样式；`src/agent-guidance.ts`、`docs/AGENT_USAGE.md` 增补 present 指引。
- 测试（未运行）：`tests/client-files.spec.ts` 新建；`tests/client-capability.spec.ts` 增补文件视图/注册表 pending/观察者签名；`tests/client-panel.spec.ts` 增补文件视图、缺失/截断/分页、窄入口、项目名匹配渲染。

## 明确未完成 / 剩余

- **跨会话持久 presented 读取**：本机 Host 的 `deliverables/presented` 是持久会话事件，但客户端没有跨任意 session 的公开读取服务（`sessions.list` 无该投影；`chatFileMentions` 需要已打开对话的 turn owner）。因此文件视图目前只显示真实项目文件并标“生成会话未确认”，presented 来源关闭并在界面明确提示；若后续 Host 暴露读取服务，可在 `files` 面新增来源，不改 UI 契约。
- 没有实现位置/复制/下载动作：当前 Host 未核验通用传输端点，不伪造。
- 文件分页是“目录为分页单位 + 每目录客户端偏移”；宿主单目录上限只显示截断提示，不能越过。
- 未运行 tests/tsc/build/Host；窄入口真实断点、Excel 原生预览、亮暗主题未做实际 UI 验收。

## 建议最小验证（未运行）

```bash
npx vitest run tests/client-files.spec.ts tests/client-capability.spec.ts tests/client-panel.spec.ts tests/client-status.spec.ts tests/client-styles.spec.ts
npx tsc -p tsconfig.json --noEmit
```
