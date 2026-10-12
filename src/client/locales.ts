/**
 * `projectOps` namespace dictionaries for the session-header task browser.
 *
 * Wording rule: a delivery record that is linked to the current plan revision
 * is reported as a link, never as an acceptance or a release. The panel says
 * what the files are, not what the task achieved.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'projectOps'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': 'Project Ops',
  'trigger.label': 'Project Ops',
  'trigger.aria': '项目任务与交付记录：{count} 项',
  'trigger.ariaEmpty': '项目任务与交付记录',
  'refresh': '刷新',
  'close': '关闭',
  'count': '{count} 项',
  'hint': '交付记录只保留历史事实；文件存在不代表已发布或安装。',
  'loading': '正在读取项目任务…',
  'empty': '尚无开发任务。向当前会话说明开发需求后，Agent 会按任务规模维护方案与交付记录。',
  'error': '无法读取项目任务',
  'errorDetail': '读取失败，未修改任何文件：{error}',
  'retry': '重试',
  'truncated': '任务较多，仅显示最近 100 项。',
  'status.current': '交付关联当前方案',
  'status.currentHint': '仅表示交付记录与当前方案修订一致，不代表验收通过。',
  'status.historical': '历史交付：方案已更新',
  'status.historicalHint': '交付记录对应更早的方案修订，保留为历史事实。',
  'status.inspect': '待核对：可能已编辑或中断',
  'status.inspectHint': '记录无法校验完整关联，请自行核对内容。',
  'status.missing': '尚未生成交付',
  'status.missingHint': '方案已存在，尚无交付记录。',
  'view.plan': '查看方案',
  'view.ready': '查看交付',
  'view.missingPlan': '尚未生成方案',
  'view.missingReady': '尚未生成交付记录',
  'notice.caption': '只读提示',
} as const

/** English dictionary; the key set must match {@link zh}. */
export const en: Record<keyof typeof zh, string> = {
  'title': 'Project Ops',
  'trigger.label': 'Project Ops',
  'trigger.aria': 'Project tasks and delivery records: {count}',
  'trigger.ariaEmpty': 'Project tasks and delivery records',
  'refresh': 'Refresh',
  'close': 'Close',
  'count': '{count}',
  'hint': 'Delivery records keep historical facts; a file does not mean released or installed.',
  'loading': 'Loading project tasks…',
  'empty': 'No development tasks yet. Describe your development request in this session; the agent maintains documents when the task warrants them.',
  'error': 'Could not read project tasks',
  'errorDetail': 'Read failed, no file was changed: {error}',
  'retry': 'Retry',
  'truncated': 'Showing the 100 most recent tasks.',
  'status.current': 'Delivery linked to current plan',
  'status.currentHint': 'The delivery record matches the current plan revision; that is not an acceptance.',
  'status.historical': 'Historical delivery: plan updated',
  'status.historicalHint': 'The delivery record belongs to an earlier plan revision and stays as history.',
  'status.inspect': 'Review needed: edited or interrupted',
  'status.inspectHint': 'The record cannot be fully linked; check its contents yourself.',
  'status.missing': 'No delivery yet',
  'status.missingHint': 'A plan exists, no delivery record yet.',
  'view.plan': 'View plan',
  'view.ready': 'View delivery',
  'view.missingPlan': 'No plan yet',
  'view.missingReady': 'No delivery record yet',
  'notice.caption': 'Read-only hint',
}

/** Dictionary key domain of this namespace. */
export type ProjectOpsKey = keyof typeof zh
