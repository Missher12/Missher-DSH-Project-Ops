[project-ops-ready-v1]: <data:application/json;base64,eyJwbGFuSGFzaCI6IjRiMjcxZDFjYmMwMzQ2NDYyODg1NDAyZWU5OGFmYThkNDU0NjNmYmYwYTlkMDA4NzU3NTBkMzM1MGEyZjJmMWQiLCJyZXBvcnRIYXNoIjoiN2Y3NTkzZjk4NWUzZjAwM2Q4N2EzMGY2YzRjYmI1ZDA1NjgxNjI1NDkyMTE5OTU2MjVhNmEwNTczYTY2NTQ1OCIsInZlcmlmaWNhdGlvbiI6IuacqumqjOivge+8muacquaPkOS+m+WPr+aguOmqjOeahOWOn+eUnyBQcm9qZWN0IE9wcyDlm57miafvvJvpqozmlLbmloflrZfku4XkuLrkvJror53miqXlkYrjgIIiLCJib2R5SGFzaCI6ImZmMjg1YjgwZWFkNTc5ZDFmMTMxNDM5ZGI0NGIyNDU5OWUwYjkwZjk3NjFiODFlOWVhMTU4MTlhNzM4MWM2N2QifQ==>

# Project Ops · Project Ops 0.4.0：宽宿主兼容与公开配图 · 交付记录

任务：2026-10-14-wide-host-compat-5f76a32a7990cb98
会话：session-205c9d47-fe22-4d87-aef0-489b739f6656
关联方案修订：10
[查看方案](./PLAN.md)

本记录由当前开发会话显式提交；不是回复结束或命令退出自动判定。验收文字为会话报告，原生回执验证另列。文档生成不代表已发布、已安装或所有平台已通过。

## 实现

静态收尾与公开配图集成（零动态命令、零运行时改动）：(1) docs/images 现包含四张实际 JPEG——task-panel-0.4.0.jpg 与 plan-preview-0.4.0.jpg（1280×720，从交付截图目录复制，与原图字节一致），以及 task-panel.jpg 与 plan-preview.jpg（846×834 的 alpha.2 单行布局，从只读公开导出复制回 canonical，避免公开 README 引用断裂，字节一致）；无图像生成与像素修改。(2) README.md / README.zh.md 嵌入两张新图，图注写清宿主（官方 npm 0.2.1-alpha.5 Web）、方法（隔离合成 Profile、1280×720 亮色、无外部模型调用）与“不代表发布/安装/功能验收”；删除“配图待补”占位；状态段中性化并限定已核验范围。(3) docs/images/README.md 重写为当前图/历史图分列与图注规范。(4) docs/COMPATIBILITY.md 对齐真实证据：三宿主安装/运行/卸载与 14 项行为检查、官方 alpha.5 Web 真实加载证明、已执行结果段、归档白名单范围（不含隔离证据与学习数据）、必需接口缺失的激活差异与方法缺失的 doctor 指名错误、静态线索 vs 真实加载、合成探针 vs 真实模型/Electron；删去已被推翻的旧说法。(5) INSTALL.md 中性化。(6) PROJECT_CONTEXT.md / HANDOVER.md 追加 0.4.0 记录。

## 验收报告

- 运行时代码/lib/package/lock 保持不变；本轮只改文档与公开配图：reported-pass
  证据：本轮只写入 docs/images/*.jpg、README.md、README.zh.md、docs/images/README.md、docs/COMPATIBILITY.md、INSTALL.md、PROJECT_CONTEXT.md、HANDOVER.md 与任务文档；src/、lib/、package.json、lockfile 未动，未运行任何构建/测试/打包/CLI。
- 当前 DSH 两行任务行布局与既有交互不变（13px 标题、12px secondary 短状态、轻量方案/交付入口、warning 点、原生预览与定位、键盘与焦点行为、主题 token）：reported-pass
  证据：运行时文件未改；新截图正是该布局在官方 alpha.5 Web 的实际呈现：两行任务行、行内轻量方案/交付入口、提醒色只落在状态点、底部只读说明，四种状态齐备。
- 真实配图：仅复制实际截图到 docs/images，不改像素、不用生成图；保留公开历史图与公开导航：reported-pass
  证据：四张 JPEG 都用 cp -p 复制并逐一 sha256 比对与原图字节一致（新图 sha256 640a0ed9…/2f751a5a…，历史图 c8d73582…/91394f1a…）；无图像生成与像素修改；历史图文件名与公开 README 引用保持可解析。
- 文档中性且不过时：README/INSTALL 不写“未发布/仅旧版本可安装”类状态；兼容矩阵按真实证据写，不声称范围内所有版本已测：reported-pass
  证据：README 改为“当前源码版本 0.4.0 + 2026-10-17 三宿主隔离验收”并明写“已核验的只是这三个锚点，不是版本范围允许的全部版本”；INSTALL 指向交付记录与兼容矩阵，无过时发布状态语；“配图待补”“alpha.5 待验/无可用 fixture”等占位或已被推翻的说法已删除。
- 三个真实环境分列（社区 rc.2、社区 alpha.2、官方 npm alpha.5），社区为封装而非官方原包；官方 npm 行为证据来自其自身的 Profile 验收：reported-pass
  证据：COMPATIBILITY 三行表保留且社区行标为 Missher 社区桌面封装；新增段落写明三宿主固定候选包的安装/运行/卸载与 14 项行为检查均通过、官方 alpha.5 不带额外 patch，故该条为官方 npm 真实行为证据；隔离 profile 的具体临时目录未写入公开文档。
- 准确区分：整服务缺失时的激活差异 vs 服务在而方法缺失时的 doctor 指名错误；静态线索 vs 真实加载；合成探针 vs 真实模型/Electron：reported-pass
  证据：COMPATIBILITY 二节改写：必需项在 inject 里即激活条件，整服务缺失不激活；服务在而方法缺失时插件照常激活并由 doctor 与其他工具指名报错。静态接口面声明为“静态线索，非导出/服务证明，非行为运行”；新增段落明确验收骰合成工作区与固定探针、未调外部模型，Electron/Intel Mac 与真实模型轨迹仍未验证。
- PLAN/READY 与 PROJECT_CONTEXT/HANDOVER 记录已验收运行时、待复查的最终包/摘要、Git/Release/安装待办与未验证项：reported-pass
  证据：PLAN（修订 10）与 READY 记录已验收运行时（修复后回归 3 文件 13 项含 7 项真实 cordis）与未完成项；PROJECT_CONTEXT/HANDOVER 追加 0.4.0 段，写明最终打包与摘要、Git 根/Release/桌面安装、Electron/Mac、真实模型轨迹均未完成；预览候选 SHA 仅作预览记录，未称最终发布。
- 不得 Git 提交/push/tag/Release/日常安装；不改公开导出、旧冻结产物与共享 Host：reported-pass
  证据：本轮无 git 写操作、无安装、无发布；公开导出仅被读取（历史图），旧冻结产物、共享 Host 与日常状态均未修改。

## 原生回执验证

未验证：未提供可核验的原生 Project Ops 回执；验收文字仅为会话报告。

## 产物

- docs/images/task-panel-0.4.0.jpg（46566 bytes，1280×720，与交付原图字节一致 sha256 640a0ed9…）
- docs/images/plan-preview-0.4.0.jpg（65291 bytes，1280×720，字节一致 sha256 2f751a5a…）
- docs/images/task-panel.jpg、plan-preview.jpg（各 36664 / 59103 bytes，846×834，alpha.2 历史图，从公开导出复制回，字节一致）
- README.md、README.zh.md（嵌入实际配图 + 中性版本/验收叙述）
- docs/images/README.md、docs/COMPATIBILITY.md、INSTALL.md
- PROJECT_CONTEXT.md、HANDOVER.md（追加 0.4.0 记录）

## Git

未提交、未推送、未打 tag；HEAD 仍为 44fc988；旧冻结产物、公开导出与既有未提交工作全部保留。

## 发布

未发布；未推送；未打 tag。

## 安装

未安装任何 profile；本轮未运行 CLI 或浏览器；日常状态、共享 Host 与公开导出未受影响。

## 未完成项与限制

- 最终包尚未重新打包：加入公开配图后需重算摘要，因此本记录不包含最终 tgz 与 SHA；此前预览候选 da0b9ca4… 仅为预览记录，不是最终发布。
- Git 根提交/推送、Release 与桌面正式安装仍属根/桌面负责人。
- Electron / Intel Mac 原生交互与真实模型自主轨迹未验证。
- 已核验的只是三个锚点（社区 rc.2、社区 alpha.2、官方 npm alpha.5）；版本范围允许的其他版本未测。
- 此前的 114 项全量测试属历史记录，不作为本轮资源通过证据；本轮回归为修复后的 3 文件 13 项（含 7 项真实 cordis）。
- 官方类型依赖仍无法在本机沙箱安装，客户端保留经目标 Host 产物核验的窄声明；UI 契约在 alpha.5 上因 primitives 内联而将导出级校验标为静态不可验，该点已由真实 Web 加载证明。

## 使用与回退

本轮只新增/重写文档与图片（未改运行时文件），git 未提交：需要回退时按文件恢复至本轮前状态；公开导出、旧冻结产物与共享 Host 未被修改。
