import { createHash } from 'node:crypto'

export const DOCUMENT_LIMIT = 128 * 1024
export const TASK_DIRECTORY = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u
export type TaskStatus = 'active' | 'failed' | 'cancelled' | 'reviewed'
export interface DevelopmentPlan {
  title: string
  requirements: string
  design: string
  steps: string[]
  acceptance: string[]
  progress: string
}
export interface DeliveryReport {
  implementation: string
  checks: { criterion: string; status: 'reported-pass' | 'failed' | 'unverified'; evidence: string }[]
  artifacts: string[]
  git: string
  release: string
  installation: string
  limitations: string[]
  rollback: string
}
export interface TaskRecord {
  format: 1
  taskId: string
  sessionId: string
  originCallId: string
  created: string
  revision: number
  status: TaskStatus
  plan: DevelopmentPlan
  previousReadyHash?: string
  delivery?: { report: DeliveryReport; verification: string; readyHash: string }
}
export function digest(text: string): string { return createHash('sha256').update(text).digest('hex') }

/** The complete PLAN field set. `begin` requires all of them; `update` accepts any subset. */
export const PLAN_FIELDS = ['title', 'requirements', 'design', 'steps', 'acceptance', 'progress'] as const

/** Upper bounds the validators enforce; values are rejected, never truncated. */
const TEXT_LIMIT = 16000
const ITEM_LIMIT = 80

/** What a caller actually passed, named so an error can say "received null" instead of just "invalid". */
function received(value: unknown): string {
  if (value === undefined) return 'nothing (field absent)'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `a ${typeof value}`
}

function object(value: unknown, label = 'data'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}: expected an object, received ${received(value)}.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}: expected a string, received ${received(value)}. Provide 1–${TEXT_LIMIT} characters.`)
  if (!value.trim()) throw new Error(`Invalid ${label}: the string is empty. Provide 1–${TEXT_LIMIT} characters.`)
  if (value.length > TEXT_LIMIT) throw new Error(`Invalid ${label}: ${value.length} characters exceeds the ${TEXT_LIMIT}-character limit. Shorten the value; it is never truncated for you.`)
  if (value.includes('\u0000')) throw new Error(`Invalid ${label}: the string contains a NUL character. Remove it and retry.`)
  return value
}
function texts(value: unknown, label: string, empty = false): string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected an array of strings, received ${received(value)}. Provide ${empty ? 0 : 1}–${ITEM_LIMIT} items.`)
  if (value.length > ITEM_LIMIT) throw new Error(`Invalid ${label}: ${value.length} items exceeds the ${ITEM_LIMIT}-item limit. Remove items; they are never truncated for you.`)
  if (!empty && value.length === 0) throw new Error(`Invalid ${label}: at least 1 item is required.`)
  return value.map((item, index) => text(item, `${label}[${index}]`))
}
export function parsePlan(value: unknown): DevelopmentPlan {
  const row = object(value)
  const result = { title: text(row.title, 'title'), requirements: text(row.requirements, 'requirements'), design: text(row.design, 'design'), steps: texts(row.steps, 'steps'), acceptance: texts(row.acceptance, 'acceptance'), progress: text(row.progress, 'progress') }
  if (new Set(result.acceptance).size !== result.acceptance.length) throw new Error('Invalid acceptance: criteria must be unique.')
  return result
}

/**
 * Merge a partial PLAN update over the record read at `expectedRevision`.
 *
 * Only an **absent** field (`undefined`) keeps its current value, so an update
 * carrying just `progress` no longer has to repeat the title. `null`, an empty
 * value, a wrong type and an unknown field are rejected with the field name: a
 * typo can never look like a successful update, and nothing is fabricated or
 * truncated. A full six-field object behaves exactly like {@link parsePlan}.
 * @param current - the plan stored in the record read before this update.
 * @param value - the partial or complete PLAN object supplied by the caller.
 * @returns the merged plan, validated as a whole.
 */
export function mergePlan(current: DevelopmentPlan, value: unknown): DevelopmentPlan {
  const row = object(value)
  const unknown = Object.keys(row).filter(key => !(PLAN_FIELDS as readonly string[]).includes(key))
  if (unknown.length > 0) {
    throw new Error(`Unknown PLAN field(s): ${unknown.join(', ')}. Allowed fields: ${PLAN_FIELDS.join(', ')}. Omit a field to keep its current value.`)
  }
  const field = <K extends keyof DevelopmentPlan>(key: K, parse: (input: unknown, label: string) => DevelopmentPlan[K]): DevelopmentPlan[K] =>
    row[key] === undefined ? current[key] : parse(row[key], key)
  const result: DevelopmentPlan = {
    title: field('title', text),
    requirements: field('requirements', text),
    design: field('design', text),
    steps: field('steps', (input, label) => texts(input, label)),
    acceptance: field('acceptance', (input, label) => texts(input, label)),
    progress: field('progress', text),
  }
  if (new Set(result.acceptance).size !== result.acceptance.length) throw new Error('Invalid acceptance: criteria must be unique.')
  return result
}
export function parseReport(value: unknown, plan: DevelopmentPlan): DeliveryReport {
  const row = object(value)
  if (!Array.isArray(row.checks) || row.checks.length !== plan.acceptance.length) throw new Error('Report every PLAN acceptance criterion exactly once')
  const checks = row.checks.map(item => {
    const check = object(item)
    const criterion = text(check.criterion, 'criterion')
    const status = check.status
    if (!['reported-pass', 'failed', 'unverified'].includes(String(status))) throw new Error('Check status must distinguish reported-pass, failed, and unverified')
    return { criterion, status: status as DeliveryReport['checks'][number]['status'], evidence: text(check.evidence, 'evidence') }
  })
  if (new Set(checks.map(c => c.criterion)).size !== checks.length || checks.some(c => !plan.acceptance.includes(c.criterion))) throw new Error('Report criteria differ from PLAN')
  return { implementation: text(row.implementation, 'implementation'), checks, artifacts: texts(row.artifacts, 'artifacts', true), git: text(row.git, 'git'), release: text(row.release, 'release'), installation: text(row.installation, 'installation'), limitations: texts(row.limitations, 'limitations', true), rollback: text(row.rollback, 'rollback') }
}
const bullets = (values: string[]): string => values.length ? values.map(v => `- ${v}`).join('\n') : '- 无'
export function planBody(record: TaskRecord): string {
  const p = record.plan
  return `# Project Ops · ${p.title}\n\n任务：${record.taskId}\n会话：${record.sessionId}\n创建调用：${record.originCallId}\n状态：${record.status}；修订：${record.revision}\n\n## 需求\n\n${p.requirements}\n\n## 方案\n\n${p.design}\n\n## 步骤\n\n${bullets(p.steps)}\n\n## 验收标准\n\n${bullets(p.acceptance)}\n\n## 实际进展与下一步\n\n${p.progress}\n\n${record.delivery ? `交付记录： [查看交付](./READY.md)；${record.delivery.verification}` : '尚未生成交付记录。生成方案后继续已授权开发，不增加审批步骤。'}\n`
}
/** One atomic PLAN contains its complete restart state; the checksum detects manual edits. */
export function encodePlan(record: TaskRecord): string {
  const body = planBody(record)
  const encoded = `[project-ops-v1]: <data:application/json;base64,${Buffer.from(JSON.stringify({ record, bodyHash: digest(body) })).toString('base64')}>\n\n${body}`
  if (Buffer.byteLength(encoded) > DOCUMENT_LIMIT) throw new Error('Task document exceeds 128 KiB')
  return encoded
}
export function decodePlan(content: string): TaskRecord {
  if (Buffer.byteLength(content) > DOCUMENT_LIMIT) throw new Error('Task document exceeds 128 KiB')
  const match = /^\[project-ops-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>\n\n/u.exec(content)
  if (!match) throw new Error('Unmanaged PLAN: preserve manual content')
  const data = object(JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8')))
  const raw = object(data.record)
  if (raw.format !== 1 || typeof raw.taskId !== 'string' || !TASK_DIRECTORY.test(raw.taskId) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || !['active', 'failed', 'cancelled', 'reviewed'].includes(String(raw.status))) throw new Error('Invalid managed PLAN state')
  const record: TaskRecord = { format: 1, taskId: raw.taskId, sessionId: text(raw.sessionId, 'sessionId'), originCallId: text(raw.originCallId, 'originCallId'), created: text(raw.created, 'created'), revision: Number(raw.revision), status: raw.status as TaskStatus, plan: parsePlan(raw.plan) }
  if (raw.previousReadyHash !== undefined) record.previousReadyHash = text(raw.previousReadyHash, 'previousReadyHash')
  if (raw.delivery !== undefined) {
    const delivery = object(raw.delivery)
    record.delivery = { report: parseReport(delivery.report, record.plan), verification: text(delivery.verification, 'verification'), readyHash: text(delivery.readyHash, 'readyHash') }
  }
  const body = content.slice(match[0].length)
  if (data.bodyHash !== digest(body) || body !== planBody(record)) throw new Error('PLAN manually edited or inconsistent: preserve it and reconcile before retrying')
  return record
}
export function readyBody(record: TaskRecord, report: DeliveryReport, verification: string): string {
  return `# Project Ops · ${record.plan.title} · 交付记录\n\n任务：${record.taskId}\n会话：${record.sessionId}\n关联方案修订：${record.revision}\n[查看方案](./PLAN.md)\n\n本记录由当前开发会话显式提交；不是回复结束或命令退出自动判定。验收文字为会话报告，原生回执验证另列。文档生成不代表已发布、已安装或所有平台已通过。\n\n## 实现\n\n${report.implementation}\n\n## 验收报告\n\n${report.checks.map(c => `- ${c.criterion}：${c.status}\n  证据：${c.evidence}`).join('\n')}\n\n## 原生回执验证\n\n${verification}\n\n## 产物\n\n${bullets(report.artifacts)}\n\n## Git\n\n${report.git}\n\n## 发布\n\n${report.release}\n\n## 安装\n\n${report.installation}\n\n## 未完成项与限制\n\n${bullets(report.limitations)}\n\n## 使用与回退\n\n${report.rollback}\n`
}

/** READY carries enough checked metadata to recover a READY-first interrupted commit. */
export function encodeReady(record: TaskRecord, report: DeliveryReport, verification: string): string {
  const body = readyBody(record, report, verification)
  const metadata = { planHash: digest(encodePlan(record)), reportHash: digest(JSON.stringify(report)), verification, bodyHash: digest(body) }
  return `[project-ops-ready-v1]: <data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}>\n\n${body}`
}
/** Reuse only the exact generated record for this unchanged PLAN and delivery input. */
export function recoverReady(content: string, record: TaskRecord, report: DeliveryReport): string | undefined {
  const match = /^\[project-ops-ready-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>\n\n/u.exec(content)
  if (!match) return undefined
  let data: Record<string, unknown>
  try { data = object(JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8'))) } catch { return undefined }
  if (data.planHash !== digest(encodePlan(record)) || data.reportHash !== digest(JSON.stringify(report)) || typeof data.verification !== 'string') return undefined
  return content === encodeReady(record, report, data.verification) ? data.verification : undefined
}
