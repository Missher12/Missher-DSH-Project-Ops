/**
 * Presentational half of the Project Ops header action.
 *
 * These components hold no state and no hooks: the shell in
 * `ProjectOpsAction.tsx` owns opening, anchoring, dismissal and the bounded
 * read, and passes everything rendered here as props. Keeping the tree
 * hook-free is also what lets the tests call the components directly and walk
 * the returned element tree without a DOM.
 */
import type { CSSProperties, ReactElement, RefObject } from 'react'
import {
  IconArchiveOutlineRegular, IconChecklistOutlineRegular, IconChevronDownOutlineRegular, IconCloseOutlineRegular,
  IconInspectOutlineRegular, IconRefreshOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { classNames, styles } from './styles.ts'
import { taskView, type TaskLink, type TaskListResult } from './task-view.ts'

/** Translate seat of this namespace, as injected by the slot framework. */
export type PanelTranslate = TranslateNS<typeof NS>

/** Props of the session-header trigger. */
export interface TriggerProps {
  t: PanelTranslate
  open: boolean
  /** Discovered task count once a read succeeded. */
  count: number | undefined
  triggerRef: RefObject<HTMLButtonElement>
  onToggle: () => void
}

/**
 * Session-header entry: a native 28px action button, not a browser default
 * button with a white face and a bevel.
 * @param props - locale, open state, optional count, anchor ref and toggle.
 * @returns the trigger button.
 */
export function ProjectOpsTrigger({ t, open, count, triggerRef, onToggle }: TriggerProps): ReactElement {
  const label = count === undefined ? t('trigger.ariaEmpty') : t('trigger.aria', { count })
  return (
    <button
      ref={triggerRef}
      type="button"
      className={styles.trigger}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <IconChecklistOutlineRegular size={14} className={styles.triggerIcon} />
      <span className={styles.triggerLabel}>{t('trigger.label')}</span>
      <IconChevronDownOutlineRegular size={12} className={classNames(styles.triggerChevron, open && styles.triggerChevronOpen)} />
    </button>
  )
}

/** Props of one task row. */
export interface RowProps {
  t: PanelTranslate
  task: TaskLink
  onOpen: (task: string, file: 'PLAN.md' | 'READY.md') => void
}

/**
 * One task: Chinese title first, delivery state beside it, the directory id in
 * the row's `title` (and as the primary line only when no title was readable),
 * and the two document actions on the trailing edge.
 * @param props - locale, discovered task and the preview opener.
 * @returns the list item.
 */
export function ProjectOpsRow({ t, task, onOpen }: RowProps): ReactElement {
  const view = taskView(task)
  const statusHint = t(view.hint)
  return (
    <li className={styles.row} title={`${task.id} · ${statusHint}`} data-task={task.id}>
      <StateDot state={view.dot} className={styles.rowDot} />
      <div className={styles.rowMain}>
        <div className={styles.rowPrimary}>
          {view.hasTitle
            ? <span className={styles.rowTitle}>{view.title}</span>
            : <span className={styles.rowId}>{view.id}</span>}
          <span className={classNames(styles.rowStatus, view.attention && styles.rowStatusWarn)}>{t(view.status)}</span>
        </div>
      </div>
      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.action}
          disabled={view.planDisabled}
          title={view.planDisabled ? t('view.missingPlan') : `${t('view.plan')} · ${task.id}/PLAN.md`}
          onClick={() => { onOpen(task.id, 'PLAN.md') }}
        >
          {t('view.plan')}
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={view.readyDisabled}
          title={view.readyDisabled ? t('view.missingReady') : `${t('view.ready')} · ${task.id}/READY.md`}
          onClick={() => { onOpen(task.id, 'READY.md') }}
        >
          {t('view.ready')}
        </button>
      </div>
    </li>
  )
}

/** Props of the portaled panel. */
export interface PanelProps {
  t: PanelTranslate
  open: boolean
  /** Fixed placement from the shared anchored-position hook; `null` before measurement. */
  position: CSSProperties | null
  /** Hidden-but-laid-out placement used for the first measurement. */
  measureStyle: CSSProperties
  panelRef: RefObject<HTMLElement>
  /** Read result, absent until the first read settles. */
  result: TaskListResult | undefined
  /** Read failure detail, absent when the last read succeeded. */
  error: string | undefined
  busy: boolean
  onRefresh: () => void
  onClose: () => void
  onOpen: (task: string, file: 'PLAN.md' | 'READY.md') => void
}

/**
 * The panel surface: compact title line with refresh/close, one short read-only
 * hint, then the loading, empty, error, truncated or task-list body.
 * @param props - locale, placement, read state and the panel actions.
 * @returns the portaled panel, or `null` while closed.
 */
export function ProjectOpsPanel(props: PanelProps): ReactElement | null {
  const { t, open, position, measureStyle, panelRef, result, error, busy, onRefresh, onClose, onOpen } = props
  if (!open) return null
  return (
    <section
      ref={panelRef}
      className={styles.menu}
      style={position ?? measureStyle}
      role="dialog"
      aria-label={t('title')}
      tabIndex={-1}
      aria-busy={busy}
    >
      <header className={styles.header}>
        <span className={styles.headerTitle}>{t('title')}</span>
        <span className={styles.headerCount}>
          {result === undefined ? '' : t('count', { count: result.tasks.length })}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={onRefresh}
        >
          <IconRefreshOutlineRegular size={14} className={busy ? styles.spin : undefined} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('close')}
          title={t('close')}
          onClick={onClose}
        >
          <IconCloseOutlineRegular size={14} />
        </button>
      </header>
      <p className={styles.hint}>{t('hint')}</p>
      {error !== undefined
        ? (
          <div className={classNames(styles.notice, styles.noticeError)} role="alert">
            <IconInspectOutlineRegular size={14} />
            <span>{t('errorDetail', { error })}</span>
            <button type="button" className={classNames(styles.action, styles.noticeAction)} onClick={onRefresh}>{t('retry')}</button>
          </div>
        )
        : null}
      {error === undefined && result === undefined
        ? (
          <div className={styles.skeleton} role="status" aria-label={t('loading')}>
            <span className={classNames(styles.skeletonLine, styles.skeletonLineShort)} />
            <span className={styles.skeletonLine} />
            <span className={classNames(styles.skeletonLine, styles.skeletonLineShort)} />
          </div>
        )
        : null}
      {error === undefined && result !== undefined && result.tasks.length === 0
        ? (
          <div className={styles.notice} role="status">
            <IconArchiveOutlineRegular size={14} />
            <span>{t('empty')}</span>
          </div>
        )
        : null}
      {error === undefined && result !== undefined && result.tasks.length > 0
        ? (
          <ul className={styles.list}>
            {result.tasks.map(task => <ProjectOpsRow key={task.id} t={t} task={task} onOpen={onOpen} />)}
          </ul>
        )
        : null}
      {error === undefined && result?.truncated === true
        ? (
          <div className={styles.notice}>{t('truncated')}</div>
        )
        : null}
    </section>
  )
}
