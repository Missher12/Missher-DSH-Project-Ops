import { Context } from "@deepseek-ai/cordis";
//#region src/client/locales.d.ts
/** Simplified Chinese dictionary (the key-set source of truth). */
declare const zh: {
  readonly categories: "分类";
  readonly 'category.all': "全部";
  readonly 'category.plans': "方案";
  readonly 'category.word': "Word";
  readonly 'category.excel': "Excel";
  readonly 'category.slides': "PPT";
  readonly 'category.pdf': "PDF";
  readonly 'category.image': "图片";
  readonly 'category.media': "音视频";
  readonly 'category.other': "其他";
  readonly 'category.search': "搜索";
  readonly 'search.empty': "暂无搜索记录";
  readonly 'search.unavailable': "此宿主无搜索记录";
  readonly 'search.error': "读取失败：{error}";
  readonly 'search.failed': "搜索失败：{error}";
  readonly 'search.section': "搜索";
  readonly 'search.openedSection': "已打开网页";
  readonly 'search.zero': "无命中";
  readonly 'search.incomplete': "结果不完整（共 {total} 条）";
  readonly 'search.historyTruncated': "仅显示最近 50 次搜索";
  readonly 'search.mode.glob': "文件名";
  readonly 'search.mode.grep': "内容";
  readonly 'search.mode.web_search': "网页";
  readonly 'search.mode.web_fetch': "网页";
  readonly 'search.mode.session_search': "会话";
  readonly 'search.mode.session_event_search': "会话";
  readonly 'search.inSession': "结果见会话";
  readonly 'files.loading': "加载中…";
  readonly 'files.empty': "暂无文件";
  readonly 'files.unavailable': "此宿主无文件索引，仍可在聊天查看";
  readonly 'files.error': "读取失败：{error}";
  readonly 'files.openError': "无法打开：{error}";
  readonly 'files.denied': "没有访问该文件的权限";
  readonly 'files.reveal': "打开位置";
  readonly 'files.revealAria': "在访达中显示：{name}";
  readonly 'files.revealMissing': "文件已移动或删除";
  readonly 'files.revealUnsupported': "此宿主不支持显示文件位置";
  readonly 'files.revealError': "无法显示位置：{error}";
  readonly 'files.truncated': "仅显示最近 1000 个文件";
  readonly title: "Project Ops";
  readonly 'trigger.label': "Project Ops";
  readonly 'trigger.aria': "项目方案与文件：{count} 项";
  readonly 'trigger.ariaEmpty': "项目方案与文件";
  readonly refresh: "刷新";
  readonly close: "关闭";
  readonly count: "{count} 项";
  readonly loading: "加载中…";
  readonly empty: "暂无开发任务";
  readonly error: "无法读取项目任务";
  readonly errorDetail: "读取失败：{error}";
  readonly retry: "重试";
  readonly truncated: "仅显示最近 100 项";
  readonly 'status.current': "交付关联当前方案";
  readonly 'status.currentHint': "交付记录与当前方案修订一致；不代表验收通过、发布或安装。";
  readonly 'status.historical': "方案已更新";
  readonly 'status.historicalHint': "交付记录对应更早的方案修订，保留为历史事实。";
  readonly 'status.inspect': "记录待核对";
  readonly 'status.inspectHint': "记录无法校验完整关联，请自行核对内容。";
  readonly 'status.missing': "方案进行中";
  readonly 'status.missingHint': "方案已保存，尚无交付记录；方案存在不代表完成、验收或发布。";
  readonly footer: "会话文件 · 项目方案";
  readonly 'unavailable.list': "此宿主无工作区文件读取能力";
  readonly 'unavailable.listDetail': "缺少 remote.workspaceFiles 的 list / readBytes";
  readonly 'unavailable.preview': "此宿主无原生文件预览";
  readonly 'unavailable.previewDetail': "缺少 sidebarRight.openResource";
  readonly 'view.plan': "方案";
  readonly 'view.ready': "交付记录";
  readonly 'view.missingPlan': "尚未生成方案";
  readonly 'view.missingReady': "尚未生成交付记录";
};
/** Dictionary key domain of this namespace. */
type ProjectOpsKey = keyof typeof zh;
//#endregion
//#region src/client/document-status.d.ts
/** Read-only browser hints. Hash linkage is freshness evidence, not delivery acceptance. */
type DeliveryState = 'current' | 'historical' | 'inspect' | 'missing';
//#endregion
//#region src/client/task-view.d.ts
/** One discovered task directory with its document presence and freshness. */
interface TaskLink {
  /** Directory name under `docs/tasks`, the task identity. */
  id: string;
  /** `PLAN.md` exists and is readable. */
  plan: boolean;
  /** `READY.md` exists and is readable. */
  ready: boolean;
  /** Chinese task title read from the plan record, when it was readable. */
  title?: string;
  /** Freshness of the delivery record against the current plan revision. */
  delivery: DeliveryState;
}
/** One bounded read result. */
interface TaskListResult {
  tasks: TaskLink[];
  /** The workspace listing itself was truncated, or more than 100 tasks exist. */
  truncated: boolean;
}
//#endregion
//#region src/client/index.d.ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Key domain of the `projectOps` namespace declared by {@link NS}. */
    projectOps: ProjectOpsKey;
  }
}
/**
 * Required client services: only the slot registry and the dictionaries.
 *
 * The file remotes and the native preview stay optional: a cordis 4.x plugin
 * `inject` entry is a hard activation requirement, so listing them here would
 * remove the whole Project Ops entry from a Host that lacks one of them.
 */
declare const inject: string[];
/** Optional native services, named exactly as the kernel names them. */
declare const OPTIONAL_SERVICES: readonly ["remote.workspaceFiles", "sidebarRight", "remote.session", "sessions"];
type OptionalService = typeof OPTIONAL_SERVICES[number];
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
declare function optionalServices(ctx: Context): {
  /** The service, or `undefined` when this Host does not currently provide it. */
  get(name: OptionalService): unknown;
};
/**
 * Register the dictionaries, the stylesheet and the session-header action.
 * @param ctx - client root context.
 */
declare function apply(ctx: Context): void;
//#endregion
export { OPTIONAL_SERVICES, OptionalService, type TaskLink, type TaskListResult, apply, inject, optionalServices };