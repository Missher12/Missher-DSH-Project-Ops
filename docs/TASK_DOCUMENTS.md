# Project Ops 开发任务文档

包名为 `@missher/dsh-project-ops`，主名称为 **Project Ops**。“项目任务”仅作为中文说明。0.4.0-alpha.2 是独立候选，正式发布和日常安装由桌面负责人统一完成。

## 使用

真实且有一定规模的开发任务开始时，当前 Agent 调用 `missher_project_ops_document_read` 查找已有记录；没有对应任务时才调用 `missher_project_ops_document_write(action=begin)`。方案由当前会话提供，模板由插件生成，不额外调用模型。方案落盘后继续已授权开发，不要求用户再批准一次。普通问答与极小修改可以不生成文档。

每个任务写入工作区 `docs/tasks/<UTC日期>-<slug>-<身份摘要>/PLAN.md`。身份摘要来自真实 Host Session ID 与首次原生工具调用 ID。不同会话不能通过本插件修改其他会话的记录；同一会话可有多个独立任务。重启后读取原任务，再以返回的 `taskId` 和 `revision` 继续更新。新调用重试应传已有 taskId，不能再次 begin；同一原生创建调用重放是幂等的。

PLAN 数据字段为 `title`、`requirements`、`design`、`steps[]`、`acceptance[]`、`progress`。每次实质需求或进度变更通过 update 写入完整新值，并附 `expectedRevision`。遇到失败或取消时明确写 `status=failed|cancelled`，继续工作时显式恢复 active。工具退出或回复完成不会改变任务状态；插件不创建调度器、不订阅 turn-end 自动结案。

交付检查后调用 finish，提供 `implementation`、`checks[{criterion,status,evidence}]`、`artifacts[]`、`git`、`release`、`installation`、`limitations[]`、`rollback`。checks 必须与 PLAN 每条验收标准对应，状态为 `reported-pass`、`failed` 或 `unverified`。这些正文是当前会话报告，不能当作插件独立证明。可附原有 verification_gate 的完整参数；插件会用当前激活期的真实回执与源码快照复核，缺失证据明确未验证。不会为写文档重复运行测试。

finish 生成 READY.md 后将 PLAN 标记为 reviewed（已经过交付记录检查），不会自动标“所有事项完成”。原生回执门只反映写交付文档前的源码快照；之后的代码修改仍需重新验证。Git、发布、安装、原生平台和真实模型结果必须分别记录。插件不会提交、推送、发布或安装。

## 界面入口

在加载了插件客户端的 DSH Web / Desktop 会话标题栏，点击 **Project Ops**，可浏览当前项目的任务目录，并通过“查看方案 / 查看交付”打开原生文件预览。未生成 READY 时按钮禁用；空目录显示使用提示，读取错误明确展示。交付文件可能是历史记录，请核对 PLAN 当前状态和关联修订。其他会话的文档可以按 Host 工作区文件权限查看，但不能冒充原会话续写。

## 文件保护与恢复

所有读写经过 Host `fs`、`fs/observed`、`fs/write-intent`、会话 sandboxPolicy 和原子 createIfAbsent / replaceIfVersion，外层工具仍受原生工具权限与取消约束。只操作上述固定任务目录，拒绝符号链接、路径穿越、非普通文件和超限数据。根 README、READY、AGENTS 不属于写入范围。

PLAN 保存完整管理状态及正文摘要。人工修改或版本冲突会报错并保留文件，不静默覆盖；先比对人工改动与管理状态，在原会话中明确整理后再继续。不要手工编辑隐藏元数据。机器写入与其他写入的竞争由 Host 文件版本守卫拒绝，进程内同时写同任务也会被拒绝。每个文件上限 128 KiB，任务列表最多 1000 项；UI 最多展示 100 项。

READY 先落盘，PLAN 最后提交关联摘要。若在这两步之间中断，PLAN 不会假称已交付；重启后相同报告仅在 READY 管理信息、正文与原 PLAN 完全匹配时复用并完成提交。READY 被人工改动、报告变更或 PLAN 修订不一致时停下并保留现场。已检查的旧 READY 在任务继续开发时保留作历史记录，当前工具结果不再将它标为有效交付。

权限拒绝、真实文件系统错误和取消可能使调用返回错误；若原子写入已经提交但响应尚未返回，应先 read 查看事实再重试，不能把错误推断为“磁盘一定没写”。不同文件不是一个跨文件事务，不宣称崩溃时同时提交；恢复依赖上述关联校验。

## 界面状态与交付重试

入口只读检查 PLAN 正文和 READY 摘要关联，区分当前关联、历史、待核对、未生成；“当前关联”不代表验收通过。人工修改或读取失败显示待核对，其余任务仍可查看。最多显示100项、4个并发读取工作单元，刷新后取新状态。

finish 只将前一修订的相同报告认作刚完成提交的重试；基于当前修订提交新验证会生成新记录，更旧修订拒绝。中断后的 READY-first 提交仍保留当时验证事实。
