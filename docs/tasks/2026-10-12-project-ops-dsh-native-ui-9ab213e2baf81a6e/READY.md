[project-ops-ready-v1]: <data:application/json;base64,eyJwbGFuSGFzaCI6ImVjNDY1Nzk3ZTIwMGNiYzQ3YjUyMGZkOWU3MzMxMmM0MDIzNjBiNmI1YzMyMjg0ZDQ3YzQ4ZjU1OWQyNzg1NmUiLCJyZXBvcnRIYXNoIjoiNTkxOWE2ZDU0ZWZmMTdjYjgxMWNmMjI1NThmZTU2NGIxYTVkYzg0YzljZTc1YWJhMmE0YTgyNThiOTQ2NjNkOCIsInZlcmlmaWNhdGlvbiI6IuWOn+eUn+WbnuaJp+mXqO+8mnN0YWxl77ybcGxhbkRpZ2VzdD0wNDBhZTk3ZGIxMjc0MGQxMjFiZDE2M2FkZjMxMTQ0MWEwNjE1NWIxZTE0ZjEwODMxMGY2YjA5NTQxMzQwMTU477yb5Y6f5ZugPW1pc3NpbmctcmVjZWlwdCx1bnN1Y2Nlc3NmdWwtcmVjZWlwdCxzb3VyY2Utc25hcHNob3QtdW5hdmFpbGFibGXjgILmraTnu5PmnpzmoLjpqozmlofmoaPlhpnlhaXliY3nmoTmupDnoIHlv6vnhafvvIzkuI3ku6Pooajlj5HluIPjgIHlronoo4XmiJblhbbku5blubPlj7DpgJrov4fjgIIiLCJib2R5SGFzaCI6IjZjMDE5NDY3NzhhNWYzZmY0YTM5ZGQ5YmIyZTRjNDI2MmMwMTQzMzk5YWI0NWMxOTdiNTU2OGJhNTRhNDVkYWMifQ==>

# Project Ops · Project Ops：DSH 原生风格界面修订（0.4.0-alpha.2） · 交付记录

任务：2026-10-12-project-ops-dsh-native-ui-9ab213e2baf81a6e
会话：session-205c9d47-fe22-4d87-aef0-489b739f6656
关联方案修订：4
[查看方案](./PLAN.md)

本记录由当前开发会话显式提交；不是回复结束或命令退出自动判定。验收文字为会话报告，原生回执验证另列。文档生成不代表已发布、已安装或所有平台已通过。

## 实现

把 Project Ops 标题栏面板从浏览器默认样式改为 DSH 原生风格（候选 0.4.0-alpha.2，主名 Project Ops 不变，未动 document-store/task-documents/document-tools/Jobs 等业务逻辑）。客户端：locales.ts、styles/project-ops.css（仅用本 Host 已定义的 --dsw-* token，无字面色值）、styles.ts（*.css?inline 文本 + 带 data-plugin 的 <style>，在 ctx.effect 内挂载/卸载，官方 ui-theme 交付方式）、task-view.ts（四态视图模型；关联当前/历史/未生成为中性点，仅待核对用 amber）、ProjectOpsPanel.tsx（无 hooks 表现层）、ProjectOpsAction.tsx（createPortal + 官方 useAnchoredPosition/useDismissOnOutsidePointer + Escape/Tab 桥接 + 焦点回触发器 + 保留可取消读取）、platform.d.ts（仅声明消费到的平台模块面，已写明为窄声明的兼容限制与替换条件）；index.tsx 为薄入口。构建：tsdown.config.ts 新增 ?inline 内联插件（虚拟 id 不含绝对路径）、平台表外部化与“bundle 只能 require 平台表行”门禁；package.json 加 check:ui 并升版；新增 scripts/check-ui-contract.mjs；package-inspection.mjs 对未本地安装的平台行改用文档化取代并回写 stubbedPlatformRows；smoke.mjs 修正两处过期断言；README/README.zh/docs/TASK_DOCUMENTS.md 同步。

## 验收报告

- 标题栏入口为原生轻量按钮：无浏览器默认凸边/硬编码白底黑框，正确高度与 hover/focus 状态，亮暗主题自动适配：reported-pass
  证据：入口为 <button class=po-trigger>：min-height:28px、border:0、background:transparent、var(--dsw-radius-sm)，hover/focus 仅用 --dsw-alias-label-* 与 --dsw-alias-interactive-bg-hover（均由官方主题在亮/暗两套定义），样式无字面色值；tests/client-panel.spec.ts 断言按钮类型、aria-expanded、aria-haspopup=dialog 与无障碍名。真实亮/暗截图未验证，待 Codex。
- 面板只使用本 Host 0.2.1-alpha.2 已定义的 --dsw-* token（经脚本校验），不引入未发布 Host 能力：reported-pass
  证据：node scripts/check-ui-contract.mjs（npm run check:ui）passed=true：样式读取的全部 --dsw-* 逐个对照已装官方 dsh-client-ui-theme 0.2.1-alpha.2 的定义集合，无缺失；官方未发布源码才有的 --dsw-alias-fill-l1/l2、--dsw-font-mono 等不使用；报告 .artifacts/ui-contract/report.json
- CSS 实际随候选包加载：lib/browser/client.js 内含样式文本，并在真实 Host 注入带 data-plugin 的 style 标签：unverified
  证据：包内已完成：bundle 含完整样式文本与 dataset.plugin 赋值，契约脚本断言 carriesStylesheet=true；真实 Host 注入未验证——dsh plugin add 在本会话报 ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK / Read-only file system（本仓 node_modules 链接自沙箱外只读 store），未装载到任何 Host。
- 面板开启时不被标题栏或右侧预览裁切，窄宽度可用且内容内滚动（官方 useAnchoredPosition 视口钳制）：unverified
  证据：未验证：源码已用官方 useAnchoredPosition 视口钳制 + createPortal 到 document.body，并声明 max-width/max-height 视口限制、overflow:hidden auto 与 480px 窄宽规则，但本会话无法启动真实 Host 浏览器实测（已按指示停止环境排障）。
- Escape 关闭、点击外部关闭、键盘可达、关闭后焦点回到触发器：unverified
  证据：未验证：已实现 Escape、Tab 桥接与关闭后 triggerRef.focus()，并使用官方 useDismissOnOutsidePointer；单元测试只覆盖面板 role/aria 与按钮结构，无浏览器键盘/指针行为回执。
- 任务行以中文标题为主，四种交付新鲜度状态简洁且不以成功色伪装验收；长目录 ID 降为次要/title，不以技术 ID 与告警抢占主体：reported-pass
  证据：本轮修正：deliveryView 的 current 由 done 绿点改为中性 idle 点，只有 inspect（待核对）保留 attention；断言改为 dots=['idle','idle','warning','idle'] 并显式断言不得包含 'done'；另断言中文标题为主、无标题时回退目录 ID、完整目录名只进 title/data-task、列表文本不含目录 ID；文案守卫 forbid 验收通过/已验收/已发布/已安装。
- 方案/交付操作有统一 hover/focus/disabled；未生成交付不可点；打开文件后面板收起并保留原生侧栏预览：unverified
  证据：未验证：两个动作共用 .po-action（统一 hover/focus-visible/disabled），测试断言 plan 可点、ready 禁用且禁用原因具名、点击将 (task,'READY.md') 交给预览打开器；但“打开后面板收起并保留原生侧栏预览”发生在 hooks 外壳与真实 sidebarRight，未经真实 Host 验证。
- 保留 AbortController 取消与最多四并发读取，刷新不产生请求竞争；加载/空/错误/截断四态仍在：unverified
  证据：未验证：加载/空/错误/截断四态已单元测试（role=status 骨架、空态文案、role=alert 含错误详情与重试、截断提示）；AbortController 取消与四并发上界仅保持 alpha.1 原实现未改动，本轮未新增专项并发测试，无回执。
- typecheck、vitest、build、包格式与声明检查全部通过：reported-pass
  证据：直接运行均退出码 0：npx tsc --noEmit；npx vitest run（16 文件 112 项，已按审查删去 4 项镜像实现型静态测试）；node scripts/build.mjs（lib/browser/client.js 36.26 kB）；npm run check:ui；inspectArchive(tgz, sha256)（18 条目）；check-declarations（strict/skipLibCheck=false）。另：经 Project Ops 任务运行器执行同一脚本时被沙箱拒绝（ERR_PNPM_LOCKFILE_WRITE_FILE，outcome=blocked 回执），未放宽沙箱。
- 未实测项（真实 Host 加载、浏览器可见行为、Intel Mac 原生、真实模型轨迹）在 READY 中明确标注未验证：reported-pass
  证据：本记录逐条标注：真实 Host 加载与浏览器可见行为（亮/暗、四态、两个预览、Escape/外部关闭、窄宽度）为 unverified；Intel Mac/Electron 原生、真实模型轨迹、发布与安装均在 limitations 中标为未验证。

## 原生回执验证

原生回执门：stale；planDigest=040ae97db12740d121bd163adf311441a06155b1e14f108310f6b09541340158；原因=missing-receipt,unsuccessful-receipt,source-snapshot-unavailable。此结果核验文档写入前的源码快照，不代表发布、安装或其他平台通过。

## 产物

- .artifacts/pack/missher-dsh-project-ops-0.4.0-alpha.2.tgz（63464 bytes，SHA-256 1d58e94f06c2f9f08faea45dfac141fe770ecc61343c179cda60668f5421b558，重打可复现）
- lib/browser/client.js（closure-factory，36300+ bytes，内联样式文本，仅 require 平台模块表行）
- .artifacts/ui-contract/report.json（token / 平台模块面 / 包内 CSS 契约，passed=true）
- .artifacts/r7-declarations/consumer-0W9lTx/report.json（公开声明消费者检查，strict / skipLibCheck=false）
- docs/tasks/2026-10-12-project-ops-dsh-native-ui-9ab213e2baf81a6e/PLAN.md

## Git

分支 codex/project-ops-task-documents-20261012；未提交、未推送。基线 44fc988f511f1d16f6b8ff29de03dacdc36aa58c、alpha.1 未提交工作树、旧候选 project-ops-delivery/verified 与旧 .artifacts 证据全部保留，未重置或覆盖。package.json / pnpm-lock.yaml / node_modules 经核实无半安装残留。

## 发布

未发布；未推送 Git。

## 安装

未安装日常 profile；日常 DSH/Media 未受影响。隔离 profile 安装本轮未完成（沙箱阻断），因此本候选尚未在任何 Host 真实加载。

## 未完成项与限制

- 官方类型开发依赖无法在本会话安装：本仓 node_modules 链接自 /home/missher/.local/share/pnpm/store (沙箱外只读)，pnpm add / pnpm install 在解析阶段即报 ERR_PNPM_LOCKFILE_WRITE_FILE 或 store lock EROFS；已按指示停止重试、未放宽沙箱。故 src/client/platform.d.ts 保留经过目标 Host 产物校验的窄声明（react-dom 与 ui-primitives），并在文件头写明替换条件；npm run check:ui 会在声明与已装产物漂移时报错。
- 真实 Host 加载与浏览器可见行为未验证（亮/暗截图、四态呈现、两个原生预览、Escape/点击外部关闭、窄宽度内滚动），交 Codex。
- npm run smoke:package 仍不可完成：已修正 bundle 名与 lib 子目录白名单两处过期断言，随后卡在同一 pnpm 沙箱错误。
- Project Ops 声明的 package:* 任务在本会话被 pnpm lockfile 写入拒绝阻断（outcome=blocked），未取得 passed 回执；证据为直接命令输出。
- 读取取消与四并发上界仅保持原实现，未新增专项测试。
- Intel Mac/Electron 原生、真实模型自主轨迹、Git 提交、发布与日常安装均未验证。

## 使用与回退

删除 .artifacts/pack/missher-dsh-project-ops-0.4.0-alpha.2.tgz 即撤回本轮候选（旧 SHA 05d00458 的 tgz 已被本轮修正候选取代）；源码可回到基线 44fc988 或保留 alpha.1 工作树（两者未改动）；旧候选 project-ops-delivery/verified 为不可变参考，不动。
