<div align="center">

<h1>Project Ops · 项目与文件</h1>

<p><img src="../docs/images/cover-v2.png" alt="Project Ops · 项目工作区（品牌插画）" width="100%"></p>

<p>在会话旁查看项目方案、交付文件与搜索记录。</p>

<p>
  <a href="https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v1.0.3"><img src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-1.0.3-4D6BFE?style=flat-square" alt="版本: 1.0.3"></a>
  <a href="https://github.com/Missher12/Missher-DSH-Project-Ops"><img src="https://img.shields.io/badge/%E6%96%87%E6%A1%A3-%E4%B8%AD%E6%96%87-4D6BFE?style=flat-square" alt="文档: 中文"></a>
  <a href="https://github.com/Missher12/Missher-DSH-Project-Ops/blob/main/LICENSE"><img src="https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF-MIT-6B7280?style=flat-square" alt="许可: MIT"></a>
</p>

<p><a href="#功能一览">功能一览</a> · <a href="#快速开始">快速开始</a> · <a href="#visual-guide">图解使用</a> · <a href="#使用场景">使用场景</a> · <a href="#常见问题">常见问题</a> · <a href="#详细文档">详细文档</a> · <a href="../README.md">English</a></p>

</div>

---

<!-- current-source -->
当前开发源码：**1.0.3** · [分支 `main`](https://github.com/Missher12/Missher-DSH-Project-Ops/tree/main)。安装包以实际 Release 为准。
<!-- /current-source -->

## 功能一览

| 能做什么 | 说明 |
| --- | --- |
| **会话文件** | 按真实文件扩展名分类，查找本轮登记的文件。 |
| **原生预览** | 点击文件名，在 DSH 右侧栏中打开可用预览。 |
| **打开文件位置** | 在访达中定位实际文件，便于复制或拖放交付。 |
| **项目方案与搜索** | 查看项目方案、交付记录及本会话保留的搜索结果。 |

## 快速开始

1. 从 [Releases](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v1.0.3) 下载对应版本的 `.tgz` 安装包。
2. 在 DSH **插件 → 添加插件** 中选择下载的文件，安装并启用；按宿主提示重新加载或正常重启。
3. 打开会话标题栏的 **Project Ops / 项目方案与文件**，按分类浏览。

<!-- visual-guide -->
<a id="visual-guide"></a>

## 图解使用流程

围绕当前项目找文件、看内容，最后定位真正的交付物。

![Project Ops：四步使用流程](images/workflow-guide.svg)

[查看完整流程图](images/workflow-guide.svg)

| 步骤 | 怎样操作 | 需要留意 |
| --- | --- | --- |
| 1. 确认范围 | 在当前项目与会话中查看已登记的文件和产物。 | 面板以当前会话已登记文件为范围，其他文件先通过既有文件工具定位。 |
| 2. 找目标文件 | 通过文件名与实际扩展名分类定位内容。 | 名称相似时核对路径，不能用展示标题替代真实文件名。 |
| 3. 预览与搜索 | 点击文件名打开 DSH 右侧预览，查看项目方案和保留的搜索结果。 | 预览用于确认内容；是否能打开某种文件还取决于宿主能力。 |
| 4. 找到交付位置 | 需要继续使用时显示真实文件位置或打开所在目录。 | 交付时给出实际文件路径，未生成的文件不能只凭列表名称算完成。 |

### 试一次

> 找出当前项目本轮生成的方案和交付文件。先在右侧预览确认内容，再打开文件所在目录，列出可直接使用的实际路径。

使用后可以这样核对：

- 文件来自预期项目与当前会话范围。
- 右侧预览与实际磁盘文件对应。
- 已完成的交付物和仍未生成的文件分开说明。

### 使用与配置

| 项目 | 建议 |
| --- | --- |
| 项目范围 | 先确认工作目录和会话，避免把其他项目的结果当成本轮产物。 |
| 预览入口 | 点文件名查看正文；长文件与特殊格式沿用宿主预览能力。 |
| 路径与定位 | 展示真实路径，系统定位操作需要宿主相应能力。 |

<!-- existing-screenshots -->
### 界面示例

<table><tr><td><a href="../docs/images/task-panel-0.4.0.jpg"><img src="../docs/images/task-panel-0.4.0.jpg" alt="Project Ops task panel (0.4.0 historical screenshot)" width="100%"></a></td><td><a href="../docs/images/plan-preview-0.4.0.jpg"><img src="../docs/images/plan-preview-0.4.0.jpg" alt="PLAN.md opened by the Plan entry (0.4.0 historical screenshot)" width="100%"></a></td></tr></table>

<sub>来自项目已有文档；截图版本与验证范围见<a href="../README.md">原始说明</a>，点击可放大。</sub>
<!-- /existing-screenshots -->

两张图片是项目已有 0.4.0 界面：分别说明任务与文件入口、方案预览。用于理解工作路径，不把历史样式标作当前新截图。
<!-- /visual-guide -->

## 使用前了解

- 文件预览和定位使用宿主提供的能力；已移动或删除的文件会保留历史条目并给出提示。
- 交付记录与当前方案关联，不代表已经发布、安装或通过完整验收。

<!-- readme-expansion -->
## 使用场景

| 遇到的情况 | 怎样使用 |
| --- | --- |
| 想找到这轮对话实际生成或修改过的文件 | 按会话文件记录汇总，并按真实扩展名分类。 |
| 文档完成后要预览，再把实际文件交给别人 | 点击文件名打开宿主预览，在支持的桌面环境中定位文件，再复制或拖放。 |
| 项目较长，需要回看方案、交付记录和搜索线索 | 在同一面板查看计划文档与独立的会话搜索历史。 |

## 常见问题

<details>
<summary>为什么项目里的所有文件没有自动出现？</summary>

这里主要展示当前会话登记过的文件，不是完整项目磁盘扫描器。搜索结果也与已交付文件分开记录，不会互相冒充。

</details>

<details>
<summary>历史文件已移动或删除，为什么还在列表？</summary>

列表保留真实历史。打开前会检查可访问性，失效时显示错误，需要重新交付文件或使用正确位置。

</details>

<details>
<summary>所有格式都能直接预览吗？</summary>

预览由宿主处理，支持范围随格式和宿主能力变化。“打开文件位置”在 macOS 使用 Finder 的原生定位能力，其他环境按可用能力处理。

</details>

## 搭配使用

与 [Session Bridge](https://github.com/Missher12/Missher-DSH-Session-Bridge) 配合，可以先确定目标会话再查找文件；[Superagent](https://github.com/Missher12/Missher-DSH-Superagent) 的执行任务仍在它自己的真实项目目录中产生结果。

## 升级与数据

文件列表与搜索历史从宿主会话记录恢复，不会重新执行旧搜索。计划记录与最新方案关联只代表文档对应关系，不等于发布、安装或功能验收已经完成。
<!-- /readme-expansion -->

## 详细文档

[完整中文说明](../README.zh.md) · [项目原说明](../README.md) · [完整安装说明](../INSTALL.md) · [任务文档](../docs/TASK_DOCUMENTS.md) · [兼容范围](../docs/COMPATIBILITY.md) · [许可证](../LICENSE)

原有功能细节、配置、截图与验证记录保留在上述文档中，历史结论按其注明的版本理解。
