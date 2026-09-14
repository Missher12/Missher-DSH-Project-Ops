# Project Ops S2 官方兼容交接

## 结果与范围

2026-09-12：本地 0.3.1 兼容候选已完成。采用官方 Harness 0.1.5-rc.2 / @deepseek-ai/cordis 4.0.2，只修准确依赖、ToolCallId、JsonValue 类型来源，以及嵌套 additionalContexts/concludesTurn 转发。产品源码只修改 src/harness-host.ts 与 src/index.ts；任务核心、通用 Cordis 入口、工具数量和原生执行归属保持不变。

已按 R5 收敛：官方新版本优先交付桌面；本插件兼容则沿用，不为追版本扩展功能。本轮保留已经完成的 0.3.1 API 兼容候选，不启动下一功能切片、不追加调度或通用宿主适配。

## 来源与版本

- 独立仓库：Missher12/dsh-project-ops。
- 工作树：/Users/missher/Documents/ChatGPT/dsh-project-ops/.worktrees/official-compat-20260912。
- 分支：codex/project-ops-official-compat-20260912。
- 承接维护源：0.3.0 / 06849534c3352dd26b6fc2e38e9ef30e49fbf9ef。
- 最新公开插件：0.2.0；远端默认 HEAD f6f7d0117bf448c50b945afbf499e7bcac04ba9c，来自总指挥 2026-09-12 15:28:17 UTC 的 VERSION-AUDIT.json。
- 官方最新已发布：0.1.5-rc.2 / fb2c4b9e698e30edb738bca4cf0618587db7d203（候选发布、npm next）；npm latest 为较旧的 0.1.5-rc.1，未使用浮动 latest。
- 官方开发对照：master c291e7961a515f6d7af9304e7fd1d257929aef26；未切换到该开发提交。
- 共同 Desktop 参考：d1e8bd9c6d49f980405888099087f931ddd26d83；未使用其修改过的同版本构建包。
- 实际运行时取自精确公开 npm 包，完整依赖版本与 integrity 在 pnpm-lock.yaml。官方 SHA 用于源码对照，不宣称这些公开二进制由本任务从该 SHA 重建。
- CLI 公共包 dist integrity：sha512-8Xc8hCQHcIWRmTCVU/xZdp6/qMsWMeAd2ObChKDEsfhUPJFXx6H0lgeb1DxUMD86HZrrVN+1bCvn1ppjZ/fOxw==。
- 受测 CLI lib/bin.js SHA-256：0ff7f1d72c4e0cbe14001709c81e20a04b70464118a7f78568952988e28f2ac5。
- 锁文件 SHA-256：ef7499c36ab567da50650498452fb36f223fd6de002a8d7b893704a05bf40652；其中所有 dsh 包均为 0.1.5-rc.2，pnpm peers check 无问题。

原独立根、0.3.0 维护工作树和分发策略工作树均保留且干净。只在 Git 本地 info/exclude 追加了 /.worktrees/，没有修改旧工作树源码。没有改真实 ~/.dsh，没有替换真实安装，没有推送、tag 或 Release。

## 修改文件

- src/harness-host.ts、src/index.ts：官方类型来源；嵌套原生结果在回执投影前按顺序 deferContext，仅成功结果 concludeTurn，包含原生取消适配的转发。
- package.json、pnpm-lock.yaml：0.3.1 本地候选，官方精确依赖，新增 util-values 的 peer/dev 声明。旧锁文件曾保留不匹配的 0.1.1 间接 peers，已在本工作树独立依赖目录重新解析，无混用。
- tests/plugin.spec.ts、tests/package.spec.ts：成功和抛错子工具的控制元数据反例、调用 ID 与依赖版本。
- scripts/smoke-profile.mjs、scripts/fixtures/official-profile.mjs、tests/fixtures/official-profile.expected.json：官方 dsh Profile 的安装、实际激活/工具调用、卸载后再次启动检查；无密钥的模型可见工具结果投影样例。
- scripts/smoke.mjs：现有组件 smoke 的宿主版本与归档白名单同步；它不作为官方应用激活的唯一证据。
- .github/workflows/ci.yml：在已有流水线增加 Profile smoke；未运行平台 CI。
- README.md、README.zh.md、docs/CORDIS_INTEGRATION.md、docs/OFFICIAL_COMPAT.md、PROJECT_CONTEXT.md、本文件、SHA256SUMS、.agents/notes/2026-09-12-official-harness-015.md、.gitignore：接入、行为说明、证据与测试输出隔离。

## 实际验收

平台：macOS 15.7.4 Intel x64，Node v25.6.0，pnpm 11.7.0。

- pnpm run typecheck：通过。适配前曾精确复现 CallId 与 JsonValue 导出缺失。
- 定向 plugin/package：15/15 通过，包含成功转发上下文/结束标记及抛错后保留上下文、不结束回合的反例。
- pnpm test：8 文件，71/71 通过，包含原有 69 项；没有执行 Desktop 全量构建或测试。
- pnpm peers check：无问题。frozen-lockfile 检查通过。
- pnpm run build：通过，构建本插件双入口，没有构建官方宿主或 Desktop。
- pnpm run smoke:profile：通过，证据 .artifacts/official-compat/profile-ZxOZ3e/report.json。
- pnpm run smoke:package：通过；使用相同归档 SHA，属于补充组件/安装证据。
- git diff --check：通过；任务发现、规划、快照、回执核心和通用 Cordis 入口相对承接 SHA 无差异。

Profile 验收由官方 dsh CLI 启动 headless 派生的命名 Profile，仅禁用推理前端并在 appReady 后运行测试消费者。用官方 Agent 工厂创建真实 handles，不手动创建替代 Cordis 容器。实际覆盖七工具及提示激活、workspace 声明任务、门禁通过、嵌套元数据、原生策略拒绝、旧成功不能覆盖较新失败、后台等待、陌生 owner 拒绝、原生取消及真实生产者进程退出、官方 timedOut 标记、源码失效、CLI 卸载，以及第二次 Profile 启动时工具/服务/提示不存在。HOME 与 DSH_HOME 隔离，真实 home 顶层哈希哨兵未变化。

模型可见上下文投影与固定 JSON 比较；这是 keyless 工具结果样例，不是完整模型 Session 回放或真实模型推理验收。未重复未受影响的通用宿主检查。

## 产物

受测归档：dsh-project-ops-0.3.1.tgz，40,328 bytes。
SHA-256：9fed65a24615211a06867223fd6f5510f51e9f775522294ead3a1d7a8fbe98c9。
工作树根的同名包是从成功 Profile 验收目录复制的同一字节产物。完整报告、installed.json、removed.json 和命令日志保留在 .artifacts/official-compat/profile-ZxOZ3e/。
最终本地提交以本分支 git rev-parse HEAD 及交付回复为准；提交后的 DELIVERY.json 绑定完整提交、报告摘要和安装包摘要。

## 残留限制与后续

- 当前只证明精确官方 CLI/Profile 组合在 Intel macOS 可用；Windows、Ubuntu、其他 Node/宿主版本、实际桌面组合、交互审批 UI、完整 OS 沙箱对抗性检查和真实模型均未验收。由总指挥安排组合/平台验收，不宣称三平台桌面完成。
- 原有回执先看终止信号，因此 timedOut=true 且 signal=SIGTERM 的结果归为 aborted；本次严格检查发现该行为，最终验收分别断言官方超时事实与回执不能通过。没有通过改任务核心或削弱门禁来适配。若需要把超时与主动取消区分为独立摘要，应另列后续切片。
- 原有快照容量、输出目录排除、非原子扫描及激活期证据保留限制继续适用。卸载/重载不能伪造旧任务的新回执；原生 Jobs 继续负责生命周期。
- 没有需要修改官方核心才能完成本切片的阻断。保留候选，等待总指挥审查，不自行推进新功能、真实安装或发布。

## R7 验收工具交接（2026-09-13）

运行时与 canonical 包继续绑定 a08ce80def7876a82dc2b3e51cb653a81b1f846a，版本、40,328 bytes 和上述 SHA-256 不变。R7 后继提交只包含源码侧工具、测试及交接文档；其完整 SHA 由 .artifacts/r7/RELEASE-CANDIDATE.json 的 validationToolingSha 记录，不能替代受测归档的 sourceRuntimeSha。

问题：原 Profile 验收默认重新打包并解析开发依赖，无法明确消费最终组合选定的包和宿主。原因：没有固定归档和宿主输入。影响：开发验收无法直接绑定集成候选。推荐方案：显式传入归档/摘要、宿主 npm 项目、Node 和可选组合 patch，校验后再运行；已按此实现，不改产品源码或发行清单。

- scripts/package-inspection.mjs：核对 Bundle 与双入口声明、准确 peers、归档大小/摘要/白名单，拒绝缺失、重复及非普通文件。
- scripts/check-declarations.mjs：直接消费归档声明和所选宿主 peers，strict=true、skipLibCheck=false、NodeNext，含无效配置及不完整宿主接口的拒绝断言。
- scripts/smoke-profile.mjs、scripts/fixtures/official-profile.mjs：固定包不会重建，指定宿主失败不退回开发依赖；记录真实子进程 Node/平台/架构，保留原生闭环检查。
- tests/package-inspection.spec.ts：3/3 针对性测试通过，覆盖声明和归档反例；另已验证错误摘要在读取归档内容前被拒绝。
- docs/R7-CONSUMPTION.md、.agents/notes/2026-09-13-r7-consumption.md、PROJECT_CONTEXT.md、本文件：消费入口、来源与范围说明；不加入 npm 包。

严格声明报告：.artifacts/r7-declarations/consumer-JGXxjQ/report.json，TypeScript 6.0.3，Node v25.6.0。显式固定包 Profile 报告：.artifacts/official-compat/profile-U9wzs2/report.json，官方 Harness 0.1.5-rc.2、Cordis 4.0.2，Intel macOS 15.7.4；实际安装、七工具与指引、声明任务、门禁、后台 owner 检查、取消及进程退出、超时、过期回执、卸载后再次启动均通过。HOME/DSH_HOME 隔离，原 home 哨兵未变。git diff --check 通过；src、package.json、锁文件、构建配置及随包文档相对 S2 无差异，71 项产品测试和构建沿用 S2 证据。

本次显式宿主仍为本工作树内的精确官方 npm 运行时，未使用最终 Desktop 组合，没有传入组合 overlay。最终 Desktop SHA、运行时和 overlay 由总指挥提供后复验。Windows、Ubuntu、ARM、Electron UI、交互审批 UI、真实模型及最终 Desktop 组合均未新增验收；工具中 lockfileSha256 是验收工具工作树锁文件，不能证明外部 Desktop 的依赖来源。无待修插件源码阻断；原超时回执 aborted 等限制保持不变。没有推送、tag、Release 或更换日常安装。

## R7 P2：显式宿主的安装归属

ecedc69 局部复审发现 createRequire 会向祖先 node_modules 搜索，因而先前“指定无效宿主不回退”的实现不完整。两个入口现共用 scripts/selected-host.mjs：要求真实项目 JSON 对象和 node_modules 目录，逐包从此安装目录的明确链接读取 manifest，核对名称和准确版本；不使用祖先解析。pnpm 链接及显式安装目录链接可以指向外部真实存储。hostInstallation 记录逻辑安装锚点、真实路径与实际包 manifest；声明消费者目录及 CLI 启动均在必需包验证后创建。

修复前 tests/selected-host.spec.ts 的 6 个缺失/空宿主反例全失败，日志 .artifacts/r7-host-resolution/red.log。修复后两个入口各覆盖不存在目录、空目录、空安装、错误版本，另覆盖真实 pnpm 包链接、缺失兄弟依赖不可借用祖先和非法 manifest；宿主 10 项加既有归档 3 项共 13/13 通过，日志 .artifacts/r7-host-resolution/green.log。未重跑 71 项产品测试。

合法消费输入为 .artifacts/r7-host-resolution/selected-pnpm-project：单独项目 manifest 与显式包链接，链接目标是本工作树精确官方 pnpm 安装；这是明确安装投影，不是新安装的最终 Desktop。严格声明报告 .artifacts/r7-declarations/consumer-TmGBmH/report.json 通过；完整安装/调用/卸载报告 .artifacts/official-compat/profile-AcWcdE/report.json 通过。macOS Intel x64 / Node 25.6.0 的范围不变；extraPatch=null，原包摘要及 extraPatch 接线保持不变。

首次同输入 Profile 运行 profile-vilN8t 在首个声明任务处出现 failed/succeeded 断言失败，外层 failure.json 与 .artifacts/r7-host-resolution/profile.log 保留。诊断仅改该临时目录的断言信息与合成 Session ID；一次因旧 Session ID 已存在退出，更换诊断 ID 后安装阶段通过，记录 profile-diagnostic.json。随后使用未改动源码夹具的新 HOME/DSH_HOME 完整运行 profile-AcWcdE 通过；未调高超时或放松断言，首次失败根因未确定。vilN8t 的 installed.json 已是诊断结果，不作为原始通过证据。此现象不改变宿主 resolver 红绿证据，也不能被表述为已修复的产品故障。

P2 修复完整提交和新证据摘要写入 .artifacts/r7/RELEASE-CANDIDATE.json；此前 ecedc69 仅作历史工具来源，归档源码仍为 a08ce80def7876a82dc2b3e51cb653a81b1f846a。无推送、tag 或 Release。

## vilN8t 首次失败的证据缺口

追加只读核验：.artifacts/r7-first-profile/evidence.json 保存两次运行的文件摘要、解压 Session 行数及来源区分。首次工具为 missher_project_ops_task_run，任务 package@packages/app:verify；夹具与 macOS 适配推导嵌套 bash 执行 npm run 'verify'，原生工具结果未留存。已知的 1 是夹具断言后调用 appExit(1) 的外层 Profile 退出码，不能作为任务退出码。任务 exitCode、signal、timedOut 和原生首错文本均未知。首错仅在本会话先前读取输出中保留 receipt.outcome actual failed / expected succeeded（夹具第 70 行）；诊断覆盖了原 installed.json，当前文件不是该首错原件。

首次 Session 头记录实际项目 cwd 为 .artifacts/official-compat/profile-vilN8t/project；原生 workdir 由声明及适配推导为其 packages/app，未单独记录。失败日志确认外层 /usr/local/bin/node、v25.6.0；两次调用指定同一个 selected-pnpm-project 投影，但首轮未写出 hostInstallation、CLI 摘要和子 Node 版本，不能把成功运行的运行时记录追溯当成首轮记录。两次项目声明、verify.cjs、long.cjs、dump-config 和 cordis.yml 当前字节一致；成功夹具与提交源码一致，失败目录夹具只包含已知的诊断断言与 Session ID 改动。两轮 HOME/DSH_HOME、项目绝对路径、执行时间不同，失败目录还经历后续诊断；不存在同一初始环境的完整快照证明。

原始两份 Session zstd 文件各只有一条 session 头，没有工具结算；command-2.log 仅换行，没有 stdout/stderr；隔离 home 下没有 .npm 日志。failed 在现有映射中可来自一般工具错误、无 signal 的超时、sandbox runnerFailed 或非零退出码，单凭该摘要不能确定原因。没有证据可归因于环境抖动。本次未新增运行，避免把再次成功当作首次原因证明。此项保持具体未解决验证疑点：最终组合必须覆盖相同首个前台声明任务，并在断言前独立保存原生返回/错误、exitCode、signal、timedOut、workdir 和运行时身份；失败记录不得被诊断覆盖，不以重复到绿关闭疑点。产品与验收工具代码保持 1426fd8 不变。

## 最终组合的失败记录工具

后继仅修改验收工具：scripts/fixtures/probe-evidence.mjs 为每次激活创建独立 attempts/installed-* 或 removed-* 目录，所有记录以 wx 写入；原始 installed.json/removed.json 已存在时不再写入，新尝试单独保存 result.json。official-profile.mjs 在首任务之前安装原生 shell 观察包装，并记录每个工具返回或异常，后续元数据、门禁、后台取消、超时与文件检查在断言前已有独立证据。包装返回原值、重新抛出原异常，不改变执行和断言标准。smoke-profile.mjs 将 helper 一同复制到临时 Profile，启动前保存 selected-runtime.json，各命令单独保存 CLI 退出/信号/错误信息。没有增加产品 shell 入口或修改原包。

记录区分 Profile 实际 Node/执行文件/processCwd、选择的宿主、requestedWorkdir 和返回中的 workdir/cwd；没有的字段为 unavailable，保留真实 null/0/false。错误和文本内容为有界摘要，不读取环境变量或凭据。原生退出、信号、超时与工具回执分开，CLI exit=1 不能替代任务事实。

tests/fixtures/profile-evidence-failure.mjs 是合成宿主上的 instrumentation 夹具，通过真实子进程退出 7 后故意触发官方 probe 的断言，另覆盖原生抛错。tests/profile-evidence.spec.ts 证明返回证据先于断言落盘、异常缺失字段不伪造、复跑保留全部原文件、后续成功诊断也不能覆盖首次失败。初始 2 项反例失败；完成后 instrumentation 3 项和 selected-host 10 项共 13/13 通过。日志 .artifacts/r7-instrumentation/red.log、green-bounded.log；实际分次证据 .artifacts/r7-instrumentation/test-Y8vkJJ/。语法检查和 git diff --check 通过。

本轮按要求未跑 71 项产品测试、完整 Harness Profile、严格声明或最终 Desktop 组合。之前 profile-AcWcdE 是 1426fd8 工具的原生通过证据，不能当作新 instrumentation 的原生复验。新工具源码 SHA 由更新后的 RELEASE-CANDIDATE.json 绑定；归档仍为 a08 / 0.3.1 / 40,328 bytes / 9fed65a24615211a06867223fd6f5510f51e9f775522294ead3a1d7a8fbe98c9。vilN8t 原因仍未知，最终组合相同首前台声明任务是待验事项，不得据此声明原问题已修复。未推送、tag 或发布。
