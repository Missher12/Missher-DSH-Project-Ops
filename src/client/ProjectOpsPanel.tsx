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
  IconDeliverDocRegular, IconInspectOutlineRegular, IconRefreshOutlineRegular, StateDot,
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
  /** Native preview availability; when absent both actions stay visible but disabled. */
  preview: PreviewAvailability
  onOpen: (task: string, file: 'PLAN.md' | 'READY.md') => void
}

/** Optional native capabilities this Host exposes to the panel. */
export interface PanelAvailability {
  /** The workspace-files remote is present, so tasks can be listed at all. */
  list: boolean
  /** The native right-sidebar preview service is present. */
  preview: boolean
  /** Why listing is impossible, when it is. */
  listReason?: string
  /** Why previewing is impossible, when it is. */
  previewReason?: string
}

/** Preview half of {@link PanelAvailability}, narrowed for one row. */
export interface PreviewAvailability {
  available: boolean
  reason: string
}

/**
 * One task: Chinese title first, delivery state beside it, the directory id in
 * the row's `title` (and as the primary line only when no title was readable),
 * and the two document actions on the trailing edge.
 * @param props - locale, discovered task and the preview opener.
 * @returns the list item.
 */
export function ProjectOpsRow({ t, task, preview, onOpen }: RowProps): ReactElement {
  const view = taskView(task)
  const statusHint = t(view.hint)
  const planDisabled = view.planDisabled || !preview.available
  const readyDisabled = view.readyDisabled || !preview.available
  const planTitle = !preview.available ? preview.reason : view.planDisabled ? t('view.missingPlan') : `${t('view.plan')} · ${task.id}/PLAN.md`
  const readyTitle = !preview.available ? preview.reason : view.readyDisabled ? t('view.missingReady') : `${t('view.ready')} · ${task.id}/READY.md`
  return (
    <li className={styles.row} title={`${task.id} · ${statusHint}`} data-task={task.id}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitle} title={view.hasTitle ? view.title : undefined}>
          {view.hasTitle ? view.title : <span className={styles.rowId}>{view.id}</span>}
        </div>
        <div className={styles.rowMeta}>
          <StateDot state={view.dot} className={styles.rowDot} />
          {/* The amber stays on the dot: the warning label color does not meet
              the contrast the status text needs in the light theme. */}
          <span className={styles.rowStatus} title={statusHint}>{t(view.status)}</span>
          <span className={styles.rowActions}>
            <button
              type="button"
              className={styles.action}
              disabled={planDisabled}
              title={planTitle}
              onClick={() => { onOpen(task.id, 'PLAN.md') }}
            >
              <IconChecklistOutlineRegular size={12} className={styles.actionIcon} />
              <span>{t('view.plan')}</span>
            </button>
            <button
              type="button"
              className={styles.action}
              disabled={readyDisabled}
              title={readyTitle}
              onClick={() => { onOpen(task.id, 'READY.md') }}
            >
              <IconDeliverDocRegular size={12} className={styles.actionIcon} />
              <span>{t('view.ready')}</span>
            </button>
          </span>
        </div>
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
  /** Optional native capabilities observed on this Host. */
  availability: PanelAvailability
  onRefresh: () => void
  onClose: () => void
  onOpen: (task: string, file: 'PLAN.md' | 'READY.md') => void
}

/** One notice line for a capability this Host does not expose; the service name stays in the tooltip. */
function UnavailableNotice({ text, detail }: { text: string; detail: string }): ReactElement {
  return (
    <div className={styles.notice} role="status" title={detail}>
      <IconInspectOutlineRegular size={14} />
      <span>{text}</span>
    </div>
  )
}

/**
 * The panel surface: compact title line with refresh/close, one short read-only
 * hint, then the loading, empty, error, truncated or task-list body.
 * @param props - locale, placement, read state and the panel actions.
 * @returns the portaled panel, or `null` while closed.
 */
export function ProjectOpsPanel(props: PanelProps): ReactElement | null {
  const { t, open, position, measureStyle, panelRef, result, error, busy, availability, onRefresh, onClose, onOpen } = props
  if (!open) return null
  const preview = { available: availability.preview, reason: availability.previewReason ?? t('unavailable.preview') }
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
          {availability.list && result !== undefined ? t('count', { count: result.tasks.length }) : ''}
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
      {!availability.list
        ? <UnavailableNotice text={availability.listReason ?? t('unavailable.list')} detail={t('unavailable.listDetail')} />
        : null}
      {availability.list && error !== undefined
        ? (
          <div className={classNames(styles.notice, styles.noticeError)} role="alert">
            <IconInspectOutlineRegular size={14} />
            <span>{t('errorDetail', { error })}</span>
            <button type="button" className={classNames(styles.action, styles.noticeAction)} onClick={onRefresh}>{t('retry')}</button>
          </div>
        )
        : null}
      {availability.list && error === undefined && result === undefined
        ? (
          <div className={styles.skeleton} role="status" aria-label={t('loading')}>
            <span className={classNames(styles.skeletonLine, styles.skeletonLineShort)} />
            <span className={styles.skeletonLine} />
            <span className={classNames(styles.skeletonLine, styles.skeletonLineShort)} />
          </div>
        )
        : null}
      {availability.list && error === undefined && result !== undefined && result.tasks.length === 0
        ? (
          <div className={styles.notice} role="status">
            <IconArchiveOutlineRegular size={14} />
            <span>{t('empty')}</span>
          </div>
        )
        : null}
      {availability.list && error === undefined && result !== undefined && result.tasks.length > 0
        ? (
          <ul className={styles.list}>
            {result.tasks.map(task => <ProjectOpsRow key={task.id} t={t} task={task} preview={preview} onOpen={onOpen} />)}
          </ul>
        )
        : null}
      {availability.list && error === undefined && result?.truncated === true
        ? (
          <div className={styles.notice}>{t('truncated')}</div>
        )
        : null}
      <footer className={styles.footer} title={t('footer')}>{t('footer')}</footer>
    </section>
  )
}
