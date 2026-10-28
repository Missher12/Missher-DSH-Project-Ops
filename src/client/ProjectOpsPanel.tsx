/**
 * Presentational half of the Project Ops header action.
 *
 * Hook-free by design: the shell owns state, reads, cursors and dismissal, and
 * passes everything rendered here. That is also what lets the tests call these
 * components directly and walk the returned element tree without a DOM.
 *
 * Three views share the surface: deliveries of the current project, deliveries
 * of every registered project, and a project's file artifacts read from real
 * directory listings. File rows never pretend to be session-produced without
 * persistent evidence, and binaries are never decoded or executed.
 */
import type { CSSProperties, ReactElement, RefObject } from 'react'
import {
  IconArchiveOutlineRegular, IconChecklistOutlineRegular, IconChevronDownOutlineRegular, IconCloseOutlineRegular,
  IconDeliverDocRegular, IconInspectOutlineRegular, IconRefreshOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { isExternalTarget } from '../production.ts'
import {
  FILE_ROOTS, fileKind, filterFiles, formatSize, isExecutable, previewKind,
  type FileKind, type FilesPage, type ProjectOption,
} from './files.ts'
import { NS, type ProjectOpsKey } from './locales.ts'
import { classNames, styles } from './styles.ts'
import {
  filterGroups, filterTasks, productionKindKey, productionOutcomeKey, taskView,
  type OverviewResult, type ProjectGroup, type TaskLink, type TaskListResult,
} from './task-view.ts'

/** Translate seat of this namespace, as injected by the slot framework. */
export type PanelTranslate = TranslateNS<typeof NS>

/** The three top-level views. */
export type PanelScope = 'current' | 'all' | 'files'

/** Locale keys of the file-kind labels. */
const KIND_KEYS: Record<FileKind, ProjectOpsKey> = {
  directory: 'files.kind.directory',
  image: 'files.kind.image',
  pdf: 'files.kind.pdf',
  sheet: 'files.kind.sheet',
  document: 'files.kind.document',
  archive: 'files.kind.archive',
  executable: 'files.kind.executable',
  binary: 'files.kind.binary',
  text: 'files.kind.text',
  other: 'files.kind.other',
}

/** Props of the session-header trigger. */
export interface TriggerProps {
  t: PanelTranslate
  open: boolean
  /** Discovered task count once a read succeeded. */
  count: number | undefined
  /** Slot is narrow: keep the icon and the accessible name only. */
  narrow?: boolean
  triggerRef: RefObject<HTMLButtonElement>
  onToggle: () => void
}

/**
 * Session-header entry. In a narrow slot it collapses to the icon; the full name
 * stays in the accessible label and tooltip, and the button keeps its identity
 * and focus because only its children change.
 * @param props - locale, open state, count, narrow state, anchor ref and toggle.
 * @returns the trigger button.
 */
export function ProjectOpsTrigger({ t, open, count, narrow, triggerRef, onToggle }: TriggerProps): ReactElement {
  const label = count === undefined ? t('trigger.ariaEmpty') : t('trigger.aria', { count })
  return (
    <button
      ref={triggerRef}
      type="button"
      className={classNames(styles.trigger, narrow === true && styles.triggerNarrow)}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <IconChecklistOutlineRegular size={14} className={styles.triggerIcon} />
      {narrow === true ? null : <span className={styles.triggerLabel}>{t('trigger.label')}</span>}
      {narrow === true ? null : <IconChevronDownOutlineRegular size={12} className={classNames(styles.triggerChevron, open && styles.triggerChevronOpen)} />}
    </button>
  )
}

/** Props of one delivery row. */
export interface RowProps {
  t: PanelTranslate
  task: TaskLink
  /** Native preview availability; when absent both actions stay visible but disabled. */
  preview: PreviewAvailability
  onOpen: (path: string, file: 'PLAN.md' | 'READY.md', sessionId?: string) => void
}

/** Optional native capabilities this Host exposes to the panel. */
export interface PanelAvailability {
  list: boolean
  preview: boolean
  projects: boolean
  /** Directory listings are readable (same remote as delivery reads). */
  files: boolean
  listReason?: string
  previewReason?: string
}

/** Preview half of {@link PanelAvailability}, narrowed for one row. */
export interface PreviewAvailability {
  available: boolean
  reason: string
}

/** Props of the portaled panel. */
export interface PanelProps {
  t: PanelTranslate
  open: boolean
  position: CSSProperties | null
  measureStyle: CSSProperties
  panelRef: RefObject<HTMLElement>
  scope: PanelScope
  onScope: (scope: PanelScope) => void
  result: TaskListResult | undefined
  overview: OverviewResult | undefined
  files: FilesPage | undefined
  fileRoot: string
  filePath: string
  fileProject: string | undefined
  fileProjects: readonly ProjectOption[]
  error: string | undefined
  busy: boolean
  availability: PanelAvailability
  query: string
  onQuery: (value: string) => void
  onRefresh: () => void
  onLoadMore: () => void
  onLoadMoreGroup: (workspaceId: string, offset: number) => void
  onFileRoot: (root: string) => void
  onFileProject: (workspaceId: string | undefined) => void
  onFileOpenDir: (path: string) => void
  onFileUp: () => void
  onFileOpen: (path: string, sessionId?: string) => void
  onClose: () => void
  onOpen: (path: string, file: 'PLAN.md' | 'READY.md', sessionId?: string) => void
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

/** Structured production facts of one managed delivery, labelled as a session report. */
function ProductionBlock({ t, task }: { t: PanelTranslate, task: TaskLink }): ReactElement | null {
  if (!task.managed) return null
  const view = taskView(task)
  const shown = view.productionStale ? [] : view.production.slice(0, 5)
  return (
    <div className={styles.production} title={t('production.hint')}>
      <span className={styles.productionLabel}>{t('production.label')}</span>
      {view.productionStale ? <span className={styles.productionNote}>{t('production.stale')}</span> : null}
      {shown.length === 0 && !view.productionStale
        ? <span className={styles.productionNote}>{t('production.missing')}</span>
        : shown.map((entry, index) => (
          <div key={`${entry.kind}:${entry.name}:${index}`} className={styles.productionEntry}>
            <span className={styles.productionKind}>{t(productionKindKey(entry.kind))}</span>
            <span>{entry.name}</span>
            {entry.version === undefined ? null : <span className={styles.productionNote}>v{entry.version}</span>}
            {entry.outcome === undefined ? null : <span className={styles.productionOutcome}>{t(productionOutcomeKey(entry.outcome))}</span>}
            {entry.target === undefined ? null : (
              <span className={styles.productionTarget} title={entry.target}>
                {isExternalTarget(entry.target) ? t('production.external') : entry.target}
              </span>
            )}
            {entry.summary === undefined ? null : <span className={styles.productionNote}>{entry.summary}</span>}
            {entry.environment === undefined ? null : <span className={styles.productionNote}>env={entry.environment}</span>}
            {entry.platform === undefined ? null : <span className={styles.productionNote}>{entry.platform}</span>}
            <span className={styles.productionNote}>{t('production.recorded', { source: entry.source, time: entry.recordedAt })}</span>
          </div>
        ))}
      {view.production.length > shown.length
        ? <span className={styles.productionNote}>{t('production.more', { count: view.production.length - shown.length })}</span>
        : null}
      {view.productionRejected > 0
        ? <span className={styles.productionNote}>{t('production.rejected', { count: view.productionRejected })}</span>
        : null}
    </div>
  )
}

/**
 * One delivery: heading, relative location and provenance badges, production
 * facts, read problem, and the status plus document entries.
 * @param props - locale, discovered row and the preview opener.
 * @returns the list item.
 */
export function ProjectOpsRow({ t, task, preview, onOpen }: RowProps): ReactElement {
  const view = taskView(task)
  const statusHint = t(view.hint)
  const planDisabled = view.planDisabled || !preview.available
  const readyDisabled = view.readyDisabled || !preview.available
  const planTitle = !preview.available ? preview.reason : view.planDisabled ? t('view.missingPlan') : `${t('view.plan')} · ${task.path}/PLAN.md`
  const readyTitle = !preview.available ? preview.reason : view.readyDisabled ? t('view.missingReady') : `${t('view.ready')} · ${task.path}/READY.md`
  return (
    <li className={styles.row} title={`${task.path} · ${statusHint}`} data-task={task.id} data-path={task.path}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitle} title={view.hasTitle ? view.title : undefined}>
          {view.hasTitle
            ? view.title
            : view.titleKey === undefined ? <span className={styles.rowId}>{view.id}</span> : t(view.titleKey)}
        </div>
        <div className={styles.rowSource} title={t('source.hint', { path: view.source })}>
          <span className={styles.rowPath}>{view.source}</span>
          {view.badges.map(key => <span key={key} className={styles.badge}>{t(key)}</span>)}
        </div>
        <ProductionBlock t={t} task={task} />
        {view.artifacts.length > 0
          ? (
            <div className={styles.artifacts} title={t('artifacts.hint')}>
              <span className={styles.artifactsLabel}>{t('artifacts.label')}</span>
              {view.artifacts.map(artifact => <span key={artifact} className={styles.artifact}>{artifact}</span>)}
              {view.artifactsTruncated ? <span className={styles.artifactNote}>{t('summary.truncated')}</span> : null}
            </div>
          )
          : null}
        <div className={styles.verify} title={t('verify.hint')}>
          <span className={styles.verifyLabel}>{t('verify.label')}</span>
          <span className={styles.verifyText}>
            {view.verification === undefined ? t('verify.none') : view.verification}
            {view.verificationTruncated ? ` ${t('summary.truncated')}` : ''}
          </span>
        </div>
        {view.problem === undefined
          ? null
          : <div className={styles.rowProblem}>{t('problem.text', { error: view.problem })}</div>}
        <div className={styles.rowMeta}>
          <StateDot state={view.dot} className={styles.rowDot} />
          <span className={styles.rowStatus} title={statusHint}>{t(view.status)}</span>
          <span className={styles.rowActions}>
            <button type="button" className={styles.action} disabled={planDisabled} title={planTitle}
              onClick={() => { onOpen(task.path, 'PLAN.md', task.sessionId) }}>
              <IconChecklistOutlineRegular size={12} className={styles.actionIcon} />
              <span>{t('view.plan')}</span>
            </button>
            <button type="button" className={styles.action} disabled={readyDisabled} title={readyTitle}
              onClick={() => { onOpen(task.path, 'READY.md', task.sessionId) }}>
              <IconDeliverDocRegular size={12} className={styles.actionIcon} />
              <span>{t('view.ready')}</span>
            </button>
          </span>
        </div>
      </div>
    </li>
  )
}

/** One registered project section in the all-projects view. */
function ProjectSection({ t, group, rows, preview, busy, onLoadMoreGroup, onOpen }: {
  t: PanelTranslate
  group: ProjectGroup
  /** Rows already selected for display by the shell-side project/task filter. */
  rows: TaskLink[]
  preview: PreviewAvailability
  busy: boolean
  onLoadMoreGroup: (workspaceId: string, offset: number) => void
  onOpen: (path: string, file: 'PLAN.md' | 'READY.md', sessionId?: string) => void
}): ReactElement {
  const statusLabel = group.status === 'no-session' ? t('project.noSession') : group.status === 'unreadable' ? t('project.unreadable') : undefined
  return (
    <section className={styles.project} data-project={group.workspaceId}>
      <header className={styles.projectHeader} title={group.path}>
        <span className={styles.projectTitle}>{group.title}</span>
        <span className={styles.projectStatus}>
          {group.status !== 'readable' || group.incomplete === true
            ? t('project.rowsUnknown')
            : t('project.rows', { count: group.rows.length })}
        </span>
      </header>
      <div className={styles.projectMeta}>
        <span>{group.path}</span>
        {statusLabel === undefined ? null : <span>{statusLabel}</span>}
      </div>
      {group.reason === undefined ? null : <div className={styles.projectNote}>{t('problem.text', { error: group.reason })}</div>}
      {group.warnings.map(warning => (
        <div key={warning} className={styles.notice} role="status" title={warning}>
          <IconInspectOutlineRegular size={14} />
          <span>{t('problem.text', { error: warning })}</span>
        </div>
      ))}
      {group.truncated ? <div className={styles.projectNote}>{t('project.truncated')}</div> : null}
      {group.incomplete === true ? <div className={styles.projectNote}>{t('project.incomplete')}</div> : null}
      {rows.length === 0
        ? (group.status === 'readable' && group.rows.length === 0 && group.incomplete !== true
          ? <div className={styles.projectNote}>{t('empty')}</div>
          : null)
        : (
          <ul className={styles.list}>
            {rows.map(task => (
              <ProjectOpsRow key={`${task.origin}:${task.id}`} t={t} task={task} preview={preview} onOpen={onOpen} />
            ))}
          </ul>
        )}
      {group.pending > 0
        ? (
          <div className={styles.projectMore}>
            <button type="button" className={styles.more} disabled={busy}
              onClick={() => { onLoadMoreGroup(group.workspaceId, group.nextOffset) }}>
              {t('more')} · {t('pending', { count: group.pending })}
            </button>
          </div>
        )
        : null}
    </section>
  )
}

/** One directory row of the files view, with only actions this Host can honour. */
function FileRow({ t, entry, preview, onOpenDir, onOpenFile }: {
  t: PanelTranslate
  entry: FilesPage['entries'][number]
  preview: PreviewAvailability
  onOpenDir: (path: string) => void
  onOpenFile: (path: string, sessionId?: string) => void
}): ReactElement {
  const kind = fileKind(entry.name, entry.type)
  const previewable = entry.type === 'file' && previewKind(entry.name) !== undefined
  const executable = entry.type === 'file' && isExecutable(entry.name)
  return (
    <li className={styles.filesEntry} data-path={entry.path} title={entry.path}>
      <span className={styles.filesKind}>{t(KIND_KEYS[kind])}</span>
      <span className={styles.filesName}>{entry.name}</span>
      <span className={styles.filesSize}>{entry.type === 'directory' ? '' : formatSize(entry.size)}</span>
      <span className={styles.filesActions}>
        {entry.type === 'directory'
          ? (
            <button type="button" className={styles.more} onClick={() => { onOpenDir(entry.path) }}>
              {t('files.openDir')}
            </button>
          )
          : previewable
            ? (
              <button type="button" className={styles.more} disabled={!preview.available} title={preview.available ? entry.path : preview.reason}
                onClick={() => { onOpenFile(entry.path, entry.sessionId) }}>
                {t('files.preview')}
              </button>
            )
            : <span className={styles.filesNote}>{executable ? t('files.executable') : t('files.noPreview')}</span>}
      </span>
      <span className={styles.filesPathText}>{entry.path}</span>
    </li>
  )
}

/** The files view: root switcher, project selector, breadcrumb, notes and rows. */
function FilesView({ t, page, root, path, project, projects, query, busy, preview, onRoot, onProject, onOpenDir, onUp, onMore, onOpenFile }: {
  t: PanelTranslate
  page: FilesPage | undefined
  root: string
  path: string
  project: string | undefined
  projects: readonly ProjectOption[]
  query: string
  busy: boolean
  preview: PreviewAvailability
  onRoot: (root: string) => void
  onProject: (workspaceId: string | undefined) => void
  onOpenDir: (path: string) => void
  onUp: () => void
  onMore: () => void
  onOpenFile: (path: string, sessionId?: string) => void
}): ReactElement {
  const entries = page === undefined ? [] : filterFiles(page.entries, query)
  return (
    <div className={styles.files}>
      <div className={styles.filesBar} role="group" aria-label={t('files.roots')}>
        {FILE_ROOTS.map(value => (
          <button key={value} type="button"
            className={classNames(styles.filesRoot, value === root && styles.filesRootActive)}
            aria-pressed={value === root}
            onClick={() => { onRoot(value) }}>
            {value === '.' ? t('files.root') : value}
          </button>
        ))}
      </div>
      {projects.length > 0
        ? (
          <label className={styles.filesCrumb}>
            <span>{t('files.project')}</span>
            <select value={project ?? ''} onChange={event => { onProject(event.currentTarget.value === '' ? undefined : event.currentTarget.value) }}>
              <option value="">{t('files.currentProject')}</option>
              {projects.map(option => <option key={option.workspaceId} value={option.workspaceId}>{option.title}</option>)}
            </select>
          </label>
        )
        : null}
      <div className={styles.filesCrumb}>
        <span className={styles.filesPathText}>{path === '.' ? '/' : path}</span>
        {page === undefined ? null : <span className={styles.filesSize}>{t('files.count', { count: page.total })}</span>}
        {path === root ? null : <button type="button" className={styles.more} onClick={onUp}>{t('files.up')}</button>}
      </div>
      <div className={styles.filesNote}>{t('files.attribution')}</div>
      <div className={styles.filesNote}>{t('files.presentedUnavailable')}</div>
      {page?.missing === true ? <div className={styles.notice} role="status">{t('files.missing')}</div> : null}
      {page?.truncated === true ? <div className={styles.filesNote}>{t('files.truncated')}</div> : null}
      {page?.warnings.map(warning => (
        <div key={warning} className={styles.notice} role="status" title={warning}>{t('problem.text', { error: warning })}</div>
      ))}
      {page !== undefined && entries.length === 0 && page.missing !== true
        ? <div className={styles.notice} role="status">{query.trim().length === 0 ? t('files.empty') : t('search.empty')}</div>
        : null}
      {entries.length > 0
        ? (
          <ul className={styles.filesList}>
            {entries.map(entry => (
              <FileRow key={entry.path} t={t} entry={entry} preview={preview} onOpenDir={onOpenDir} onOpenFile={onOpenFile} />
            ))}
          </ul>
        )
        : null}
      {page !== undefined && page.nextOffset < page.total
        ? (
          <div className={styles.projectMore}>
            <button type="button" className={styles.more} disabled={busy} onClick={onMore}>
              {t('files.more')} · {page.nextOffset}/{page.total}
            </button>
          </div>
        )
        : null}
    </div>
  )
}

/**
 * The panel surface: title line with refresh/close, the view switch, the local
 * search field, then the loading, empty, error or content body of the active view.
 * @param props - locale, placement, all three views, filter and panel actions.
 * @returns the portaled panel, or `null` while closed.
 */
export function ProjectOpsPanel(props: PanelProps): ReactElement | null {
  const {
    t, open, position, measureStyle, panelRef, scope, onScope, result, overview, files,
    fileRoot, filePath, fileProject, fileProjects, error, busy, availability, query, onQuery,
    onRefresh, onLoadMore, onLoadMoreGroup, onFileRoot, onFileProject, onFileOpenDir, onFileUp,
    onFileOpen, onClose, onOpen,
  } = props
  if (!open) return null
  const canProjects = availability.list && availability.projects
  const canFiles = availability.list && availability.files
  const preview = { available: availability.preview, reason: availability.previewReason ?? t('unavailable.preview') }
  const currentVisible = result === undefined ? [] : filterTasks(result.tasks, query)
  const allGroups = overview === undefined ? [] : filterGroups(overview.groups, query)
  const activeReady = scope === 'current' ? result !== undefined : scope === 'all' ? overview !== undefined : files !== undefined
  const totalLoaded = scope === 'current' ? (result?.tasks.length ?? 0) : scope === 'all' ? (overview?.totalProjects ?? 0) : (files?.total ?? 0)
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
          {activeReady
            ? scope === 'current' ? t('count', { count: totalLoaded }) : scope === 'all' ? t('scope.projectsCount', { count: totalLoaded }) : t('files.count', { count: totalLoaded })
            : ''}
        </span>
        <button type="button" className={styles.iconButton} aria-label={t('refresh')} title={t('refresh')} onClick={onRefresh}>
          <IconRefreshOutlineRegular size={14} className={busy ? styles.spin : undefined} />
        </button>
        <button type="button" className={styles.iconButton} aria-label={t('close')} title={t('close')} onClick={onClose}>
          <IconCloseOutlineRegular size={14} />
        </button>
      </header>
      <div className={styles.scope} role="group" aria-label={t('scope.aria')}>
        <button type="button" className={classNames(styles.scopeButton, scope === 'current' && styles.scopeButtonActive)}
          aria-pressed={scope === 'current'} onClick={() => { onScope('current') }}>
          {t('scope.current')}
        </button>
        <button type="button" className={classNames(styles.scopeButton, scope === 'all' && styles.scopeButtonActive)}
          aria-pressed={scope === 'all'} disabled={!canProjects} title={canProjects ? undefined : t('unavailable.projects')}
          onClick={() => { onScope('all') }}>
          {t('scope.all')}
        </button>
        <button type="button" className={classNames(styles.scopeButton, scope === 'files' && styles.scopeButtonActive)}
          aria-pressed={scope === 'files'} disabled={!canFiles} title={canFiles ? undefined : t('unavailable.list')}
          onClick={() => { onScope('files') }}>
          {t('scope.files')}
        </button>
      </div>
      {!availability.list
        ? <UnavailableNotice text={availability.listReason ?? t('unavailable.list')} detail={t('unavailable.listDetail')} />
        : null}
      {availability.list && scope === 'all' && !availability.projects
        ? <UnavailableNotice text={t('unavailable.projects')} detail={t('unavailable.projectsDetail')} />
        : null}
      {availability.list && scope === 'files' && !availability.files
        ? <UnavailableNotice text={t('unavailable.files')} detail={t('unavailable.listDetail')} />
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
      {availability.list && error === undefined && !activeReady
        ? (
          <div className={styles.skeleton} role="status" aria-label={t('loading')}>
            <span className={classNames(styles.skeletonLine, styles.skeletonLineShort)} />
            <span className={styles.skeletonLine} />
            <span className={classNames(styles.skeletonLine, styles.skeletonLineShort)} />
          </div>
        )
        : null}
      {availability.list && error === undefined && scope === 'current' && result !== undefined && result.tasks.length === 0
        && result.pending === 0 && result.warnings.length === 0
        ? (
          <div className={styles.notice} role="status">
            <IconArchiveOutlineRegular size={14} />
            <span>{t('empty')}</span>
          </div>
        )
        : null}
      {availability.list && error === undefined && scope !== 'all' && scope !== 'files' && activeReady
        ? (
          <div className={styles.toolbar}>
            <input className={styles.search} type="search" value={query}
              placeholder={t('search.placeholder')} aria-label={t('search.aria')}
              onChange={event => { onQuery(event.currentTarget.value) }} />
          </div>
        )
        : null}
      {availability.list && error === undefined && scope === 'current' && result !== undefined && result.tasks.length > 0
        ? (currentVisible.length === 0
          ? <div className={styles.notice} role="status">{t('search.empty')}</div>
          : (
            <ul className={styles.list}>
              {currentVisible.map(task => (
                <ProjectOpsRow key={`${task.origin}:${task.id}`} t={t} task={task} preview={preview} onOpen={onOpen} />
              ))}
            </ul>
          ))
        : null}
      {availability.list && error === undefined && scope === 'current' && result !== undefined
        ? result.warnings.map(warning => (
          <div key={warning} className={styles.notice} role="status" title={warning}>
            <IconInspectOutlineRegular size={14} />
            <span>{t('problem.text', { error: warning })}</span>
          </div>
        ))
        : null}
      {availability.list && error === undefined && scope === 'current' && result !== undefined && result.pending > 0
        ? (
          <div className={styles.projectMore}>
            <button type="button" className={styles.more} onClick={onLoadMore} disabled={busy}>
              {t('more')} · {t('pending', { count: result.pending })}
            </button>
          </div>
        )
        : null}
      {availability.list && error === undefined && scope === 'current' && result?.truncated === true
        ? <div className={styles.notice}>{t('truncated')}</div>
        : null}
      {availability.list && error === undefined && scope === 'all' && overview !== undefined
        ? (
          <>
            <div className={styles.toolbar}>
              <input className={styles.search} type="search" value={query}
                placeholder={t('search.placeholder')} aria-label={t('search.aria')}
                onChange={event => { onQuery(event.currentTarget.value) }} />
            </div>
            {overview.totalProjects === 0
              ? <div className={styles.notice} role="status">{t('empty.projects')}</div>
              : allGroups.length === 0
                ? <div className={styles.notice} role="status">{t('search.empty')}</div>
                : allGroups.map(({ group, rows }) => (
                  <ProjectSection key={group.workspaceId} t={t} group={group} rows={rows} preview={preview}
                    busy={busy} onLoadMoreGroup={onLoadMoreGroup} onOpen={onOpen} />
                ))}
            {overview.pendingProjects > 0
              ? (
                <div className={styles.projectMore}>
                  <button type="button" className={styles.more} onClick={onLoadMore} disabled={busy}>
                    {t('project.more')} · {t('project.pending', { count: overview.pendingProjects })}
                  </button>
                </div>
              )
              : null}
            {overview.warnings.map(warning => (
              <div key={warning} className={styles.notice} role="status" title={warning}>
                <IconInspectOutlineRegular size={14} />
                <span>{t('problem.text', { error: warning })}</span>
              </div>
            ))}
          </>
        )
        : null}
      {availability.list && error === undefined && scope === 'files'
        ? (
          <>
            <div className={styles.toolbar}>
              <input className={styles.search} type="search" value={query}
                placeholder={t('search.placeholder')} aria-label={t('search.aria')}
                onChange={event => { onQuery(event.currentTarget.value) }} />
            </div>
            <FilesView t={t} page={files} root={fileRoot} path={filePath} project={fileProject}
              projects={fileProjects} query={query} busy={busy} preview={preview}
              onRoot={onFileRoot} onProject={onFileProject} onOpenDir={onFileOpenDir}
              onUp={onFileUp} onMore={onLoadMore} onOpenFile={onFileOpen} />
          </>
        )
        : null}
      <footer className={styles.footer} title={t('footer')}>{t('footer')}</footer>
    </section>
  )
}
