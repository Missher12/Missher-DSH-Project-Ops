/**
 * Read-only view model of the delivery browser.
 *
 * Everything the panel decides visually lives here as pure functions, so the
 * rendering module stays thin and the freshness semantics stay testable without
 * a DOM. None of these functions claims acceptance: a linked delivery is
 * reported as a link, only a record that needs the human's own review earns an
 * attention color, and a plain (unmanaged) document is labelled as such instead
 * of being upgraded or hidden.
 */
import type { DeliveryState } from './document-status.ts'
import type { ProjectOpsKey } from './locales.ts'

/** Where one document pair was found. */
export type TaskOrigin = 'root' | 'tasks'

/** One discovered PLAN/READY pair anywhere under the workspace root or `docs/tasks`. */
export interface TaskLink {
  /** `.` for the workspace root, else the `docs/tasks` entry name. */
  id: string
  /** Workspace-relative directory of the documents: `.` or `docs/tasks/<id>`. */
  path: string
  origin: TaskOrigin
  /** The directory name does not use the dated managed layout. */
  legacy: boolean
  /** `PLAN.md` exists and was readable. */
  plan: boolean
  /** `READY.md` exists and was readable. */
  ready: boolean
  /** Managed title, or a plain document's first heading. */
  title?: string
  /** Freshness of the delivery record against the current plan revision. */
  delivery: DeliveryState
  /** The PLAN decoded to a valid Project Ops record for this directory. */
  managed: boolean
  /** Bounded artifact strings recorded by a licensed delivery report. */
  artifacts: readonly string[]
  /** At least one artifact summary was cut; the full record is in READY. */
  artifactsTruncated?: boolean
  /** The verification sentence recorded with the delivery, bounded. */
  verification?: string
  /** The verification sentence was cut; the full record is in READY. */
  verificationTruncated?: boolean
  /** A metadata header was present but invalid; the row is a review item. */
  damaged?: boolean
  /** Why this entry could not be read fully; the row stays visible. */
  problem?: string
}

/** One bounded batch of the delivery overview. */
export interface TaskListResult {
  /** Rows of this batch; the workspace root row only appears in the first batch. */
  tasks: TaskLink[]
  /** Offset of the next batch; equals `total` when the candidate list is exhausted. */
  nextOffset: number
  /** Candidate directories the Host listing exposed in total. */
  total: number
  /** Candidate directories that are not examined yet. */
  pending: number
  /** The Host's own directory listing hit its entry cap. */
  truncated: boolean
  /** Directory-level read failures that did not remove rows already found. */
  warnings: string[]
}

/** Dot semantics shared with the official primitives. */
export type DotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

/**
 * Dot state of every delivery freshness: neutral for the three states that are
 * plain metadata (linked, historical, not generated) and attention-amber for
 * the one state that asks the human to look. `done` is deliberately unused —
 * a linked delivery record is not an accepted, released or installed task.
 */
const DELIVERY_DOTS: Record<DeliveryState, DotState> = {
  current: 'idle',
  historical: 'idle',
  inspect: 'warning',
  missing: 'idle',
}

/** Visual + copy mapping of one delivery freshness state. */
export interface DeliveryView {
  statusKey: ProjectOpsKey
  hintKey: ProjectOpsKey
  dot: DotState
  /** Whether the state deserves the amber attention color. */
  attention: boolean
}

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
export function deliveryView(state: DeliveryState): DeliveryView {
  const dot = DELIVERY_DOTS[state]
  switch (state) {
    case 'current': return { statusKey: 'status.current', hintKey: 'status.currentHint', dot, attention: false }
    case 'historical': return { statusKey: 'status.historical', hintKey: 'status.historicalHint', dot, attention: false }
    case 'inspect': return { statusKey: 'status.inspect', hintKey: 'status.inspectHint', dot, attention: true }
    case 'missing': return { statusKey: 'status.missing', hintKey: 'status.missingHint', dot, attention: false }
  }
}

/** One row's resolved presentation. */
export interface TaskView {
  id: string
  path: string
  /** Primary line: the title, the directory id, or a localized label for the root. */
  title: string
  /** Whether the primary line is a real title rather than a fallback. */
  hasTitle: boolean
  /** Localized label to render instead of the id when there is no title (root only). */
  titleKey?: ProjectOpsKey
  /** Location and provenance, shown as the row's secondary line. */
  source: string
  /** Short badges describing provenance and metadata quality. */
  badges: ProjectOpsKey[]
  status: ProjectOpsKey
  hint: ProjectOpsKey
  dot: DotState
  attention: boolean
  /** Bounded artifact strings; their presence is not a release or install. */
  artifacts: readonly string[]
  /** The artifact summary was cut, so the row points at READY for the full record. */
  artifactsTruncated: boolean
  /**
   * The delivery record's own verification sentence, shown only when READY still
   * links to it. A damaged or missing READY never reuses an old acceptance claim.
   */
  verification?: string
  /** The verification sentence was cut, so the row points at READY. */
  verificationTruncated: boolean
  /** The PLAN carried an invalid metadata header. */
  damaged: boolean
  /** Why the entry is only partially readable, bounded for display. */
  problem?: string
  planDisabled: boolean
  readyDisabled: boolean
}

/**
 * Resolve one row.
 * @param task - discovered document pair.
 * @returns the row's text, badges, actions and evidence.
 */
export function taskView(task: TaskLink): TaskView {
  const view = deliveryView(task.delivery)
  const hasTitle = task.title !== undefined && task.title.trim().length > 0
  const badges: ProjectOpsKey[] = []
  if (task.origin === 'root') badges.push('badge.root')
  if (task.legacy) badges.push('badge.legacy')
  if (!task.managed) badges.push('badge.plain')
  const resolved: TaskView = {
    id: task.id,
    path: task.path,
    title: hasTitle ? task.title!.trim() : task.id,
    hasTitle,
    source: task.path,
    badges,
    status: view.statusKey,
    hint: view.hintKey,
    dot: view.dot,
    attention: view.attention,
    artifacts: task.managed ? task.artifacts : [],
    artifactsTruncated: task.managed && task.artifactsTruncated === true,
    verificationTruncated: task.delivery === 'current' || task.delivery === 'historical'
      ? task.verificationTruncated === true : false,
    damaged: task.damaged === true,
    planDisabled: !task.plan,
    readyDisabled: !task.ready,
  }
  if ((task.delivery === 'current' || task.delivery === 'historical') && task.managed && task.verification !== undefined) {
    resolved.verification = task.verification
  }
  if (!hasTitle && task.origin === 'root') resolved.titleKey = 'root.title'
  if (task.problem !== undefined) resolved.problem = task.problem.slice(0, 200)
  return resolved
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
export function filterTasks(tasks: readonly TaskLink[], query: string): TaskLink[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return [...tasks]
  return tasks.filter(task => [task.title ?? '', task.id, task.path].some(value => value.toLocaleLowerCase().includes(needle)))
}
