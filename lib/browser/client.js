window.__ModuleLoader__.load({
	id: "@missher/dsh-project-ops",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region node_modules/.pnpm/@deepseek-ai+dsh-util-workspace-path@0.2.1-alpha.2_@deepseek-ai+cordis@4.0.5-alpha.1/node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js
		/**
		* The `dsh-resource://file/…` address grammar: how a file is named across the
		* Sidebar and the resource model, built and parsed without touching a
		* filesystem.
		* @module
		*/
		/** The scheme and type every file address opens with. */
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
		function encodeSegment(segment) {
			return encodeURIComponent(segment).replace(/%3A/gi, ":");
		}
		/** Encode a `/`-separated path segment by segment. */
		function encodePath(path) {
			return path.split("/").map(encodeSegment).join("/");
		}
		/**
		* Build the address of a file read through one Session.
		* @param sessionId - the Session whose Host workspace resolves the path.
		* @param path - absolute or workspace-relative path; backslashes are normalized to `/`, and leading `./` prefixes are dropped.
		* @returns the `dsh-resource://file/session/<sessionId>/<path>` address.
		*/
		function sessionFileAddress(sessionId, path) {
			const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
		}
		//#endregion
		//#region src/client/document-status.ts
		async function documentStatus(id, plan, ready) {
			const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
			try {
				if (!plan || new TextEncoder().encode(plan).length > 131072) return { delivery: "inspect" };
				const match = /^\[project-ops-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>\n\n/u.exec(plan);
				if (!match) return { delivery: "inspect" };
				const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))));
				const record = metadata.record;
				if (record?.format !== 1 || record.taskId !== id || typeof record.plan?.title !== "string" || record.plan.title.length > 16e3 || metadata.bodyHash !== await hash(plan.slice(match[0].length))) return { delivery: "inspect" };
				const title = record.plan.title;
				if (ready === void 0) return {
					title,
					delivery: record.delivery ? "inspect" : "missing"
				};
				if (new TextEncoder().encode(ready).length > 131072) return {
					title,
					delivery: "inspect"
				};
				const readyHash = await hash(ready);
				return {
					title,
					delivery: record.delivery?.readyHash === readyHash ? "current" : !record.delivery && record.previousReadyHash === readyHash ? "historical" : "inspect"
				};
			} catch {
				return { delivery: "inspect" };
			}
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* `projectOps` namespace dictionaries for the session-header task browser.
		*
		* Wording rule: a delivery record that is linked to the current plan revision
		* is reported as a link, never as an acceptance or a release. The panel says
		* what the files are, not what the task achieved.
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "projectOps";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"title": "Project Ops",
			"trigger.label": "Project Ops",
			"trigger.aria": "项目任务与交付记录：{count} 项",
			"trigger.ariaEmpty": "项目任务与交付记录",
			"refresh": "刷新",
			"close": "关闭",
			"count": "{count} 项",
			"hint": "交付记录只保留历史事实；文件存在不代表已发布或安装。",
			"loading": "正在读取项目任务…",
			"empty": "尚无开发任务。向当前会话说明开发需求后，Agent 会按任务规模维护方案与交付记录。",
			"error": "无法读取项目任务",
			"errorDetail": "读取失败，未修改任何文件：{error}",
			"retry": "重试",
			"truncated": "任务较多，仅显示最近 100 项。",
			"status.current": "交付关联当前方案",
			"status.currentHint": "仅表示交付记录与当前方案修订一致，不代表验收通过。",
			"status.historical": "历史交付：方案已更新",
			"status.historicalHint": "交付记录对应更早的方案修订，保留为历史事实。",
			"status.inspect": "待核对：可能已编辑或中断",
			"status.inspectHint": "记录无法校验完整关联，请自行核对内容。",
			"status.missing": "尚未生成交付",
			"status.missingHint": "方案已存在，尚无交付记录。",
			"view.plan": "查看方案",
			"view.ready": "查看交付",
			"view.missingPlan": "尚未生成方案",
			"view.missingReady": "尚未生成交付记录",
			"notice.caption": "只读提示"
		};
		/** English dictionary; the key set must match {@link zh}. */
		const en = {
			"title": "Project Ops",
			"trigger.label": "Project Ops",
			"trigger.aria": "Project tasks and delivery records: {count}",
			"trigger.ariaEmpty": "Project tasks and delivery records",
			"refresh": "Refresh",
			"close": "Close",
			"count": "{count}",
			"hint": "Delivery records keep historical facts; a file does not mean released or installed.",
			"loading": "Loading project tasks…",
			"empty": "No development tasks yet. Describe your development request in this session; the agent maintains documents when the task warrants them.",
			"error": "Could not read project tasks",
			"errorDetail": "Read failed, no file was changed: {error}",
			"retry": "Retry",
			"truncated": "Showing the 100 most recent tasks.",
			"status.current": "Delivery linked to current plan",
			"status.currentHint": "The delivery record matches the current plan revision; that is not an acceptance.",
			"status.historical": "Historical delivery: plan updated",
			"status.historicalHint": "The delivery record belongs to an earlier plan revision and stays as history.",
			"status.inspect": "Review needed: edited or interrupted",
			"status.inspectHint": "The record cannot be fully linked; check its contents yourself.",
			"status.missing": "No delivery yet",
			"status.missingHint": "A plan exists, no delivery record yet.",
			"view.plan": "View plan",
			"view.ready": "View delivery",
			"view.missingPlan": "No plan yet",
			"view.missingReady": "No delivery record yet",
			"notice.caption": "Read-only hint"
		};
		//#endregion
		//#region \0project-ops-css:project-ops.css.1.mjs
		var _project_ops_css_project_ops_css_1_default = "/*\n * Project Ops session-header panel.\n *\n * Every token below is defined by the official theme of the target Host\n * (`@deepseek-ai/dsh-client-ui-theme`, 0.2.1-alpha.2); none is a token that\n * only exists in unpublished sources. Light and dark themes are inherited\n * automatically, so this file declares no color of its own.\n *\n * Class names are namespaced (`po-`) because the sheet is injected globally:\n * the closure-factory channel delivers CSS as text, not through a CSS-Modules\n * class map.\n */\n\n/* Header action seat: in flow, never a zero-size overlay. */\n.po-root {\n  display: inline-flex;\n  min-width: 0;\n}\n\n/*\n * Trigger: the native session-header action shape — transparent, borderless,\n * 28px tall, tertiary label that lifts to secondary on hover/focus. No\n * `background: Canvas` and no default button bevel.\n */\n.po-trigger {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  min-height: 28px;\n  padding: 3px 6px;\n  border: 0;\n  border-radius: var(--dsw-radius-sm);\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  font-family: var(--dsw-font-family);\n  font-size: var(--dsw-font-xxs-12-font-size);\n  line-height: var(--dsw-font-xxs-12-line-height);\n  cursor: pointer;\n}\n\n.po-trigger:hover,\n.po-trigger:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.po-trigger[aria-expanded='true'] {\n  color: var(--dsw-alias-label-primary);\n}\n\n.po-trigger-icon {\n  flex: none;\n}\n\n.po-trigger-label {\n  white-space: nowrap;\n}\n\n.po-trigger-chevron {\n  flex: none;\n  transition: transform 120ms ease;\n}\n\n.po-trigger-chevron-open {\n  transform: rotate(180deg);\n}\n\n/*\n * Panel: portaled to the document body and fixed in the viewport, with\n * coordinates supplied inline by the shared anchored-position hook. The\n * z-index sits above the right sidebar (at most 40) and below modal overlays\n * (1000), matching the official header popovers.\n */\n.po-menu {\n  position: fixed;\n  z-index: 100;\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  width: 420px;\n  max-width: min(440px, calc(100vw - 24px));\n  max-height: min(520px, calc(100vh - 140px));\n  padding: 3px;\n  overflow: hidden auto;\n  border: 0;\n  border-radius: var(--dsw-radius-lg);\n  background: var(--dsw-specific-menu);\n  backdrop-filter: var(--dsw-menu-backdrop-filter);\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-family);\n  font-size: var(--dsw-font-xxs-12-font-size);\n  line-height: var(--dsw-font-xxs-12-line-height);\n  box-shadow: var(--dsw-elevation-prominent);\n  /* Soften the elevation stroke the way the official menus do, and keep the\n     shell's own scrollbar variables on the panel surface. */\n  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);\n  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);\n  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);\n}\n\n.po-menu:focus {\n  outline: none;\n}\n\n/* Compact title line with the two panel actions on the trailing edge. */\n.po-header {\n  display: flex;\n  flex: none;\n  align-items: center;\n  gap: 6px;\n  padding: 5px 3px 4px 8px;\n}\n\n.po-header-title {\n  flex: none;\n  color: var(--dsw-alias-label-primary);\n  font-size: var(--dsw-font-xxs-strong-12-font-size);\n  font-weight: var(--dsw-font-xxs-strong-12-font-weight);\n  line-height: var(--dsw-font-xxs-strong-12-line-height);\n}\n\n.po-header-count {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 16px;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n.po-icon-button {\n  display: inline-flex;\n  flex: none;\n  align-items: center;\n  justify-content: center;\n  width: 22px;\n  height: 22px;\n  padding: 0;\n  border: 0;\n  border-radius: var(--dsw-radius-xs);\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  cursor: pointer;\n}\n\n.po-icon-button:hover,\n.po-icon-button:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.po-icon-button:active {\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n.po-icon-button:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n.po-icon-button:disabled:hover {\n  background: transparent;\n}\n\n/* The refresh affordance while a read is in flight. */\n.po-spin {\n  animation: po-spin 900ms linear infinite;\n}\n\n@keyframes po-spin {\n  from { transform: rotate(0deg); }\n  to { transform: rotate(360deg); }\n}\n\n/* One short line carrying the read-only meaning of the whole panel. */\n.po-hint {\n  flex: none;\n  margin: 0 8px 5px;\n  color: var(--dsw-alias-label-caption);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 16px;\n}\n\n/* Loading / empty / error / truncated states share one geometry. */\n.po-notice {\n  display: flex;\n  align-items: flex-start;\n  gap: 6px;\n  padding: 8px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 17px;\n}\n\n.po-notice-error {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.po-notice-action {\n  flex: none;\n}\n\n.po-skeleton {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 8px;\n}\n\n.po-skeleton-line {\n  height: 10px;\n  border-radius: var(--dsw-radius-xs);\n  background: var(--dsw-alias-bg-skeleton);\n}\n\n.po-skeleton-line-short {\n  width: 45%;\n}\n\n.po-list {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n\n/*\n * Task card: the hover wash rides the whole row so the trailing actions stay\n * inside it, and the inner content stays transparent to avoid stacked washes.\n */\n.po-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  box-sizing: border-box;\n  min-height: 28px;\n  padding: 5px 5px 5px 8px;\n  border-radius: var(--dsw-radius-sm);\n}\n\n.po-row:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.po-row-dot {\n  flex: none;\n}\n\n.po-row-main {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: 1px;\n  min-width: 0;\n}\n\n/* Chinese task title first, delivery state beside it. */\n.po-row-primary {\n  display: flex;\n  align-items: baseline;\n  gap: 6px;\n  min-width: 0;\n}\n\n.po-row-title {\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-primary);\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n/* Directory id: the row's `title` carries it in full; it is only shown when no\n   readable title identified the task. */\n.po-row-id {\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n.po-row-status {\n  display: inline-flex;\n  flex: none;\n  align-items: center;\n  max-width: 60%;\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 16px;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n.po-row-status-warn {\n  color: var(--dsw-alias-state-warn-primary);\n}\n\n.po-row-actions {\n  display: flex;\n  flex: none;\n  gap: 4px;\n}\n\n/*\n * Row actions: one geometry and one state set for both buttons. Disabled means\n * \"this document was never generated\": no hover, no hand cursor, dimmed label.\n */\n.po-action {\n  display: inline-flex;\n  align-items: center;\n  height: 24px;\n  padding: 0 8px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-xs);\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font-family: inherit;\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 16px;\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.po-action:hover:not(:disabled),\n.po-action:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n\n.po-action:disabled {\n  border-color: transparent;\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n/* Narrow shells: the panel keeps the viewport margin and the rows stay legible\n   by letting the actions drop under the title instead of clipping. */\n@media (max-width: 480px) {\n  .po-menu {\n    width: calc(100vw - 24px);\n    max-width: calc(100vw - 24px);\n  }\n\n  .po-row {\n    flex-wrap: wrap;\n  }\n\n  .po-row-actions {\n    width: 100%;\n    justify-content: flex-end;\n  }\n}\n";
		//#endregion
		//#region src/client/styles.ts
		/** Package id stamped on the injected tag and on the registry row. */
		const PLUGIN_ID = "@missher/dsh-project-ops";
		/** Compiled sheet text inlined into the client bundle by the build. */
		const PROJECT_OPS_CSS = _project_ops_css_project_ops_css_1_default;
		/**
		* Class names of the sheet. Declared once here so a component reference and
		* the stylesheet cannot drift apart unnoticed: `tests/client-styles.spec.ts`
		* reads the stylesheet and fails on any name that the sheet does not define.
		*/
		const styles = {
			root: "po-root",
			trigger: "po-trigger",
			triggerIcon: "po-trigger-icon",
			triggerLabel: "po-trigger-label",
			triggerChevron: "po-trigger-chevron",
			triggerChevronOpen: "po-trigger-chevron-open",
			menu: "po-menu",
			header: "po-header",
			headerTitle: "po-header-title",
			headerCount: "po-header-count",
			iconButton: "po-icon-button",
			spin: "po-spin",
			hint: "po-hint",
			notice: "po-notice",
			noticeError: "po-notice-error",
			noticeAction: "po-notice-action",
			skeleton: "po-skeleton",
			skeletonLine: "po-skeleton-line",
			skeletonLineShort: "po-skeleton-line-short",
			list: "po-list",
			row: "po-row",
			rowDot: "po-row-dot",
			rowMain: "po-row-main",
			rowPrimary: "po-row-primary",
			rowTitle: "po-row-title",
			rowId: "po-row-id",
			rowStatus: "po-row-status",
			rowStatusWarn: "po-row-status-warn",
			rowActions: "po-row-actions",
			action: "po-action"
		};
		Object.values(styles);
		/** Join conditional class names without pulling a `clsx`-style dependency. */
		function classNames(...values) {
			return values.filter((value) => typeof value === "string" && value.length > 0).join(" ");
		}
		/**
		* Mount the panel stylesheet for the owning plugin lifetime.
		* @param ctx - client root context.
		*/
		function installStyles(ctx) {
			if (typeof document === "undefined") return;
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = PLUGIN_ID;
				tag.dataset.pluginCss = `${PLUGIN_ID}/project-ops.css`;
				tag.textContent = PROJECT_OPS_CSS;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "project-ops: stylesheet");
		}
		//#endregion
		//#region src/client/task-view.ts
		/**
		* Dot state of every delivery freshness: neutral for the three states that are
		* plain metadata (linked, historical, not generated) and attention-amber for
		* the one state that asks the human to look. `done` is deliberately unused —
		* a linked delivery record is not an accepted, released or installed task.
		*/
		const DELIVERY_DOTS = {
			current: "idle",
			historical: "idle",
			inspect: "warning",
			missing: "idle"
		};
		/**
		* Map delivery freshness to the panel's label, hint and dot.
		*
		* `current` means only "this delivery record matches the current plan revision".
		* It is neither named nor colored as a success: the panel never upgrades a file
		* link into an acceptance, so the dot stays neutral and the amber attention
		* color is reserved for a record the human has to check.
		* @param state - freshness computed from the plan metadata and the ready hash.
		* @returns the row's copy keys and dot state.
		*/
		function deliveryView(state) {
			const dot = DELIVERY_DOTS[state];
			switch (state) {
				case "current": return {
					statusKey: "status.current",
					hintKey: "status.currentHint",
					dot,
					attention: false
				};
				case "historical": return {
					statusKey: "status.historical",
					hintKey: "status.historicalHint",
					dot,
					attention: false
				};
				case "inspect": return {
					statusKey: "status.inspect",
					hintKey: "status.inspectHint",
					dot,
					attention: true
				};
				case "missing": return {
					statusKey: "status.missing",
					hintKey: "status.missingHint",
					dot,
					attention: false
				};
			}
		}
		/**
		* Resolve one task row.
		* @param task - discovered task with document presence.
		* @returns the row's text, dot and action availability.
		*/
		function taskView(task) {
			const view = deliveryView(task.delivery);
			const hasTitle = task.title !== void 0 && task.title.trim().length > 0;
			return {
				id: task.id,
				title: hasTitle ? task.title.trim() : task.id,
				hasTitle,
				status: view.statusKey,
				hint: view.hintKey,
				dot: view.dot,
				attention: view.attention,
				planDisabled: !task.plan,
				readyDisabled: !task.ready
			};
		}
		//#endregion
		//#region src/client/ProjectOpsPanel.tsx
		/**
		* Session-header entry: a native 28px action button, not a browser default
		* button with a white face and a bevel.
		* @param props - locale, open state, optional count, anchor ref and toggle.
		* @returns the trigger button.
		*/
		function ProjectOpsTrigger({ t, open, count, triggerRef, onToggle }) {
			const label = count === void 0 ? t("trigger.ariaEmpty") : t("trigger.aria", { count });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				ref: triggerRef,
				type: "button",
				className: styles.trigger,
				"aria-expanded": open,
				"aria-haspopup": "dialog",
				"aria-label": label,
				title: label,
				onClick: onToggle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChecklistOutlineRegular, {
						size: 14,
						className: styles.triggerIcon
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: styles.triggerLabel,
						children: t("trigger.label")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
						size: 12,
						className: classNames(styles.triggerChevron, open && styles.triggerChevronOpen)
					})
				]
			});
		}
		/**
		* One task: Chinese title first, delivery state beside it, the directory id in
		* the row's `title` (and as the primary line only when no title was readable),
		* and the two document actions on the trailing edge.
		* @param props - locale, discovered task and the preview opener.
		* @returns the list item.
		*/
		function ProjectOpsRow({ t, task, onOpen }) {
			const view = taskView(task);
			const statusHint = t(view.hint);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: styles.row,
				title: `${task.id} · ${statusHint}`,
				"data-task": task.id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: view.dot,
						className: styles.rowDot
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: styles.rowMain,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.rowPrimary,
							children: [view.hasTitle ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.rowTitle,
								children: view.title
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.rowId,
								children: view.id
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classNames(styles.rowStatus, view.attention && styles.rowStatusWarn),
								children: t(view.status)
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.rowActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles.action,
							disabled: view.planDisabled,
							title: view.planDisabled ? t("view.missingPlan") : `${t("view.plan")} · ${task.id}/PLAN.md`,
							onClick: () => {
								onOpen(task.id, "PLAN.md");
							},
							children: t("view.plan")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles.action,
							disabled: view.readyDisabled,
							title: view.readyDisabled ? t("view.missingReady") : `${t("view.ready")} · ${task.id}/READY.md`,
							onClick: () => {
								onOpen(task.id, "READY.md");
							},
							children: t("view.ready")
						})]
					})
				]
			});
		}
		/**
		* The panel surface: compact title line with refresh/close, one short read-only
		* hint, then the loading, empty, error, truncated or task-list body.
		* @param props - locale, placement, read state and the panel actions.
		* @returns the portaled panel, or `null` while closed.
		*/
		function ProjectOpsPanel(props) {
			const { t, open, position, measureStyle, panelRef, result, error, busy, onRefresh, onClose, onOpen } = props;
			if (!open) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: panelRef,
				className: styles.menu,
				style: position ?? measureStyle,
				role: "dialog",
				"aria-label": t("title"),
				tabIndex: -1,
				"aria-busy": busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: styles.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.headerTitle,
								children: t("title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.headerCount,
								children: result === void 0 ? "" : t("count", { count: result.tasks.length })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: styles.iconButton,
								"aria-label": t("refresh"),
								title: t("refresh"),
								onClick: onRefresh,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {
									size: 14,
									className: busy ? styles.spin : void 0
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: styles.iconButton,
								"aria-label": t("close"),
								title: t("close"),
								onClick: onClose,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 14 })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.hint,
						children: t("hint")
					}),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classNames(styles.notice, styles.noticeError),
						role: "alert",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconInspectOutlineRegular, { size: 14 }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("errorDetail", { error }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: classNames(styles.action, styles.noticeAction),
								onClick: onRefresh,
								children: t("retry")
							})
						]
					}) : null,
					error === void 0 && result === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.skeleton,
						role: "status",
						"aria-label": t("loading"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: classNames(styles.skeletonLine, styles.skeletonLineShort) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: styles.skeletonLine }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: classNames(styles.skeletonLine, styles.skeletonLineShort) })
						]
					}) : null,
					error === void 0 && result !== void 0 && result.tasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.notice,
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("empty") })]
					}) : null,
					error === void 0 && result !== void 0 && result.tasks.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: styles.list,
						children: result.tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectOpsRow, {
							t,
							task,
							onOpen
						}, task.id))
					}) : null,
					error === void 0 && result?.truncated === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: styles.notice,
						children: t("truncated")
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/ProjectOpsAction.tsx
		/**
		* Stateful half of the Project Ops header action.
		*
		* Owns what the presentational tree must not: the bounded read of the session
		* workspace, opening and dismissal, viewport placement of the portaled panel,
		* and keyboard traversal between the trigger and the panel. The panel is
		* portaled to the document body because the session header is a clipping column
		* that the right sidebar borders or overlaps, so an in-place popover is cut off
		* or covered there.
		*/
		/** Minimum gap kept between the panel and the viewport edges. */
		const VIEWPORT_MARGIN = 12;
		/** Distance between the trigger's bottom edge and the panel. */
		const MENU_GAP = 5;
		/** Unplaced panel: hidden but laid out, so the first placement measures real dimensions. */
		const MEASURE_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		/** Keyboard-reachable controls inside the panel, in document order. */
		const FOCUSABLE = "button:not(:disabled), a[href], [tabindex]:not([tabindex=\"-1\"])";
		/**
		* Render the header action.
		* @param props - locale seat, session id, and the injected read/preview face.
		* @returns the trigger plus, while open, the portaled panel.
		*/
		function ProjectOpsAction({ t, list, open, sessionId }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [reload, setReload] = (0, react.useState)(0);
			const [result, setResult] = (0, react.useState)();
			const [error, setError] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!expanded) return;
				const controller = new AbortController();
				setBusy(true);
				setResult(void 0);
				setError(void 0);
				list(controller.signal).then((value) => {
					if (!controller.signal.aborted) {
						setResult(value);
						setBusy(false);
					}
				}, (reason) => {
					if (controller.signal.aborted) return;
					setError(reason instanceof Error ? reason.message : String(reason));
					setBusy(false);
				});
				return () => {
					controller.abort();
				};
			}, [
				expanded,
				reload,
				sessionId,
				list
			]);
			const position = (0, _deepseek_ai_dsh_client_ui_primitives.useAnchoredPosition)({
				open: expanded,
				anchorRef: rootRef,
				panelRef,
				gap: MENU_GAP,
				margin: VIEWPORT_MARGIN
			});
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, expanded, setExpanded, panelRef);
			const close = (0, react.useCallback)(() => {
				setExpanded(false);
				triggerRef.current?.focus();
			}, []);
			const openDocument = (0, react.useCallback)((task, file) => {
				open(task, file);
				setExpanded(false);
				triggerRef.current?.focus();
			}, [open]);
			const onKeyDown = (event) => {
				if (!expanded) return;
				const trigger = triggerRef.current;
				if (event.key === "Escape") {
					event.preventDefault();
					close();
					return;
				}
				const panel = panelRef.current;
				/* v8 ignore next -- both refs are attached while the open panel renders. */
				if (event.key !== "Tab" || trigger === null || panel === null) return;
				const focusable = [...panel.querySelectorAll(FOCUSABLE)];
				if (event.target === trigger) {
					if (event.shiftKey) return;
					event.preventDefault();
					focusable[0]?.focus();
				} else if (event.shiftKey ? event.target === focusable[0] : event.target === focusable.at(-1)) {
					if (event.shiftKey) event.preventDefault();
					trigger.focus();
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				onKeyDown,
				className: styles.root,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectOpsTrigger, {
					t,
					open: expanded,
					count: result?.tasks.length,
					triggerRef,
					onToggle: () => {
						setExpanded((value) => !value);
					}
				}), expanded ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectOpsPanel, {
					t,
					open: true,
					position,
					measureStyle: MEASURE_STYLE,
					panelRef,
					result,
					error,
					busy,
					onRefresh: () => {
						setReload((value) => value + 1);
					},
					onClose: close,
					onOpen: openDocument
				}), document.body) : null]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** Required client services: slots, dictionaries, the file remotes and the native preview. */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.workspaceFiles",
			"sidebarRight"
		];
		/** One bounded read at a time, four requests in flight at most. */
		const READ_CONCURRENCY = 4;
		/** More task directories than this are not read; the panel reports the truncation. */
		const TASK_LIMIT = 100;
		/** Task directories carry a dated slug and a 16-hex revision suffix. */
		const TASK_DIRECTORY = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u;
		/**
		* Register the dictionaries, the stylesheet and the session-header action.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}));
			installStyles(ctx);
			ctx.effect(() => ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "@missher/dsh-project-ops",
				locale: NS,
				order: 140,
				inject: (sessionId) => ({
					async list(signal) {
						const root = await ctx.remote.workspaceFiles.list(sessionId, "docs/tasks", signal);
						if (!root.ok) {
							if (root.error.code === "workspace-file/not-found") return {
								tasks: [],
								truncated: false
							};
							throw new Error(root.error.message);
						}
						const dirs = root.value.entries.filter((row) => row.type === "directory" && TASK_DIRECTORY.test(row.name)).reverse();
						const tasks = [];
						const selected = dirs.slice(0, TASK_LIMIT);
						let cursor = 0;
						await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, selected.length) }, async () => {
							while (cursor < selected.length) {
								const index = cursor++;
								const dir = selected[index];
								signal.throwIfAborted();
								const path = `docs/tasks/${dir.name}`;
								let plan = false;
								let ready = false;
								try {
									const children = await ctx.remote.workspaceFiles.list(sessionId, path, signal);
									if (!children.ok) throw new Error(children.error.message);
									plan = children.value.entries.some((row) => row.type === "file" && row.name === "PLAN.md");
									ready = children.value.entries.some((row) => row.type === "file" && row.name === "READY.md");
									const read = async (file, exists) => {
										if (!exists) return void 0;
										const response = await ctx.remote.workspaceFiles.readBytes(sessionId, `${path}/${file}`, { range: {
											offset: 0,
											length: 131072
										} }, signal);
										if (!response.ok || !response.value.eof) throw new Error("Document unavailable or too large");
										return new TextDecoder("utf-8", { fatal: true }).decode(response.value.data);
									};
									const planText = await read("PLAN.md", plan);
									const readyText = await read("READY.md", ready);
									const status = await documentStatus(dir.name, planText, readyText);
									tasks[index] = {
										id: dir.name,
										plan,
										ready,
										...status
									};
								} catch {
									signal.throwIfAborted();
									tasks[index] = {
										id: dir.name,
										plan,
										ready,
										delivery: "inspect"
									};
								}
							}
						}));
						return {
							tasks,
							truncated: root.value.truncated || dirs.length > TASK_LIMIT
						};
					},
					open: (task, file) => ctx.sidebarRight.openResource(sessionFileAddress(sessionId, `docs/tasks/${task}/${file}`))
				})
			}, ProjectOpsAction)));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
