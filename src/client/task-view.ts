/**
 * Read-only view model of the task browser.
 *
 * Everything the panel decides visually lives here as pure functions, so the
 * rendering module stays thin and the four delivery freshness semantics stay
 * testable without a DOM. None of these functions claims acceptance: a linked
 * delivery is reported as a link, and only a record that needs the human's own
 * review earns an attention color. A metadata link is never painted as a
 * success.
 */
import type { DeliveryState } from './document-status.ts'
import type { ProjectOpsKey } from './locales.ts'

/** One discovered task directory with its document presence and freshness. */
export interface TaskLink {
  /** Directory name under `docs/tasks`, the task identity. */
  id: string
  /** `PLAN.md` exists and is readable. */
  plan: boolean
  /** `READY.md` exists and is readable. */
  ready: boolean
  /** Chinese task title read from the plan record, when it was readable. */
  title?: string
  /** Freshness of the delivery record against the current plan revision. */
  delivery: DeliveryState
}

/** One bounded read result. */
export interface TaskListResult {
  tasks: TaskLink[]
  /** The workspace listing itself was truncated, or more than 100 tasks exist. */
  truncated: boolean
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
  /** Primary line: the Chinese title, or the directory id when no title was readable. */
  title: string
  /** Whether the primary line is a real title rather than the id fallback. */
  hasTitle: boolean
  status: ProjectOpsKey
  hint: ProjectOpsKey
  dot: DotState
  attention: boolean
  planDisabled: boolean
  readyDisabled: boolean
}

/**
 * Resolve one task row.
 * @param task - discovered task with document presence.
 * @returns the row's text, dot and action availability.
 */
export function taskView(task: TaskLink): TaskView {
  const view = deliveryView(task.delivery)
  const hasTitle = task.title !== undefined && task.title.trim().length > 0
  return {
    id: task.id,
    title: hasTitle ? task.title!.trim() : task.id,
    hasTitle,
    status: view.statusKey,
    hint: view.hintKey,
    dot: view.dot,
    attention: view.attention,
    planDisabled: !task.plan,
    readyDisabled: !task.ready,
  }
}
