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
import type { FileOutcome } from './file-errors.ts'
import type { SearchEntry, SearchResult } from '../search-history.ts'
import type { RevealOutcome } from './reveal.ts'
import { classNames, styles } from './styles.ts'
import { taskView, type TaskLink, type TaskListResult } from './task-view.ts'
import { FILE_CATEGORIES, fileCategory, type FilesResult, type PanelCategory } from '../delivered-files.ts'

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
  category?: PanelCategory
  onCategory?: (category: PanelCategory) => void
  files?: FilesResult | undefined
  fileError?: string | undefined
  fileBusy?: boolean
  openingFile?: string | undefined
  /** Why the preview did not open: missing/denied get their own sentence. */
  openError?: { path: string; outcome: FileOutcome; message: string } | undefined
  onOpenFile?: (path: string) => void
  /** File whose "open location" request is in flight. */
  revealing?: string | undefined
  /** Why the last "open location" request did not reach the file manager. */
  revealError?: { path: string; outcome: RevealOutcome; message: string } | undefined
  onRevealFile?: (path: string) => void
  /** This session's native search history. */
  searches?: SearchResult | undefined
  searchError?: string | undefined
  searchBusy?: boolean
}

/** Last path segment of one delivered file, in either separator style. */
function baseName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path
}

/** Parent directory of one delivered file, kept verbatim apart from the basename. */
function parentPath(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut <= 0 ? path : path.slice(0, cut)
}

/** One short sentence for a preview refusal, in the panel's dictionary. */
function openFailureMessage(openError: { outcome?: FileOutcome; message: string }, t: PanelTranslate): string {
  if (openError.outcome === 'missing') return t('files.revealMissing')
  if (openError.outcome === 'denied') return t('files.denied')
  return t('files.openError', { error: openError.message })
}

/** One short sentence for a reveal refusal, in the panel's dictionary. */
function revealMessage(revealError: { outcome: RevealOutcome; message: string }, t: PanelTranslate): string {
  if (revealError.outcome === 'missing') return t('files.revealMissing')
  if (revealError.outcome === 'denied') return t('files.denied')
  if (revealError.outcome === 'unsupported') return t('files.revealUnsupported')
  return t('files.revealError', { error: revealError.message })
}

function DeliveredFileGroups({ t, files, fileError, fileBusy, openingFile, openError, onOpenFile, revealing, revealError, onRevealFile, category = 'all', availability }: PanelProps): ReactElement | null {
  if (category === 'plans' || category === 'search') return null
  if (files?.unavailable) return <div className={styles.notice}>{t('files.unavailable')}</div>
  // A background read keeps the last successful rows mounted, so their DOM
  // nodes (and any focused file button) survive; the loading notice is only the
  // state before the first result exists.
  if (!files) {
    if (fileError) return <div className={classNames(styles.notice, styles.noticeError)} role="alert">{t('files.error', { error: fileError })}</div>
    if (fileBusy) return <div className={styles.notice} role="status">{t('files.loading')}</div>
    return null
  }
  // The row keeps only the name and the open-location action; the full path and
  // the delivery note live in the name's tooltip. A directory line is added only
  // where two rows would otherwise share one visible name.
  const occurrences = new Map<string, number>()
  for (const file of files.files) occurrences.set(baseName(file.path), (occurrences.get(baseName(file.path)) ?? 0) + 1)
  const groups = FILE_CATEGORIES.filter(kind => category === 'all' || category === kind)
    .map(kind => ({ kind, rows: files.files.filter(file => fileCategory(file.path) === kind) })).filter(group => group.rows.length)
  return <>
    {fileError ? <div className={classNames(styles.notice, styles.noticeError)} role="alert">{t('files.error', { error: fileError })}</div> : null}
    {groups.length === 0 ? <div className={styles.notice}>{t('files.empty')}</div> : null}
    {groups.map(group => <section key={group.kind} aria-label={t(`category.${group.kind}`)}>
      <h3 className={styles.groupTitle}>{t(`category.${group.kind}`)}</h3>
      <ul className={styles.list}>
        {group.rows.map(file => {
          const name = baseName(file.path)
          const title = [availability.preview ? undefined : availability.previewReason ?? t('unavailable.preview'), file.path, file.description]
            .filter((line): line is string => typeof line === 'string' && line.length > 0).join('\n')
          return <li key={file.path} className={styles.row}>
          <div className={styles.rowMain}>
            <div className={styles.fileHead}>
              <button type="button" className={styles.fileButton}
                title={title}
                disabled={!availability.preview || openingFile === file.path || !onOpenFile}
                onClick={() => { onOpenFile?.(file.path) }}>
                <IconDeliverDocRegular size={14} className={styles.actionIcon} />
                <span className={styles.rowTitle}>{name}</span>
              </button>
              {onRevealFile
                ? (
                  <button type="button" className={styles.fileReveal}
                    title={t('files.reveal')}
                    aria-label={t('files.revealAria', { name })}
                    disabled={revealing === file.path}
                    onClick={() => { onRevealFile(file.path) }}>
                    {t('files.reveal')}
                  </button>
                )
                : null}
            </div>
            {(occurrences.get(name) ?? 0) > 1
              ? <span className={styles.filePath} title={file.path}>{parentPath(file.path)}</span>
              : null}
            {openError?.path === file.path ? <span className={classNames(styles.notice, styles.noticeError)} role="alert">{openFailureMessage(openError, t)}</span> : null}
            {revealError?.path === file.path ? <span className={classNames(styles.notice, styles.noticeError)} role="alert">{revealMessage(revealError, t)}</span> : null}
          </div>
        </li>})}
      </ul>
    </section>)}
    {files.truncated ? <div className={styles.notice}>{t('files.truncated')}</div> : null}
  </>
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
 * The search tab: one row per native glob/grep/web_search call and a separate
 * "opened pages" group for successful web_fetch calls. Local hits reuse the
 * delivered-file preview and reveal actions; web sources are plain http(s)
 * links, and a failed call is shown as a failure without any invented hits.
 */
function SearchHistoryView(props: PanelProps): ReactElement | null {
  const { t, searches, searchError, searchBusy, category, availability, openingFile, openError, onOpenFile, revealing, revealError, onRevealFile } = props
  if (category !== 'search') return null
  if (!searches) {
    if (searchError) return <div className={classNames(styles.notice, styles.noticeError)} role="alert">{t('search.error', { error: searchError })}</div>
    if (searchBusy) return <div className={styles.notice} role="status">{t('files.loading')}</div>
    return null
  }
  if (searches.unavailable) return <div className={styles.notice}>{t('search.unavailable')}</div>
  const entries = searches.searches
  // A failed fetch is a failed search, never an opened page.
  const queries = entries.filter(entry => entry.mode !== 'web_fetch' || entry.error !== undefined || entry.opened === undefined)
  const opened = entries.filter(entry => entry.mode === 'web_fetch' && entry.error === undefined && entry.opened !== undefined)
  const fileHits = (entry: SearchEntry): ReactElement => {
    // Every retained host hit stays visible and keyboard reachable; the panel no
    // longer hides the 9th+ file behind a non-interactive cap. Duplicate names
    // show their directory, as the delivered-file list does.
    const occurrences = new Map<string, number>()
    for (const path of entry.files) occurrences.set(baseName(path), (occurrences.get(baseName(path)) ?? 0) + 1)
    return <>
      {entry.files.map(path => <div key={path}>
        <div className={styles.fileHead}>
          <button type="button" className={styles.fileButton}
            title={path}
            disabled={!availability.preview || openingFile === path || !onOpenFile}
            onClick={() => { onOpenFile?.(path) }}>
            <IconDeliverDocRegular size={14} className={styles.actionIcon} />
            <span className={styles.rowTitle}>{baseName(path)}</span>
          </button>
          {onRevealFile
            ? (
              <button type="button" className={styles.fileReveal}
                title={t('files.reveal')}
                aria-label={t('files.revealAria', { name: baseName(path) })}
                disabled={revealing === path}
                onClick={() => { onRevealFile(path) }}>
                {t('files.reveal')}
              </button>
            )
            : null}
        </div>
        {(occurrences.get(baseName(path)) ?? 0) > 1
          ? <span className={styles.filePath} title={path}>{parentPath(path)}</span>
          : null}
      </div>)}
      {openError !== undefined && entry.files.includes(openError.path)
        ? <span className={classNames(styles.notice, styles.noticeError)} role="alert">{openFailureMessage(openError, t)}</span>
        : null}
      {revealError !== undefined && entry.files.includes(revealError.path)
        ? <span className={classNames(styles.notice, styles.noticeError)} role="alert">{revealMessage(revealError, t)}</span>
        : null}
    </>
  }
  const sourceHits = (entry: SearchEntry): ReactElement | null => {
    if (entry.sources.length === 0) return null
    return <>
      {entry.sources.map(source => <div key={source.url} className={styles.fileHead}>
        <a className={styles.fileButton} href={source.url} target="_blank" rel="noreferrer noopener" title={source.url}>{source.title}</a>
      </div>)}
    </>
  }
  const row = (entry: SearchEntry): ReactElement => <li key={entry.callId} className={styles.row}>
    <div className={styles.rowMain}>
      <div className={styles.fileHead}>
        <span className={styles.rowTitle} title={entry.query}>{entry.query}</span>
      </div>
      <span className={styles.filePath}>{t(`search.mode.${entry.mode}`)}</span>
      {entry.error !== undefined
        ? <span className={classNames(styles.notice, styles.noticeError)} role="alert">{t('search.failed', { error: entry.error })}</span>
        : null}
      {entry.opened !== undefined
        ? <div className={styles.fileHead}>
          <a className={styles.fileButton} href={entry.opened} target="_blank" rel="noreferrer noopener" title={entry.opened}>{entry.opened}</a>
        </div>
        : null}
      {fileHits(entry)}
      {sourceHits(entry)}
      {entry.truncated && entry.mode !== 'web_fetch'
        ? <span className={styles.notice}>{t('search.incomplete', { total: entry.total })}</span>
        : null}
      {(entry.mode === 'session_search' || entry.mode === 'session_event_search') && entry.error === undefined
        ? <span className={styles.notice}>{t('search.inSession')}</span>
        : null}
      {entry.error === undefined && entry.total === 0 && !entry.truncated && entry.files.length === 0 && entry.sources.length === 0 && entry.opened === undefined
        && entry.mode !== 'session_search' && entry.mode !== 'session_event_search'
        ? <span className={styles.notice}>{t('search.zero')}</span>
        : null}
    </div>
  </li>
  return <>
    {searchError !== undefined ? <div className={classNames(styles.notice, styles.noticeError)} role="alert">{t('search.error', { error: searchError })}</div> : null}
    {searches.truncated ? <div className={styles.notice}>{t('search.historyTruncated')}</div> : null}
    {entries.length === 0 ? <div className={styles.notice}>{t('search.empty')}</div> : null}
    {queries.length > 0
      ? <section aria-label={t('search.section')}>
        <h3 className={styles.groupTitle}>{t('search.section')}</h3>
        <ul className={styles.list}>{queries.map(row)}</ul>
      </section>
      : null}
    {opened.length > 0
      ? <section aria-label={t('search.openedSection')}>
        <h3 className={styles.groupTitle}>{t('search.openedSection')}</h3>
        <ul className={styles.list}>{opened.map(row)}</ul>
      </section>
      : null}
  </>
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
  const category = props.category ?? 'all'
  const showPlans = category === 'all' || category === 'plans'
  const count = category === 'search'
    ? (props.searches?.searches.length ?? 0)
    : (result?.tasks.length ?? 0) + (props.files?.files.length ?? 0)
  return (
    <section
      ref={panelRef}
      className={styles.menu}
      style={position ?? measureStyle}
      role="dialog"
      aria-label={t('title')}
      tabIndex={-1}
      aria-busy={busy || Boolean(props.fileBusy) || (category === 'search' && Boolean(props.searchBusy))}
    >
      <header className={styles.header}>
        <span className={styles.headerTitle}>{t('title')}</span>
        <span className={styles.headerCount}>
          {category === 'search'
            ? (props.searches !== undefined && !props.searches.unavailable ? t('count', { count }) : '')
            : (result !== undefined || props.files !== undefined && !props.files.unavailable ? t('count', { count }) : '')}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={onRefresh}
        >
          <IconRefreshOutlineRegular size={14} className={busy || props.fileBusy ? styles.spin : undefined} />
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
      {props.onCategory ? <nav className={styles.categories} aria-label={t('categories')}>
        {(['all', 'plans', 'search', ...FILE_CATEGORIES] as const).map(kind => <button key={kind} type="button" className={styles.action}
          aria-pressed={category === kind} onClick={() => { props.onCategory?.(kind) }}>{t(`category.${kind}`)}</button>)}
      </nav> : null}
      {category === 'search' ? <SearchHistoryView {...props} /> : null}
      <DeliveredFileGroups {...props} />
      {showPlans ? <>
      {props.files ? <h3 className={styles.groupTitle}>{t('category.plans')}</h3> : null}
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
      </> : null}
    </section>
  )
}
