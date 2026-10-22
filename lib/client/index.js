import { sessionFileAddress } from "@deepseek-ai/dsh-util-workspace-path";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconArchiveOutlineRegular, IconChecklistOutlineRegular, IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconDeliverDocRegular, IconInspectOutlineRegular, IconRefreshOutlineRegular, StateDot, useAnchoredPosition, useDismissOnOutsidePointer } from "@deepseek-ai/dsh-client-ui-primitives";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/client/document-status.ts
/** Limits applied to metadata before it reaches the panel. */
const MAX_ARTIFACTS = 5;
const MAX_FIELD = 300;
const MAX_DOCUMENT = 131072;
/** One bounded, display-safe string from the report, with the cut recorded. */
function bounded(value) {
	if (typeof value !== "string") return void 0;
	const text = value.trim();
	if (text.length === 0) return void 0;
	return {
		text: text.slice(0, MAX_FIELD),
		cut: text.length > MAX_FIELD
	};
}
/**
* Derive the panel's status for one document pair.
* @param id - task identity the PLAN metadata must claim (directory name, or '.' for the workspace root).
* @param plan - PLAN.md text, when readable.
* @param ready - READY.md text, when readable.
* @returns managed freshness when a record decoded, otherwise a plain-record state.
*/
async function documentStatus(id, plan, ready) {
	const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
	/** A plain record: visible, read-only, and flagged for the human to check. */
	const plain = {
		delivery: ready !== void 0 ? "inspect" : "missing",
		managed: false,
		artifacts: []
	};
	/** A metadata header existed but did not validate: damaged, so it needs review. */
	const damaged = {
		delivery: "inspect",
		managed: false,
		artifacts: [],
		damaged: true
	};
	try {
		if (!plan) return plain;
		if (new TextEncoder().encode(plan).length > MAX_DOCUMENT) return damaged;
		const match = /^\[project-ops-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>\n\n/u.exec(plan);
		if (!match) return plan.includes("[project-ops-v1]:") ? damaged : plain;
		/** The decoded envelope; every member is untrusted until narrowed below. */
		const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))));
		const record = metadata.record;
		if (record?.format !== 1 || record.taskId !== id || typeof record.plan?.title !== "string" || record.plan.title.length > 16e3 || metadata.bodyHash !== await hash(plan.slice(match[0].length))) return damaged;
		const title = record.plan.title;
		/** The delivery half of the record, narrowed before any member is read. */
		const delivery = record.delivery !== null && typeof record.delivery === "object" ? record.delivery : void 0;
		/** Report artifacts, narrowed to a real array of unknown before mapping. */
		const reportValue = delivery === void 0 ? void 0 : delivery.report;
		const artifactValues = reportValue !== null && typeof reportValue === "object" ? reportValue.artifacts : void 0;
		const summaries = Array.isArray(artifactValues) ? artifactValues.map((value) => bounded(value)).filter((summary) => summary !== void 0) : [];
		const kept = summaries.slice(0, MAX_ARTIFACTS);
		const managed = {
			title,
			managed: true,
			artifacts: kept.map((summary) => summary.text),
			delivery: ready === void 0 ? delivery !== void 0 ? "inspect" : "missing" : "inspect"
		};
		if (kept.some((summary) => summary.cut) || summaries.length > MAX_ARTIFACTS) managed.artifactsTruncated = true;
		const verification = bounded(delivery?.verification);
		if (verification !== void 0) {
			managed.verification = verification.text;
			if (verification.cut) managed.verificationTruncated = true;
		}
		if (ready === void 0) return managed;
		if (new TextEncoder().encode(ready).length > MAX_DOCUMENT) return managed;
		const readyHash = await hash(ready);
		managed.delivery = delivery?.readyHash === readyHash ? "current" : delivery === void 0 && record.previousReadyHash === readyHash ? "historical" : "inspect";
		return managed;
	} catch {
		return damaged;
	}
}
/**
* First Markdown heading of a plain document, bounded for use as a display title.
* Never invents a title: returns `undefined` when the document has none.
* @param text - document body.
* @returns the heading text, or `undefined`.
*/
function headingTitle(text) {
	if (text === void 0) return void 0;
	const title = /^#{1,3}\s+(.+)$/mu.exec(text)?.[1]?.trim();
	return title === void 0 || title.length === 0 ? void 0 : title.slice(0, 200);
}
//#endregion
//#region src/client/locales.ts
/**
* `projectOps` namespace dictionaries for the session-header task browser.
*
* Wording rule: a delivery record that is linked to the current plan revision
* is reported as a link, never as an acceptance, a release or an install. The
* in-row status stays short; the boundary lives in the element's tooltip.
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
	"loading": "正在读取项目任务…",
	"empty": "尚无开发任务。向当前会话说明开发需求后，Agent 会按任务规模维护方案与交付记录。",
	"error": "无法读取项目任务",
	"errorDetail": "读取失败，未修改任何文件：{error}",
	"retry": "重试",
	"truncated": "宿主目录列表已达上限，仍可能有未列出的记录。",
	"pending": "还有 {count} 个目录未检查。",
	"more": "显示更多",
	"search.placeholder": "检索标题或路径",
	"search.aria": "检索交付记录",
	"search.empty": "没有匹配的记录。",
	"badge.root": "工作区根",
	"badge.legacy": "旧版目录",
	"badge.plain": "普通记录",
	"root.title": "工作区根文档",
	"problem.text": "未能完整读取：{error}",
	"artifacts.label": "产物",
	"artifacts.hint": "产物路径来自交付记录正文；存在产物不代表已验收、已发布或已安装。",
	"summary.truncated": "摘要已截断，完整内容见 READY。",
	"verify.label": "验收（会话报告）",
	"verify.none": "无证据，未验证",
	"verify.hint": "此句来自交付记录正文，是会话报告而非插件独立证明；缺失证据保持未验证。",
	"source.hint": "相对位置：{path}",
	"status.current": "交付关联当前方案",
	"status.currentHint": "交付记录与当前方案修订一致；不代表验收通过、发布或安装。",
	"status.historical": "方案已更新",
	"status.historicalHint": "交付记录对应更早的方案修订，保留为历史事实。",
	"status.inspect": "记录待核对",
	"status.inspectHint": "记录无法校验完整关联，请自行核对内容。",
	"status.missing": "方案进行中",
	"status.missingHint": "方案已保存，尚无交付记录；方案存在不代表完成、验收或发布。",
	"footer": "交付记录保留历史事实，文件存在不代表已发布或安装。",
	"unavailable.list": "此 Host 未提供工作区文件读取能力，无法列出项目任务。",
	"unavailable.listDetail": "缺少 remote.workspaceFiles 的 list / readBytes",
	"unavailable.preview": "此 Host 未提供原生文件预览，无法打开方案或交付。",
	"unavailable.previewDetail": "缺少 sidebarRight.openResource",
	"view.plan": "方案",
	"view.ready": "交付",
	"view.missingPlan": "尚未生成方案",
	"view.missingReady": "尚未生成交付记录"
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
	"loading": "Loading project tasks…",
	"empty": "No development tasks yet. Describe your development request in this session; the agent maintains documents when the task warrants them.",
	"error": "Could not read project tasks",
	"errorDetail": "Read failed, no file was changed: {error}",
	"retry": "Retry",
	"truncated": "The Host directory listing reached its entry cap; more records may exist than are listed.",
	"pending": "{count} directories are not examined yet.",
	"more": "Show more",
	"search.placeholder": "Search title or path",
	"search.aria": "Search delivery records",
	"search.empty": "No record matches the search.",
	"badge.root": "Workspace root",
	"badge.legacy": "Legacy directory",
	"badge.plain": "Plain record",
	"root.title": "Workspace root documents",
	"problem.text": "Could not be read in full: {error}",
	"artifacts.label": "Artifacts",
	"artifacts.hint": "Artifact paths come from the delivery report body; an existing artifact is not an acceptance, a release or an install.",
	"summary.truncated": "Summary truncated; the full record is in READY.",
	"verify.label": "Acceptance (session report)",
	"verify.none": "No evidence; unverified",
	"verify.hint": "This sentence comes from the delivery report body: a session report, not independent plugin proof. Missing evidence stays unverified.",
	"source.hint": "Relative location: {path}",
	"status.current": "Delivery linked to current plan",
	"status.currentHint": "The delivery record matches the current plan revision; that is not an acceptance, a release or an install.",
	"status.historical": "Plan updated",
	"status.historicalHint": "The delivery record belongs to an earlier plan revision and stays as history.",
	"status.inspect": "Record needs review",
	"status.inspectHint": "The record cannot be fully linked; check its contents yourself.",
	"status.missing": "Plan in progress",
	"status.missingHint": "A plan exists with no delivery record yet; a plan is not completion, acceptance or a release.",
	"footer": "Delivery records keep historical facts; a file does not mean released or installed.",
	"unavailable.list": "This Host does not expose workspace file reading, so project tasks cannot be listed.",
	"unavailable.listDetail": "remote.workspaceFiles list / readBytes is unavailable",
	"unavailable.preview": "This Host does not expose the native file preview, so plans and delivery records cannot be opened.",
	"unavailable.previewDetail": "sidebarRight.openResource is unavailable",
	"view.plan": "Plan",
	"view.ready": "Delivery",
	"view.missingPlan": "No plan yet",
	"view.missingReady": "No delivery record yet"
};
//#endregion
//#region \0project-ops-css:project-ops.css.1.mjs
var _project_ops_css_project_ops_css_1_default = "/*\n * Project Ops session-header panel.\n *\n * Theme tokens below are defined by the official theme of the target Host\n * (`@deepseek-ai/dsh-client-ui-theme`, 0.2.1-alpha.2); none is a token that\n * only exists in unpublished sources. Light and dark themes are inherited\n * automatically, so this file declares no color of its own.\n *\n * Class names are namespaced (`po-`) because the sheet is injected globally:\n * the closure-factory channel delivers CSS as text, not through a CSS-Modules\n * class map.\n */\n\n/* Header action seat: in flow, never a zero-size overlay. */\n.po-root {\n  display: inline-flex;\n  min-width: 0;\n}\n\n/*\n * Trigger: the native session-header action shape — transparent, borderless,\n * 28px tall, tertiary label that lifts to secondary on hover/focus. No\n * `background: Canvas` and no default button bevel.\n */\n.po-trigger {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  min-height: 28px;\n  padding: 3px 6px;\n  border: 0;\n  border-radius: var(--dsw-radius-sm);\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  font-family: var(--dsw-font-family);\n  font-size: var(--dsw-font-xxs-12-font-size);\n  line-height: var(--dsw-font-xxs-12-line-height);\n  cursor: pointer;\n}\n\n.po-trigger:hover,\n.po-trigger:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.po-trigger[aria-expanded='true'] {\n  color: var(--dsw-alias-label-primary);\n}\n\n.po-trigger-icon {\n  flex: none;\n}\n\n.po-trigger-label {\n  /* Hosts without the shared header baseline keep the trigger alignment. */\n  align-self: var(--dsh-conversation-header-label-align, auto);\n  white-space: nowrap;\n}\n\n.po-trigger-chevron {\n  flex: none;\n  transition: transform 120ms ease;\n}\n\n.po-trigger-chevron-open {\n  transform: rotate(180deg);\n}\n\n/*\n * Panel: portaled to the document body and fixed in the viewport, with\n * coordinates supplied inline by the shared anchored-position hook. The\n * z-index sits above the right sidebar (at most 40) and below modal overlays\n * (1000), matching the official header popovers.\n */\n.po-menu {\n  position: fixed;\n  z-index: 100;\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  width: 440px;\n  max-width: min(460px, calc(100vw - 24px));\n  max-height: min(520px, calc(100vh - 140px));\n  padding: 3px;\n  overflow: hidden auto;\n  border: 0;\n  border-radius: var(--dsw-radius-lg);\n  background: var(--dsw-specific-menu);\n  backdrop-filter: var(--dsw-menu-backdrop-filter);\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-family);\n  font-size: var(--dsw-font-xxs-12-font-size);\n  line-height: var(--dsw-font-xxs-12-line-height);\n  box-shadow: var(--dsw-elevation-prominent);\n  /* Soften the elevation stroke the way the official menus do, and keep the\n     shell's own scrollbar variables on the panel surface. */\n  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);\n  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);\n  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);\n}\n\n.po-menu:focus {\n  outline: none;\n}\n\n/* Compact title line with the two panel actions on the trailing edge. */\n.po-header {\n  display: flex;\n  flex: none;\n  align-items: center;\n  gap: 6px;\n  padding: 5px 3px 4px 8px;\n}\n\n.po-header-title {\n  flex: none;\n  color: var(--dsw-alias-label-primary);\n  font-size: var(--dsw-font-xxs-strong-12-font-size);\n  font-weight: var(--dsw-font-xxs-strong-12-font-weight);\n  line-height: var(--dsw-font-xxs-strong-12-line-height);\n}\n\n.po-header-count {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 16px;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n/* Local search over the loaded page; the field joins the panel's Tab order. */\n.po-toolbar {\n  display: flex;\n  flex: none;\n  padding: 1px 6px 6px;\n}\n\n.po-search {\n  flex: 1;\n  min-width: 0;\n  height: 26px;\n  padding: 0 8px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font-family: inherit;\n  font-size: var(--dsw-font-xxs-12-font-size);\n  line-height: 18px;\n}\n\n.po-search::placeholder {\n  color: var(--dsw-alias-label-caption);\n}\n\n.po-search:focus-visible {\n  border-color: var(--dsw-alias-border-l3);\n}\n\n.po-icon-button {\n  display: inline-flex;\n  flex: none;\n  align-items: center;\n  justify-content: center;\n  width: 22px;\n  height: 22px;\n  padding: 0;\n  border: 0;\n  border-radius: var(--dsw-radius-xs);\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  cursor: pointer;\n}\n\n.po-icon-button:hover,\n.po-icon-button:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.po-icon-button:active {\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n.po-icon-button:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n.po-icon-button:disabled:hover {\n  background: transparent;\n}\n\n/* The refresh affordance while a read is in flight. */\n.po-spin {\n  animation: po-spin 900ms linear infinite;\n}\n\n@keyframes po-spin {\n  from { transform: rotate(0deg); }\n  to { transform: rotate(360deg); }\n}\n\n/* Light footer line; the list stays the panel's main content. */\n.po-footer {\n  flex: none;\n  margin: 3px 8px 5px;\n  color: var(--dsw-alias-label-caption);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 16px;\n}\n\n/* Loading / empty / error / truncated states share one geometry. */\n.po-notice {\n  display: flex;\n  align-items: flex-start;\n  gap: 6px;\n  padding: 8px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 17px;\n}\n\n.po-notice-error {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.po-notice-action {\n  flex: none;\n}\n\n.po-skeleton {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 8px;\n}\n\n.po-skeleton-line {\n  height: 10px;\n  border-radius: var(--dsw-radius-xs);\n  background: var(--dsw-alias-bg-skeleton);\n}\n\n.po-skeleton-line-short {\n  width: 45%;\n}\n\n.po-list {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n\n/*\n * Task card: heading line first, then a metadata line carrying the short status\n * and the two lightweight document entries. The hover wash rides the whole card\n * so the trailing entries stay inside it.\n */\n.po-row {\n  display: flex;\n  box-sizing: border-box;\n  padding: 9px 8px;\n  border-radius: var(--dsw-radius-sm);\n}\n\n.po-row:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.po-row-main {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: 4px;\n  min-width: 0;\n}\n\n/* Task heading: 13px medium, up to two lines, full text kept in the title. */\n.po-row-title {\n  display: -webkit-box;\n  overflow: hidden;\n  color: var(--dsw-alias-label-primary);\n  font-size: var(--dsw-font-xs-13-font-size);\n  font-weight: var(--dsw-font-xs-strong-13-font-weight);\n  line-height: var(--dsw-font-xs-strong-13-line-height);\n  overflow-wrap: anywhere;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n}\n\n/* Relative location and provenance; a technical path stays secondary. */\n.po-row-source {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  min-width: 0;\n}\n\n.po-row-path {\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n.po-badge {\n  flex: none;\n  padding: 0 5px;\n  border-radius: var(--dsw-radius-xs);\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n}\n\n/* Bounded artifact excerpt from a managed delivery report; never a link. */\n.po-artifacts {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: baseline;\n  gap: 4px;\n  min-width: 0;\n}\n\n.po-artifacts-label {\n  flex: none;\n  color: var(--dsw-alias-label-caption);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n}\n\n.po-artifact {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n  overflow-wrap: anywhere;\n}\n\n.po-artifact-note {\n  color: var(--dsw-alias-label-caption);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n}\n\n/* Verification is a session report; the label makes that explicit. */\n.po-verify {\n  display: flex;\n  align-items: baseline;\n  gap: 4px;\n  min-width: 0;\n}\n\n.po-verify-label {\n  flex: none;\n  color: var(--dsw-alias-label-caption);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n}\n\n.po-verify-text {\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* A read problem keeps the row visible and explains itself. */\n.po-row-problem {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 15px;\n  overflow-wrap: anywhere;\n}\n\n/* Directory id fallback when no readable title identified the task. */\n.po-row-id {\n  color: var(--dsw-alias-label-secondary);\n  font-size: var(--dsw-font-xxs-12-font-size);\n  line-height: var(--dsw-font-xxs-12-line-height);\n  overflow-wrap: anywhere;\n}\n\n.po-row-meta {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.po-row-dot {\n  flex: none;\n}\n\n/* Readable secondary status, not a near-transparent caption. */\n.po-row-status {\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-secondary);\n  font-size: var(--dsw-font-xxs-12-font-size);\n  line-height: 18px;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n.po-row-actions {\n  display: flex;\n  flex: none;\n  gap: 2px;\n  margin-left: auto;\n}\n\n/*\n * Document entries: an icon plus a label, borderless until hover. Disabled means\n * \"this document was never generated\" or \"this Host has no native preview\": no\n * hover, dimmed label, reason in the tooltip.\n */\n.po-action {\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  height: 22px;\n  padding: 0 6px;\n  border: 0;\n  border-radius: var(--dsw-radius-xs);\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  font-family: inherit;\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 16px;\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.po-action-icon {\n  flex: none;\n}\n\n.po-action:hover:not(:disabled),\n.po-action:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n\n.po-action:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n/* Continuation of the bounded page cursor. */\n.po-more-row {\n  display: flex;\n  flex: none;\n  justify-content: center;\n  padding: 4px 6px 2px;\n}\n\n.po-more {\n  display: inline-flex;\n  align-items: center;\n  height: 24px;\n  padding: 0 10px;\n  border: 0;\n  border-radius: var(--dsw-radius-xs);\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font-family: inherit;\n  font-size: var(--dsw-font-xxxs-11-font-size);\n  line-height: 16px;\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.po-more:hover:not(:disabled),\n.po-more:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n\n.po-more:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n/* Narrow shells: the panel keeps the viewport margin and the rows stay legible\n   by letting the actions drop under the title instead of clipping. */\n@media (max-width: 480px) {\n  .po-menu {\n    width: calc(100vw - 24px);\n    max-width: calc(100vw - 24px);\n  }\n\n  .po-row-meta {\n    flex-wrap: wrap;\n  }\n\n  .po-row-actions {\n    margin-left: 0;\n  }\n}\n";
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
	toolbar: "po-toolbar",
	search: "po-search",
	iconButton: "po-icon-button",
	spin: "po-spin",
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
	rowTitle: "po-row-title",
	rowId: "po-row-id",
	rowSource: "po-row-source",
	rowPath: "po-row-path",
	badge: "po-badge",
	artifacts: "po-artifacts",
	artifactsLabel: "po-artifacts-label",
	artifact: "po-artifact",
	artifactNote: "po-artifact-note",
	verify: "po-verify",
	verifyLabel: "po-verify-label",
	verifyText: "po-verify-text",
	rowProblem: "po-row-problem",
	rowMeta: "po-row-meta",
	rowStatus: "po-row-status",
	rowActions: "po-row-actions",
	action: "po-action",
	actionIcon: "po-action-icon",
	moreRow: "po-more-row",
	more: "po-more",
	footer: "po-footer"
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
* Resolve one row.
* @param task - discovered document pair.
* @returns the row's text, badges, actions and evidence.
*/
function taskView(task) {
	const view = deliveryView(task.delivery);
	const hasTitle = task.title !== void 0 && task.title.trim().length > 0;
	const badges = [];
	if (task.origin === "root") badges.push("badge.root");
	if (task.legacy) badges.push("badge.legacy");
	if (!task.managed) badges.push("badge.plain");
	const resolved = {
		id: task.id,
		path: task.path,
		title: hasTitle ? task.title.trim() : task.id,
		hasTitle,
		source: task.path,
		badges,
		status: view.statusKey,
		hint: view.hintKey,
		dot: view.dot,
		attention: view.attention,
		artifacts: task.managed ? task.artifacts : [],
		artifactsTruncated: task.managed && task.artifactsTruncated === true,
		verificationTruncated: task.delivery === "current" || task.delivery === "historical" ? task.verificationTruncated === true : false,
		damaged: task.damaged === true,
		planDisabled: !task.plan,
		readyDisabled: !task.ready
	};
	if ((task.delivery === "current" || task.delivery === "historical") && task.managed && task.verification !== void 0) resolved.verification = task.verification;
	if (!hasTitle && task.origin === "root") resolved.titleKey = "root.title";
	if (task.problem !== void 0) resolved.problem = task.problem.slice(0, 200);
	return resolved;
}
/**
* Local, case-insensitive filter over the loaded page.
*
* Matches the title, the directory id and the relative path so a delivery can be
* located by name or by where it lives. No remote call is made.
* @param tasks - rows from the current page.
* @param query - raw user input; blank matches everything.
* @returns the matching rows in their original order.
*/
function filterTasks(tasks, query) {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return [...tasks];
	return tasks.filter((task) => [
		task.title ?? "",
		task.id,
		task.path
	].some((value) => value.toLocaleLowerCase().includes(needle)));
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
	return /* @__PURE__ */ jsxs("button", {
		ref: triggerRef,
		type: "button",
		className: styles.trigger,
		"aria-expanded": open,
		"aria-haspopup": "dialog",
		"aria-label": label,
		title: label,
		onClick: onToggle,
		children: [
			/* @__PURE__ */ jsx(IconChecklistOutlineRegular, {
				size: 14,
				className: styles.triggerIcon
			}),
			/* @__PURE__ */ jsx("span", {
				className: styles.triggerLabel,
				children: t("trigger.label")
			}),
			/* @__PURE__ */ jsx(IconChevronDownOutlineRegular, {
				size: 12,
				className: classNames(styles.triggerChevron, open && styles.triggerChevronOpen)
			})
		]
	});
}
/**
* One delivery: heading, then its relative location and provenance badges, its
* bounded artifact excerpt when a managed report recorded one, the read problem
* when the entry is only partly readable, and the status plus document entries.
* @param props - locale, discovered row and the preview opener.
* @returns the list item.
*/
function ProjectOpsRow({ t, task, preview, onOpen }) {
	const view = taskView(task);
	const statusHint = t(view.hint);
	const planDisabled = view.planDisabled || !preview.available;
	const readyDisabled = view.readyDisabled || !preview.available;
	const planTitle = !preview.available ? preview.reason : view.planDisabled ? t("view.missingPlan") : `${t("view.plan")} · ${task.path}/PLAN.md`;
	const readyTitle = !preview.available ? preview.reason : view.readyDisabled ? t("view.missingReady") : `${t("view.ready")} · ${task.path}/READY.md`;
	return /* @__PURE__ */ jsx("li", {
		className: styles.row,
		title: `${task.path} · ${statusHint}`,
		"data-task": task.id,
		"data-path": task.path,
		children: /* @__PURE__ */ jsxs("div", {
			className: styles.rowMain,
			children: [
				/* @__PURE__ */ jsx("div", {
					className: styles.rowTitle,
					title: view.hasTitle ? view.title : void 0,
					children: view.hasTitle ? view.title : view.titleKey === void 0 ? /* @__PURE__ */ jsx("span", {
						className: styles.rowId,
						children: view.id
					}) : t(view.titleKey)
				}),
				/* @__PURE__ */ jsxs("div", {
					className: styles.rowSource,
					title: t("source.hint", { path: view.source }),
					children: [/* @__PURE__ */ jsx("span", {
						className: styles.rowPath,
						children: view.source
					}), view.badges.map((key) => /* @__PURE__ */ jsx("span", {
						className: styles.badge,
						children: t(key)
					}, key))]
				}),
				view.artifacts.length > 0 ? /* @__PURE__ */ jsxs("div", {
					className: styles.artifacts,
					title: t("artifacts.hint"),
					children: [
						/* @__PURE__ */ jsx("span", {
							className: styles.artifactsLabel,
							children: t("artifacts.label")
						}),
						view.artifacts.map((artifact) => /* @__PURE__ */ jsx("span", {
							className: styles.artifact,
							children: artifact
						}, artifact)),
						view.artifactsTruncated ? /* @__PURE__ */ jsx("span", {
							className: styles.artifactNote,
							children: t("summary.truncated")
						}) : null
					]
				}) : null,
				/* @__PURE__ */ jsxs("div", {
					className: styles.verify,
					title: t("verify.hint"),
					children: [/* @__PURE__ */ jsx("span", {
						className: styles.verifyLabel,
						children: t("verify.label")
					}), /* @__PURE__ */ jsxs("span", {
						className: styles.verifyText,
						children: [view.verification === void 0 ? t("verify.none") : view.verification, view.verificationTruncated ? ` ${t("summary.truncated")}` : ""]
					})]
				}),
				view.problem === void 0 ? null : /* @__PURE__ */ jsx("div", {
					className: styles.rowProblem,
					children: t("problem.text", { error: view.problem })
				}),
				/* @__PURE__ */ jsxs("div", {
					className: styles.rowMeta,
					children: [
						/* @__PURE__ */ jsx(StateDot, {
							state: view.dot,
							className: styles.rowDot
						}),
						/* @__PURE__ */ jsx("span", {
							className: styles.rowStatus,
							title: statusHint,
							children: t(view.status)
						}),
						/* @__PURE__ */ jsxs("span", {
							className: styles.rowActions,
							children: [/* @__PURE__ */ jsxs("button", {
								type: "button",
								className: styles.action,
								disabled: planDisabled,
								title: planTitle,
								onClick: () => {
									onOpen(task.path, "PLAN.md");
								},
								children: [/* @__PURE__ */ jsx(IconChecklistOutlineRegular, {
									size: 12,
									className: styles.actionIcon
								}), /* @__PURE__ */ jsx("span", { children: t("view.plan") })]
							}), /* @__PURE__ */ jsxs("button", {
								type: "button",
								className: styles.action,
								disabled: readyDisabled,
								title: readyTitle,
								onClick: () => {
									onOpen(task.path, "READY.md");
								},
								children: [/* @__PURE__ */ jsx(IconDeliverDocRegular, {
									size: 12,
									className: styles.actionIcon
								}), /* @__PURE__ */ jsx("span", { children: t("view.ready") })]
							})]
						})
					]
				})
			]
		})
	});
}
/** One notice line for a capability this Host does not expose; the service name stays in the tooltip. */
function UnavailableNotice({ text, detail }) {
	return /* @__PURE__ */ jsxs("div", {
		className: styles.notice,
		role: "status",
		title: detail,
		children: [/* @__PURE__ */ jsx(IconInspectOutlineRegular, { size: 14 }), /* @__PURE__ */ jsx("span", { children: text })]
	});
}
/**
* The panel surface: compact title line with refresh/close, the local search
* field, then the loading, empty, error or delivery list body with its bounded
* paging and truncation notices.
* @param props - locale, placement, read state, page, filter and panel actions.
* @returns the portaled panel, or `null` while closed.
*/
function ProjectOpsPanel(props) {
	const { t, open, position, measureStyle, panelRef, result, error, busy, availability, query, onQuery, onRefresh, onLoadMore, onClose, onOpen } = props;
	if (!open) return null;
	const preview = {
		available: availability.preview,
		reason: availability.previewReason ?? t("unavailable.preview")
	};
	const visible = result === void 0 ? [] : filterTasks(result.tasks, query);
	return /* @__PURE__ */ jsxs("section", {
		ref: panelRef,
		className: styles.menu,
		style: position ?? measureStyle,
		role: "dialog",
		"aria-label": t("title"),
		tabIndex: -1,
		"aria-busy": busy,
		children: [
			/* @__PURE__ */ jsxs("header", {
				className: styles.header,
				children: [
					/* @__PURE__ */ jsx("span", {
						className: styles.headerTitle,
						children: t("title")
					}),
					/* @__PURE__ */ jsx("span", {
						className: styles.headerCount,
						children: availability.list && result !== void 0 ? t("count", { count: result.tasks.length }) : ""
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: styles.iconButton,
						"aria-label": t("refresh"),
						title: t("refresh"),
						onClick: onRefresh,
						children: /* @__PURE__ */ jsx(IconRefreshOutlineRegular, {
							size: 14,
							className: busy ? styles.spin : void 0
						})
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: styles.iconButton,
						"aria-label": t("close"),
						title: t("close"),
						onClick: onClose,
						children: /* @__PURE__ */ jsx(IconCloseOutlineRegular, { size: 14 })
					})
				]
			}),
			!availability.list ? /* @__PURE__ */ jsx(UnavailableNotice, {
				text: availability.listReason ?? t("unavailable.list"),
				detail: t("unavailable.listDetail")
			}) : null,
			availability.list && error !== void 0 ? /* @__PURE__ */ jsxs("div", {
				className: classNames(styles.notice, styles.noticeError),
				role: "alert",
				children: [
					/* @__PURE__ */ jsx(IconInspectOutlineRegular, { size: 14 }),
					/* @__PURE__ */ jsx("span", { children: t("errorDetail", { error }) }),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: classNames(styles.action, styles.noticeAction),
						onClick: onRefresh,
						children: t("retry")
					})
				]
			}) : null,
			availability.list && error === void 0 && result === void 0 ? /* @__PURE__ */ jsxs("div", {
				className: styles.skeleton,
				role: "status",
				"aria-label": t("loading"),
				children: [
					/* @__PURE__ */ jsx("span", { className: classNames(styles.skeletonLine, styles.skeletonLineShort) }),
					/* @__PURE__ */ jsx("span", { className: styles.skeletonLine }),
					/* @__PURE__ */ jsx("span", { className: classNames(styles.skeletonLine, styles.skeletonLineShort) })
				]
			}) : null,
			availability.list && error === void 0 && result !== void 0 ? result.warnings.map((warning) => /* @__PURE__ */ jsxs("div", {
				className: styles.notice,
				role: "status",
				title: warning,
				children: [/* @__PURE__ */ jsx(IconInspectOutlineRegular, { size: 14 }), /* @__PURE__ */ jsx("span", { children: t("problem.text", { error: warning }) })]
			}, warning)) : null,
			availability.list && error === void 0 && result !== void 0 && result.tasks.length === 0 && result.pending === 0 && result.warnings.length === 0 ? /* @__PURE__ */ jsxs("div", {
				className: styles.notice,
				role: "status",
				children: [/* @__PURE__ */ jsx(IconArchiveOutlineRegular, { size: 14 }), /* @__PURE__ */ jsx("span", { children: t("empty") })]
			}) : null,
			availability.list && error === void 0 && result !== void 0 && result.tasks.length > 0 ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("div", {
				className: styles.toolbar,
				children: /* @__PURE__ */ jsx("input", {
					className: styles.search,
					type: "search",
					value: query,
					placeholder: t("search.placeholder"),
					"aria-label": t("search.aria"),
					onChange: (event) => {
						onQuery(event.currentTarget.value);
					}
				})
			}), visible.length === 0 ? /* @__PURE__ */ jsx("div", {
				className: styles.notice,
				role: "status",
				children: t("search.empty")
			}) : /* @__PURE__ */ jsx("ul", {
				className: styles.list,
				children: visible.map((task) => /* @__PURE__ */ jsx(ProjectOpsRow, {
					t,
					task,
					preview,
					onOpen
				}, `${task.origin}:${task.id}`))
			})] }) : null,
			availability.list && error === void 0 && result !== void 0 && result.pending > 0 ? /* @__PURE__ */ jsx("div", {
				className: styles.moreRow,
				children: /* @__PURE__ */ jsxs("button", {
					type: "button",
					className: styles.more,
					onClick: onLoadMore,
					disabled: busy,
					children: [
						t("more"),
						" · ",
						t("pending", { count: result.pending })
					]
				})
			}) : null,
			availability.list && error === void 0 && result?.truncated === true ? /* @__PURE__ */ jsx("div", {
				className: styles.notice,
				children: t("truncated")
			}) : null,
			/* @__PURE__ */ jsx("footer", {
				className: styles.footer,
				title: t("footer"),
				children: t("footer")
			})
		]
	});
}
//#endregion
//#region src/client/ProjectOpsAction.tsx
/**
* Stateful half of the Project Ops header action.
*
* Owns what the presentational tree must not: the bounded, cursor-based read of
* the session workspace (the Host listing has no cursor, so this shell keeps the
* offset and appends batches), opening and dismissal, viewport placement of the
* portaled panel, and keyboard traversal between the trigger and the panel. The
* panel is portaled to the document body because the session header is a
* clipping column that the right sidebar borders or overlaps, so an in-place
* popover is cut off or covered there.
*
* Every read carries a generation ticket: a refresh, a session switch or a
* newer batch invalidates older responses, so a stale page can never be
* appended to, or replace, the current one.
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
/** Keyboard-reachable controls inside the panel, in document order (search field included). */
const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex=\"-1\"])";
/** Directory warnings kept in the accumulated view. */
const MAX_WARNINGS$1 = 5;
/**
* Render the header action.
* @param props - locale seat, session id, and the injected read/preview face.
* @returns the trigger plus, while open, the portaled panel.
*/
function ProjectOpsAction({ t, surface, list, open, sessionId }) {
	const [expanded, setExpanded] = useState(false);
	const [reload, setReload] = useState(0);
	const [result, setResult] = useState();
	const [error, setError] = useState();
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState("");
	const availability = surface();
	const canList = availability.list;
	const rootRef = useRef(null);
	const triggerRef = useRef(null);
	const panelRef = useRef(null);
	/** Invalidates every response older than the current reset/batch. */
	const generation = useRef(0);
	/** The one in-flight read; a new read or a reset aborts it. */
	const controller = useRef();
	/**
	* Start one batch read.
	* @param offset - offset into the Host candidate list.
	* @param replace - `true` for the first batch, `false` to append the next one.
	*/
	const readPage = useCallback((offset, replace) => {
		const ticket = ++generation.current;
		controller.current?.abort();
		const next = new AbortController();
		controller.current = next;
		setBusy(true);
		list(next.signal, { offset }).then((page) => {
			if (next.signal.aborted || ticket !== generation.current) return;
			setError(void 0);
			setResult((current) => {
				if (replace || current === void 0) return page;
				return {
					...page,
					tasks: [...current.tasks, ...page.tasks],
					warnings: [.../* @__PURE__ */ new Set([...current.warnings, ...page.warnings])].slice(0, MAX_WARNINGS$1)
				};
			});
			setBusy(false);
		}, (reason) => {
			if (next.signal.aborted || ticket !== generation.current) return;
			setError(reason instanceof Error ? reason.message : String(reason));
			setBusy(false);
		});
	}, [list]);
	useEffect(() => {
		generation.current += 1;
		controller.current?.abort();
		setResult(void 0);
		setError(void 0);
		setBusy(false);
		setQuery("");
		if (!expanded) return;
		if (!canList) return;
		readPage(0, true);
		return () => {
			controller.current?.abort();
		};
	}, [
		expanded,
		reload,
		canList,
		sessionId,
		readPage
	]);
	const position = useAnchoredPosition({
		open: expanded,
		anchorRef: rootRef,
		panelRef,
		gap: MENU_GAP,
		margin: VIEWPORT_MARGIN
	});
	useDismissOnOutsidePointer(rootRef, expanded, setExpanded, panelRef);
	const close = useCallback(() => {
		setExpanded(false);
		triggerRef.current?.focus();
	}, []);
	const openDocument = useCallback((path, file) => {
		open(path, file);
		setExpanded(false);
		triggerRef.current?.focus();
	}, [open]);
	const refresh = useCallback(() => {
		setReload((value) => value + 1);
	}, []);
	const loadMore = useCallback(() => {
		if (busy || result === void 0 || result.pending === 0) return;
		readPage(result.nextOffset, false);
	}, [
		busy,
		readPage,
		result
	]);
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
	return /* @__PURE__ */ jsxs("div", {
		ref: rootRef,
		onKeyDown,
		className: styles.root,
		children: [/* @__PURE__ */ jsx(ProjectOpsTrigger, {
			t,
			open: expanded,
			count: result?.tasks.length,
			triggerRef,
			onToggle: () => {
				setExpanded((value) => !value);
			}
		}), expanded ? createPortal(/* @__PURE__ */ jsx(ProjectOpsPanel, {
			t,
			open: true,
			position,
			measureStyle: MEASURE_STYLE,
			panelRef,
			result,
			error,
			busy,
			availability,
			query,
			onQuery: setQuery,
			onRefresh: refresh,
			onLoadMore: loadMore,
			onClose: close,
			onOpen: openDocument
		}), document.body) : null]
	});
}
//#endregion
//#region src/client/index.tsx
/**
* Required client services: only the slot registry and the dictionaries.
*
* The file remotes and the native preview stay optional: a cordis 4.x plugin
* `inject` entry is a hard activation requirement, so listing them here would
* remove the whole Project Ops entry from a Host that lacks one of them.
*/
const inject = ["slots", "locale"];
/** Optional native services, named exactly as the kernel names them. */
const OPTIONAL_SERVICES = ["remote.workspaceFiles", "sidebarRight"];
/** Whether a live service actually exposes every method this panel calls. */
function hasMethods(service, members) {
	if (typeof service !== "object" || service === null) return false;
	const face = service;
	return members.every((member) => typeof face[member] === "function");
}
/**
* Optional-service accessor of one plugin activation.
*
* `ctx.get(name)` is the kernel's documented accessor **without the inject
* requirement**: it looks the service up by its full name in the isolate store
* (so the nested service's own name, `remote.workspaceFiles`, is the key), and
* its strict default returns `undefined` while the providing fiber is inactive.
* Reading the nested property off `ctx.remote` instead goes through the
* namespace accessor, which requires that exact name to be injected and throws
* `cannot get property "remote.workspaceFiles" without inject` otherwise — the
* failure that removed the whole Project Ops entry from the official alpha.5
* Web build.
*
* Nothing is cached here: a deactivated provider must not keep reporting as
* available, and the kernel already answers that question per call.
*/
function optionalServices(ctx) {
	return { 
	/** The service, or `undefined` when this Host does not currently provide it. */
get(name) {
		return ctx.get(name);
	} };
}
/** Candidate directories examined by one read; the next batch starts right after them. */
const BATCH = 32;
/** Requests at most in flight; one inaccessible entry never hides the others. */
const READ_CONCURRENCY = 4;
/** Bytes read per document; the document contract rejects larger files. */
const DOCUMENT_BYTES = 131072;
/** Directory warnings kept per page. */
const MAX_WARNINGS = 5;
/** Bounded display length of a read-problem message. */
const MAX_PROBLEM = 300;
/** The dated managed layout; a directory that does not match is shown as legacy. */
const MANAGED_DIRECTORY = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u;
/** Run `work` over `items` with a fixed number of workers, honouring cancellation. */
async function pool(items, limit, work) {
	const results = new Array(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await work(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}
/** Bound one diagnostic message for display. */
function messageOf(error) {
	return (error instanceof Error ? error.message : String(error)).slice(0, MAX_PROBLEM);
}
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
	const optional = optionalServices(ctx);
	const workspaceFiles = () => {
		const service = optional.get("remote.workspaceFiles");
		return hasMethods(service, ["list", "readBytes"]) ? service : void 0;
	};
	const preview = () => {
		const service = optional.get("sidebarRight");
		return hasMethods(service, ["openResource"]) ? service : void 0;
	};
	ctx.effect(() => ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
		name: "conversation.session.header.actions",
		id: "@missher/dsh-project-ops",
		locale: NS,
		order: 140,
		inject: (sessionId) => {
			let snapshot;
			return {
				surface: () => ({
					list: workspaceFiles() !== void 0,
					preview: preview() !== void 0
				}),
				/**
				* Read one bounded batch of deliveries.
				* @param signal - caller cancellation.
				* @param options - `offset` into the Host's `docs/tasks` candidate list.
				* @returns this batch's rows (the root row only on the first batch), the next offset and warnings.
				*/
				async list(signal, options) {
					const files = workspaceFiles();
					if (files === void 0) throw new Error("the workspace-files remote (remote.workspaceFiles.list/readBytes) is unavailable on this Host");
					const offset = Math.max(0, Math.floor(options?.offset ?? 0));
					/** List one directory; `undefined` when it does not exist. */
					const listDir = async (path) => {
						const listing = await files.list(sessionId, path, signal);
						if (listing.ok) return listing.value;
						if (listing.error.code === "workspace-file/not-found") return void 0;
						throw new Error(listing.error.message);
					};
					/** Read one document; absence is not an error, and one bad document never hides the other. */
					const readDoc = async (path) => {
						try {
							const response = await files.readBytes(sessionId, path, { range: {
								offset: 0,
								length: DOCUMENT_BYTES
							} }, signal);
							if (!response.ok) return response.error.code === "workspace-file/not-found" ? { missing: true } : { problem: messageOf(response.error.message) };
							if (!response.value.eof) return { problem: "document is larger than the 128 KiB read limit" };
							return { text: new TextDecoder("utf-8", { fatal: true }).decode(response.value.data) };
						} catch (error) {
							signal.throwIfAborted();
							return { problem: messageOf(error) };
						}
					};
					/**
					* Turn one real directory listing into a row.
					*
					* Presence comes from that listing; a truncated listing is probed
					* directly so a PLAN/READY entry is not crowded out by other files.
					* Each document read is isolated: a broken PLAN still yields the READY
					* title, and a PLAN that does not exist is never enabled.
					*/
					const examine = async (origin, name, path, listing) => {
						signal.throwIfAborted();
						const has = (file) => listing.entries.some((entry) => entry.type === "file" && entry.name === file);
						const join = (file) => origin === "root" ? file : `${path}/${file}`;
						let plan = has("PLAN.md");
						let ready = has("READY.md");
						let planText;
						let readyText;
						const problems = [];
						const readPlan = async () => {
							const result = await readDoc(join("PLAN.md"));
							if ("text" in result) planText = result.text;
							else if ("missing" in result) plan = false;
							else problems.push(result.problem);
						};
						const readReady = async () => {
							const result = await readDoc(join("READY.md"));
							if ("text" in result) readyText = result.text;
							else if ("missing" in result) ready = false;
							else problems.push(result.problem);
						};
						if (plan) await readPlan();
						if (ready) await readReady();
						if (listing.truncated) {
							if (!plan) {
								const probe = await readDoc(join("PLAN.md"));
								if ("text" in probe) {
									plan = true;
									planText = probe.text;
								} else if ("problem" in probe) problems.push(probe.problem);
							}
							if (!ready) {
								const probe = await readDoc(join("READY.md"));
								if ("text" in probe) {
									ready = true;
									readyText = probe.text;
								} else if ("problem" in probe) problems.push(probe.problem);
							}
						}
						if (!plan && !ready && problems.length === 0) return void 0;
						const status = await documentStatus(origin === "root" ? "." : name, planText, readyText);
						const title = status.title ?? headingTitle(planText) ?? headingTitle(readyText);
						const link = {
							id: name,
							path,
							origin,
							legacy: origin === "tasks" && !MANAGED_DIRECTORY.test(name),
							plan,
							ready,
							delivery: status.delivery,
							managed: status.managed,
							artifacts: status.artifacts
						};
						if (status.damaged === true) link.damaged = true;
						if (status.artifactsTruncated === true) link.artifactsTruncated = true;
						if (status.verification !== void 0) link.verification = status.verification;
						if (status.verificationTruncated === true) link.verificationTruncated = true;
						if (title !== void 0) link.title = title;
						const problem = problems[0];
						if (problem !== void 0) link.problem = problem;
						return link;
					};
					if (offset === 0 || snapshot === void 0 || snapshot.sessionId !== sessionId) {
						const captured = {
							sessionId,
							candidates: [],
							truncated: false,
							warnings: []
						};
						try {
							const rootListing = await listDir(".");
							if (rootListing !== void 0) {
								const rootRow = await examine("root", ".", ".", rootListing);
								if (rootRow !== void 0) captured.rootRow = rootRow;
							}
						} catch (error) {
							signal.throwIfAborted();
							captured.warnings.push(messageOf(error));
						}
						try {
							const tasksListing = await listDir("docs/tasks");
							if (tasksListing !== void 0) {
								captured.truncated = tasksListing.truncated;
								captured.candidates = tasksListing.entries.filter((entry) => entry.type === "directory" && entry.name.length > 0).sort((left, right) => left.name < right.name ? 1 : left.name > right.name ? -1 : 0).map((entry) => entry.name);
							}
						} catch (error) {
							signal.throwIfAborted();
							captured.warnings.push(messageOf(error));
						}
						signal.throwIfAborted();
						snapshot = captured;
					}
					const current = snapshot;
					const candidates = current?.candidates ?? [];
					const batch = candidates.slice(offset, offset + 32);
					const found = (await pool(batch, READ_CONCURRENCY, async (name) => {
						const path = `docs/tasks/${name}`;
						try {
							const listing = await listDir(path);
							if (listing === void 0) return void 0;
							return await examine("tasks", name, path, listing);
						} catch (error) {
							signal.throwIfAborted();
							return {
								id: name,
								path,
								origin: "tasks",
								legacy: !MANAGED_DIRECTORY.test(name),
								plan: false,
								ready: false,
								delivery: "inspect",
								managed: false,
								artifacts: [],
								problem: messageOf(error)
							};
						}
					})).filter((row) => row !== void 0);
					const nextOffset = Math.min(offset + batch.length, candidates.length);
					return {
						tasks: offset === 0 && current?.rootRow !== void 0 ? [current.rootRow, ...found] : found,
						nextOffset,
						total: candidates.length,
						pending: Math.max(0, candidates.length - nextOffset),
						truncated: current?.truncated ?? false,
						warnings: offset === 0 ? (current?.warnings ?? []).slice(0, MAX_WARNINGS) : []
					};
				},
				open: (path, file) => {
					preview()?.openResource(sessionFileAddress(sessionId, path === "." ? file : `${path}/${file}`));
				}
			};
		}
	}, ProjectOpsAction)));
}
//#endregion
export { BATCH, OPTIONAL_SERVICES, apply, inject, optionalServices };
