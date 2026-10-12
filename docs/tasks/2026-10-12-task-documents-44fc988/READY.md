# Project Ops · 候选交付记录

状态：独立业务候选交付完成；最终定制桌面组合、发布和日常安装待桌面负责人统一执行。

## 实现

- 同一仓库升级为 @missher/dsh-project-ops 0.4.0-alpha.1，主显示名 Project Ops。原有七工具保留，新增 document_read/document_write。
- 对齐官方 npm Host 0.2.1-alpha.2、Cordis 4.0.5-alpha.1；原生 Jobs 提升为后台时保留 jobId。
- 原生会话绑定的独立 PLAN/READY，原子版本守卫、沙箱策略、人工编辑保护、中断恢复、幂等与跨会话写入隔离。
- 当前/历史/待核对/未生成的可见状态，原生文件预览，未引用 Markdown 管理信息避免污染正文。
- 不增加模型调用、调度器、自动 Git 或 turn-end 完成推断。

## 源码与发布归属

基线 44fc988f511f1d16f6b8ff29de03dacdc36aa58c；当前分支 codex/project-ops-task-documents-20261012。未提交、未推送、未发布、未安装日常 profile。最终 Git/Release/安装归桌面负责人。源码留在本恢复仓库，全部原始验收材料保留在 .artifacts。

## 已验证与限制

99项测试（14文件）、类型检查、构建、git diff --check 通过。最终同包通过以下实际检查：

- 官方 npm Host 0.2.1-alpha.2 独立 Profile：正式安装→9工具加载→PLAN/READY实际落盘→原生任务与回执门→跨会话拒绝→后台收集/取消→前台promoted保留原生jobId→源码变化使回执过期→正式卸载后工具和提示消失。
- 主入口、Cordis入口、客户端入口从 tgz 提取声明的 strict / skipLibCheck=false 消费者检查通过。浏览器 closure-factory 格式实际执行检查通过。
- 官方 Web 真实浏览器点击：Project Ops 标题栏入口、当前关联/历史/待核对/未生成四种状态，未生成按钮禁用，PLAN和READY两个原生文件预览，隐藏管理信息，浮层在视口内且打开文件自动收起。
- 当前最终 Web Host 浏览器错误0；隔离安装8个lib文件逐字节匹配冻结包。未发起真实模型请求，不能据此宣称真实模型自主文档维护已验收。

最终定制桌面 Host 尚未冻结。桌面负责人已确认本候选不阻塞当前批次，公开 Host 冻结后统一组合检查。Intel Mac / Electron 原生、真实模型自主轨迹和日常升级未在本任务验收。

## 回退

正式安装只由桌面负责人完成并先保全日常数据。隔离测试使用单独 HOME、DSH_HOME 与合成工作区；停止本任务测试进程即可退出，不移除用户数据。源码基线、工作树、候选包及失败证据保留。

## 唯一冻结候选与证据

目录：`<local-delivery>/project-ops/verified/`

- 包：`missher-dsh-project-ops-0.4.0-alpha.1.tgz`，47132 bytes。
- SHA-256：`a22557c067c3e88c73593c0e7bcb32512600c19d8a201ee5a670d8b0c0f88dd4`。
- `profile-report.json`：原始证据 `.artifacts/official-compat/profile-AbDxQB/report.json`。
- `declarations-report.json`：原始证据 `.artifacts/r7-declarations/consumer-2arxgR/report.json`。
- `ui-report.json`、`ui-states.jpg`、`ui-plan.jpg`、`ui-ready.jpg`、`ui-ready.ax.txt` 与当前Host错误记录。
- `tests.log`、`typecheck.log`、`build.log`、`profile-verified.log`、`declarations-verified.log`。
- `source.tar.gz`、`baseline.bundle`、`source.patch`、`git-status.txt`、`source-files.sha256.json` 和 `SHA256SUMS` 是本轮冻结/回滚材料。源码快照包含全部本轮新增文件；Git未新增提交。

该目录之外的早期同版本 tgz 都是开发中间候选，禁止混用。正式安装前由桌面负责人核对本SHA及最终Host版本；不得用历史包/日志替代现存包。未读取桌面的私有 plugin-inputs-final，未改公共Host、日常profile或其他插件业务。

## 验收中修复及保留的失败事实

原生前台短命令也可能promoted，测试夹具现按原生job收集后判断结果；最初只要求立即succeeded的失败日志保留。客户端组件误导出导致消费端缺失slot类型扩展，已收回内部导出并通过三个入口检查。早期HTML注释在Host预览中被显示，现使用未引用Markdown链接定义，真实截图证明正文正常。

早期Web启动曾出现session-maybe适配器/会话服务未就绪错误，刷新后恢复；最终Host本次页面日志未见同类错误，但不能外推为所有冷启动环境均无竞态。最初测试消息使用不合要求的source，失败夹具与报告保留；最终v3使用原生user/message合法结构。旧开发格式文件保留并显示“待核对”，不做隐式迁移覆盖。
