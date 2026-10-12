import { Context } from "@deepseek-ai/cordis";
//#region src/client/locales.d.ts
/** Simplified Chinese dictionary (the key-set source of truth). */
declare const zh: {
  readonly title: "Project Ops";
  readonly 'trigger.label': "Project Ops";
  readonly 'trigger.aria': "项目任务与交付记录：{count} 项";
  readonly 'trigger.ariaEmpty': "项目任务与交付记录";
  readonly refresh: "刷新";
  readonly close: "关闭";
  readonly count: "{count} 项";
  readonly hint: "交付记录只保留历史事实；文件存在不代表已发布或安装。";
  readonly loading: "正在读取项目任务…";
  readonly empty: "尚无开发任务。向当前会话说明开发需求后，Agent 会按任务规模维护方案与交付记录。";
  readonly error: "无法读取项目任务";
  readonly errorDetail: "读取失败，未修改任何文件：{error}";
  readonly retry: "重试";
  readonly truncated: "任务较多，仅显示最近 100 项。";
  readonly 'status.current': "交付关联当前方案";
  readonly 'status.currentHint': "仅表示交付记录与当前方案修订一致，不代表验收通过。";
  readonly 'status.historical': "历史交付：方案已更新";
  readonly 'status.historicalHint': "交付记录对应更早的方案修订，保留为历史事实。";
  readonly 'status.inspect': "待核对：可能已编辑或中断";
  readonly 'status.inspectHint': "记录无法校验完整关联，请自行核对内容。";
  readonly 'status.missing': "尚未生成交付";
  readonly 'status.missingHint': "方案已存在，尚无交付记录。";
  readonly 'view.plan': "查看方案";
  readonly 'view.ready': "查看交付";
  readonly 'view.missingPlan': "尚未生成方案";
  readonly 'view.missingReady': "尚未生成交付记录";
  readonly 'notice.caption': "只读提示";
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
/** Required client services: slots, dictionaries, the file remotes and the native preview. */
declare const inject: string[];
/**
 * Register the dictionaries, the stylesheet and the session-header action.
 * @param ctx - client root context.
 */
declare function apply(ctx: Context): void;
//#endregion
export { type TaskLink, type TaskListResult, apply, inject };