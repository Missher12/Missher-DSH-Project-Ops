<div align="center">

<h1>Project Ops · 项目与文件</h1>

<p><img src="../docs/images/cover-v2.png" alt="Project Ops · 项目工作区（品牌插画）" width="100%"></p>

<p>在会话旁查看项目方案、交付文件与搜索记录。</p>

<p>
  <a href="https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v1.0.3"><img src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-1.0.3-4D6BFE?style=flat-square" alt="版本: 1.0.3"></a>
  <a href="https://github.com/Missher12/Missher-DSH-Project-Ops"><img src="https://img.shields.io/badge/%E6%96%87%E6%A1%A3-%E4%B8%AD%E6%96%87-4D6BFE?style=flat-square" alt="文档: 中文"></a>
  <a href="https://github.com/Missher12/Missher-DSH-Project-Ops/blob/main/LICENSE"><img src="https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF-MIT-6B7280?style=flat-square" alt="许可: MIT"></a>
</p>

<p><a href="#功能一览">功能一览</a> · <a href="#快速开始">快速开始</a> · <a href="#使用场景">使用场景</a> · <a href="#常见问题">常见问题</a> · <a href="#详细文档">详细文档</a> · <a href="../README.md">English</a></p>

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

<!-- existing-screenshots -->
## 界面示例

<table><tr><td><a href="../docs/images/task-panel-0.4.0.jpg"><img src="../docs/images/task-panel-0.4.0.jpg" alt="Project Ops task panel (0.4.0 historical screenshot)" width="100%"></a></td><td><a href="../docs/images/plan-preview-0.4.0.jpg"><img src="../docs/images/plan-preview-0.4.0.jpg" alt="PLAN.md opened by the Plan entry (0.4.0 historical screenshot)" width="100%"></a></td></tr></table>

<sub>来自项目已有文档；截图版本与验证范围见<a href="../README.md">原始说明</a>，点击可放大。</sub>
<!-- /existing-screenshots -->

## 快速开始

1. 从 [Releases](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/tag/v1.0.3) 下载对应版本的 `.tgz` 安装包。
2. 在 DSH **插件 → 添加插件** 中选择下载的文件，安装并启用；按宿主提示重新加载或正常重启。
3. 打开会话标题栏的 **Project Ops / 项目方案与文件**，按分类浏览。

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

## 第一次使用

1. 在一个已有文件记录的会话中，点击会话顶部的 Project Ops。
2. 用 Word、Excel、PDF、图片等分类筛选，点击文件名查看原生预览。
3. 需要交付时使用“打开文件位置”；查找之前用过的资料时切到搜索或方案区域。

### 一个具体例子

例如，让 Agent 完成一份表格并通过宿主文件工具登记后，先在面板预览结果，再在文件管理器中复制实际文件。只在回答里写出一个文件名，并不等于文件已经生成并登记。

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
