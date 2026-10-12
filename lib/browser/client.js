window.__ModuleLoader__.load({
	id: "@missher/dsh-project-ops",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		//#region src/client/index.tsx
		const zh = {
			title: "Project Ops",
			plan: "查看方案",
			ready: "查看交付",
			loading: "正在读取项目任务…",
			empty: "尚无开发任务。向当前会话说明开发需求，Agent 会按任务规模维护方案与交付记录。",
			close: "关闭",
			refresh: "刷新",
			hint: "交付记录保留历史事实；请核对方案状态和关联修订。文件存在不代表已发布或安装。",
			missing: "尚未生成",
			error: "无法读取项目任务",
			truncated: "任务列表过长，当前只显示前 100 项。",
			current: "交付关联当前方案（不代表验收通过）",
			historical: "历史交付：方案已更新",
			inspect: "记录待核对：可能已编辑、中断或读取失败"
		};
		const en = {
			title: "Project Ops",
			plan: "View plan",
			ready: "View delivery",
			loading: "Loading project tasks…",
			empty: "No development tasks yet. Describe your development request in this session; the agent maintains documents when the task warrants them.",
			close: "Close",
			refresh: "Refresh",
			hint: "Delivery records retain historical facts. Check the plan status and linked revision. A file does not imply release or installation.",
			missing: "Not generated",
			error: "Could not read project tasks",
			truncated: "Showing the first 100 tasks.",
			current: "Delivery linked to current plan (not acceptance)",
			historical: "Historical delivery: plan updated",
			inspect: "Review needed: edited, interrupted, or unreadable record"
		};
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.workspaceFiles",
			"sidebarRight"
		];
		/** Bounded read-only task browser over the existing workspace-files remote. */
		function ProjectOpsPanel({ t, list, open, sessionId }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [reload, setReload] = (0, react.useState)(0);
			const [result, setResult] = (0, react.useState)();
			const [error, setError] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (!expanded) return;
				const controller = new AbortController();
				setResult(void 0);
				setError(void 0);
				list(controller.signal).then((value) => {
					if (!controller.signal.aborted) setResult(value);
				}, (reason) => {
					if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
				});
				return () => controller.abort();
			}, [
				expanded,
				reload,
				sessionId,
				list
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { position: "relative" },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-expanded": expanded,
					onClick: () => setExpanded((value) => !value),
					children: t("title")
				}), expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					role: "region",
					"aria-label": t("title"),
					style: {
						position: "fixed",
						right: 16,
						top: 64,
						zIndex: 50,
						width: "min(420px, 85vw)",
						maxHeight: "65vh",
						overflow: "auto",
						padding: 16,
						border: "1px solid currentColor",
						borderRadius: 8,
						background: "Canvas",
						color: "CanvasText",
						boxShadow: "0 6px 24px #0003"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 12,
								alignItems: "center"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("title") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => setReload((value) => value + 1),
									children: t("refresh")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => setExpanded(false),
									children: t("close")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("hint") }),
						error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							role: "alert",
							children: [
								t("error"),
								"：",
								error
							]
						}),
						!result && !error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							children: t("loading")
						}),
						result?.tasks.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("empty") }),
						result?.truncated && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("truncated") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							style: { paddingLeft: 18 },
							children: result?.tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								style: {
									marginBottom: 12,
									overflowWrap: "anywhere"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: task.title ?? task.id }) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
										task.title && task.id,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										t(task.delivery)
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: !task.plan,
										onClick: () => {
											open(task.id, "PLAN.md");
											setExpanded(false);
										},
										children: t("plan")
									}),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: !task.ready,
										title: task.ready ? void 0 : t("missing"),
										onClick: () => {
											open(task.id, "READY.md");
											setExpanded(false);
										},
										children: t("ready")
									})
								]
							}, task.id))
						})
					]
				})]
			});
		}
		/** Register into the existing Session header and native file preview; no new remote or host patch. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("projectOps", {
				zh,
				en
			}));
			ctx.effect(() => ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "@missher/dsh-project-ops",
				locale: "projectOps",
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
						const dirs = root.value.entries.filter((row) => row.type === "directory" && /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u.test(row.name)).reverse();
						const tasks = [];
						const selected = dirs.slice(0, 100);
						let cursor = 0;
						await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
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
							truncated: root.value.truncated || dirs.length > 100
						};
					},
					open: (task, file) => ctx.sidebarRight.openResource(sessionFileAddress(sessionId, `docs/tasks/${task}/${file}`))
				})
			}, ProjectOpsPanel)));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
