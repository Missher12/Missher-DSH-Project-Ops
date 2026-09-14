# Project Ops 安装 / Installation

适用版本：Project Ops 0.3.1，官方 Harness 0.1.5-rc.2，Cordis 4.0.2，Node ^22.19.0 或 >=24。安装目标为当前应用使用的 canonical web Profile；Desktop 的派生 desktop-base 不应直接编辑。

## 一句话交给 Agent

请按照 https://github.com/Missher12/dsh-project-ops 的 INSTALL.md，在我当前使用的 Harness 中安装 Project Ops，核对版本并调用 missher_project_ops_doctor 确认加载。

Ask the current Harness Agent to install this repository's fixed release, select the actual host/profile and verify missher_project_ops_doctor.

## 一条命令 / One command

```sh
dsh plugin --profile web add https://github.com/Missher12/dsh-project-ops/releases/download/v0.3.1/dsh-project-ops-0.3.1.tgz
```

该命令需要目标 Harness 的 CLI。Desktop 用户应由 Agent 选择当前已安装应用内置的 CLI 和运行时；不要安装另一份 Harness 来代替目标应用。安装已有插件前停止目标宿主；不要改变真实 DSH_HOME 或覆盖其他 Profile。下载来源和 SHA-256 见 Release 的 SHA256SUMS。

The command requires the target Harness CLI. For Desktop, select its bundled runtime and CLI. Stop the target host before modifying its installed profile; preserve data and unrelated plugins. Verify the release checksum.

重启同一宿主，确认插件安装列表显示 dsh-project-ops，再调用 missher_project_ops_doctor。它应报告当前宿主实际提供的能力；缺少 shell/background/cancellation 能力时如实处理，不能把已安装当作所有执行能力可用。下一步工作流见 docs/AGENT_USAGE.md。本插件的主要入口是工具和 Jobs，没有独立设置面板。

Restart the same host, inspect the installed entry and call missher_project_ops_doctor. The plugin exposes tools and uses Harness Jobs; it has no standalone settings panel. See docs/AGENT_USAGE.md for the declared-task workflow.

## 卸载 / Uninstall

```sh
dsh plugin --profile web remove dsh-project-ops
```

重启目标宿主，核对仅移除本插件。已有项目、会话、任务结果与其他插件保持原样。

Restart and confirm only this plugin was removed. Preserve existing projects, sessions, task results and other plugins.
