/**
 * Stateful half of the Project Ops header action.
 *
 * Owns the three bounded reads (current project deliveries, every registered
 * project, and a project's file artifacts), opening and dismissal, viewport
 * placement of the portaled panel, responsive trigger state, and keyboard
 * traversal. Every read carries a generation ticket: refresh, session, scope or
 * directory changes invalidate older responses so a stale page can never be
 * appended to, or replace, the current view.
 *
 * The trigger collapses to its icon when the header slot is narrow. It measures
 * the slot container (never its own collapsed width) with hysteresis, so
 * collapsing cannot feed back into the measurement and flutter at the breakpoint.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { parentPath, type FilesPage, type ProjectOption } from './files.ts'
import { ProjectOpsPanel, ProjectOpsTrigger, type PanelAvailability, type PanelScope } from './ProjectOpsPanel.tsx'
import { styles } from './styles.ts'
import type { OverviewResult, TaskListResult } from './task-view.ts'

/** Kept for callers of the previous two-state shape. */
export type Scope = PanelScope

/** Registration-side business face: bounded reads, project list and native openers. */
export interface Face {
  /**
   * Optional native capabilities observed on this Host, evaluated per render so
   * a service that appears later is picked up without reloading the plugin.
   */
  surface: () => { list: boolean; preview: boolean; projects: boolean; files: boolean }
  /**
   * Read one bounded batch of the current project.
   * @param signal - caller cancellation.
   * @param options - `offset` of the batch; omit for the first one.
   */
  list: (signal: AbortSignal, options?: { offset?: number }) => Promise<TaskListResult>
  /** Read the registered-project overview, or one project's next batch. */
  overview: (signal: AbortSignal, options?: {
    projectOffset?: number
    group?: { workspaceId: string, offset: number }
  }) => Promise<OverviewResult>
  /** Read the registered projects (no per-project document reads). */
  projects: (signal: AbortSignal) => Promise<ProjectOption[]>
  /** Read one bounded page of one project directory. */
  files: (signal: AbortSignal, options?: {
    root?: string
    path?: string
    offset?: number
    project?: string
  }) => Promise<FilesPage>
  /** Observe native registry readiness; returns an unsubscribe cleanup. */
  observe: (onChange: () => void) => () => void
  /** Open one document in the native right-sidebar file preview, through its producing session. */
  open: (path: string, file: 'PLAN.md' | 'READY.md', sessionId?: string) => void
  /** Open one previewable project file in the native right-sidebar preview. */
  openFile: (path: string, sessionId?: string) => void
}

/** Full props of the session-header action. */
export type ProjectOpsActionProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'projectOps'> & Face

/** Minimum gap kept between the panel and the viewport edges. */
const VIEWPORT_MARGIN = 12

/** Distance between the trigger's bottom edge and the panel. */
const MENU_GAP = 5

/** Unplaced panel: hidden but laid out, so the first placement measures real dimensions. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Keyboard-reachable controls inside the panel, in document order. */
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Directory warnings kept in the accumulated view. */
const MAX_WARNINGS = 5

/** Collapse the trigger below this slot width; expand only above the higher bound. */
const TRIGGER_COLLAPSE_AT = 120
const TRIGGER_EXPAND_AT = 168

/**
 * Render the header action.
 * @param props - locale seat, session id, and the injected read/preview face.
 * @returns the trigger plus, while open, the portaled panel.
 */
export function ProjectOpsAction({
  t, surface, list, overview, projects, files, observe, open, openFile, sessionId,
}: ProjectOpsActionProps) {
  const [expanded, setExpanded] = useState(false)
  const [reload, setReload] = useState(0)
  const [scope, setScope] = useState<PanelScope>('current')
  const [result, setResult] = useState<TaskListResult>()
  const [overviewResult, setOverviewResult] = useState<OverviewResult>()
  const [filesPage, setFilesPage] = useState<FilesPage>()
  const [fileProjects, setFileProjects] = useState<readonly ProjectOption[]>([])
  const [fileRoot, setFileRoot] = useState('.')
  const [filePath, setFilePath] = useState('.')
  const [fileProject, setFileProject] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [narrow, setNarrow] = useState(false)
  const availability: PanelAvailability = surface()
  const canList = availability.list
  const canProjects = availability.list && availability.projects
  const canFiles = availability.list && availability.files
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const generation = useRef(0)
  const controller = useRef<AbortController>()
  const scopeRef = useRef<PanelScope>(scope)
  scopeRef.current = scope

  const fail = useCallback((next: AbortController, ticket: number, reason: unknown) => {
    if (next.signal.aborted || ticket !== generation.current) return
    setError(reason instanceof Error ? reason.message : String(reason))
    setBusy(false)
  }, [])

  /** Start one read, replacing or continuing the current page of the active view. */
  const read = useCallback((view: 'current' | 'all', offset: number, replace: boolean) => {
    const ticket = ++generation.current
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setBusy(true)
    if (view === 'current') {
      void list(next.signal, { offset }).then((page) => {
        if (next.signal.aborted || ticket !== generation.current) return
        setError(undefined)
        setResult(current => replace || current === undefined ? page : {
          ...page,
          tasks: [...current.tasks, ...page.tasks],
          warnings: [...new Set([...current.warnings, ...page.warnings])].slice(0, MAX_WARNINGS),
        })
        setBusy(false)
      }, error => { fail(next, ticket, error) })
      return
    }
    void overview(next.signal, { projectOffset: offset }).then((page) => {
      if (next.signal.aborted || ticket !== generation.current) return
      setError(undefined)
      setOverviewResult(current => replace || current === undefined ? page : {
        groups: [...current.groups, ...page.groups],
        pendingProjects: page.pendingProjects,
        totalProjects: page.totalProjects,
        nextProjectOffset: page.nextProjectOffset,
        warnings: [...new Set([...current.warnings, ...page.warnings])].slice(0, MAX_WARNINGS),
      })
      setBusy(false)
    }, error => { fail(next, ticket, error) })
  }, [fail, list, overview])

  /** Continue one project's directory cursor inside the all-projects view. */
  const loadGroup = useCallback((workspaceId: string, offset: number) => {
    if (busy) return
    const ticket = ++generation.current
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setBusy(true)
    void overview(next.signal, { group: { workspaceId, offset } }).then((page) => {
      if (next.signal.aborted || ticket !== generation.current) return
      setError(undefined)
      setOverviewResult(current => {
        if (current === undefined) return current
        const group = page.groups[0]
        if (group === undefined) return current
        return {
          ...current,
          groups: current.groups.map(row => row.workspaceId === workspaceId
            ? { ...row, rows: [...row.rows, ...group.rows], nextOffset: group.nextOffset, pending: group.pending, truncated: group.truncated, warnings: [...new Set([...row.warnings, ...group.warnings])].slice(0, MAX_WARNINGS) }
            : row),
        }
      })
      setBusy(false)
    }, error => { fail(next, ticket, error) })
  }, [busy, fail, overview])

  /** Read one directory page of the files view. */
  const readFiles = useCallback((request: { root: string, path: string, project?: string, offset: number, append: boolean }) => {
    const ticket = ++generation.current
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setBusy(true)
    setFileRoot(request.root)
    setFilePath(request.path)
    setFileProject(request.project)
    void files(next.signal, { root: request.root, path: request.path, offset: request.offset, ...(request.project === undefined ? {} : { project: request.project }) }).then((page) => {
      if (next.signal.aborted || ticket !== generation.current) return
      setError(undefined)
      setFilesPage(current => request.append && current !== undefined && current.path === page.path && current.root === page.root
        ? { ...page, entries: [...current.entries, ...page.entries] }
        : page)
      setBusy(false)
    }, error => { fail(next, ticket, error) })
  }, [fail, files])

  /** Load the registered project list used by the files view selector. */
  const readProjects = useCallback(() => {
    void projects(new AbortController().signal).then((options) => { setFileProjects(options) }, (reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }, [projects])

  // Open, refresh, session or scope switch start from a fresh page of the active
  // view: the reset bumps the generation, aborts the in-flight read and drops the
  // old rows, so one project or session can never leak into another.
  useEffect(() => {
    generation.current += 1
    controller.current?.abort()
    setResult(undefined)
    setOverviewResult(undefined)
    setFilesPage(undefined)
    setError(undefined)
    setBusy(false)
    setQuery('')
    if (!expanded) return
    if (scope === 'current') { if (canList) read('current', 0, true) }
    else if (scope === 'all') { if (canProjects) read('all', 0, true) }
    else if (canFiles) {
      readProjects()
      readFiles({ root: '.', path: '.', offset: 0, append: false })
    }
    return () => { controller.current?.abort() }
  }, [expanded, reload, scope, canList, canProjects, canFiles, sessionId, read, readFiles, readProjects])

  // The native registry may finish loading while the panel is open: only the
  // all-projects view depends on it, and only readiness/identity changes arrive
  // from the observer, so a running/updatedAt change never resets this view.
  useEffect(() => {
    if (!expanded) return
    return observe(() => {
      if (scopeRef.current !== 'all') return
      setReload(value => value + 1)
    })
  }, [expanded, observe])

  // Collapse to the icon when the header slot is narrow. The slot container is
  // measured, never the button: an icon-only button cannot shrink the slot and
  // feed a new measurement back into this state.
  useEffect(() => {
    const host = rootRef.current?.parentElement
    if (host === undefined || host === null || typeof ResizeObserver === 'undefined') return
    let collapsed = host.clientWidth > 0 && host.clientWidth < TRIGGER_COLLAPSE_AT
    setNarrow(collapsed)
    const observer = new ResizeObserver((records) => {
      const width = records[0]?.contentRect.width ?? host.clientWidth
      if (!collapsed && width < TRIGGER_COLLAPSE_AT) { collapsed = true; setNarrow(true) }
      else if (collapsed && width > TRIGGER_EXPAND_AT) { collapsed = false; setNarrow(false) }
    })
    observer.observe(host)
    return () => { observer.disconnect() }
  }, [])

  const position = useAnchoredPosition({
    open: expanded, anchorRef: rootRef, panelRef, gap: MENU_GAP, margin: VIEWPORT_MARGIN,
  })
  useDismissOnOutsidePointer(rootRef, expanded, setExpanded, panelRef)

  const close = useCallback(() => {
    setExpanded(false)
    triggerRef.current?.focus()
  }, [])

  const openDocument = useCallback((path: string, file: 'PLAN.md' | 'READY.md', targetSession?: string) => {
    open(path, file, targetSession)
    setExpanded(false)
    triggerRef.current?.focus()
  }, [open])

  const openProjectFile = useCallback((path: string, targetSession?: string) => {
    openFile(path, targetSession)
  }, [openFile])

  const refresh = useCallback(() => { setReload(value => value + 1) }, [])

  const loadMore = useCallback(() => {
    if (busy) return
    if (scope === 'current') {
      if (result === undefined || result.pending === 0) return
      read('current', result.nextOffset, false)
      return
    }
    if (scope === 'all') {
      if (overviewResult === undefined || overviewResult.pendingProjects === 0) return
      read('all', overviewResult.nextProjectOffset, false)
      return
    }
    if (filesPage === undefined || filesPage.nextOffset >= filesPage.total) return
    readFiles({ root: fileRoot, path: filePath, project: fileProject, offset: filesPage.nextOffset, append: true })
  }, [busy, filePath, fileProject, fileRoot, filesPage, overviewResult, read, readFiles, result, scope])

  const chooseFileRoot = useCallback((root: string) => {
    readFiles({ root, path: root, project: fileProject, offset: 0, append: false })
  }, [fileProject, readFiles])

  const chooseFileProject = useCallback((workspaceId: string | undefined) => {
    readFiles({ root: fileRoot, path: fileRoot, project: workspaceId, offset: 0, append: false })
  }, [fileRoot, readFiles])

  const openFileDir = useCallback((path: string) => {
    readFiles({ root: fileRoot, path, project: fileProject, offset: 0, append: false })
  }, [fileProject, fileRoot, readFiles])

  const fileUp = useCallback(() => {
    readFiles({ root: fileRoot, path: parentPath(fileRoot, filePath), project: fileProject, offset: 0, append: false })
  }, [filePath, fileProject, fileRoot, readFiles])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expanded) return
    const trigger = triggerRef.current
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    const panel = panelRef.current
    /* v8 ignore next -- both refs are attached while the open panel renders. */
    if (event.key !== 'Tab' || trigger === null || panel === null) return
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (event.target === trigger) {
      if (event.shiftKey) return
      event.preventDefault()
      focusable[0]?.focus()
    } else if (event.shiftKey ? event.target === focusable[0] : event.target === focusable.at(-1)) {
      if (event.shiftKey) event.preventDefault()
      trigger.focus()
    }
  }

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className={styles.root}>
      <ProjectOpsTrigger
        t={t}
        open={expanded}
        count={result?.tasks.length}
        narrow={narrow}
        triggerRef={triggerRef}
        onToggle={() => { setExpanded(value => !value) }}
      />
      {expanded
        ? createPortal(
          <ProjectOpsPanel
            t={t}
            open
            position={position}
            measureStyle={MEASURE_STYLE}
            panelRef={panelRef}
            scope={scope}
            onScope={(value) => { setScope(value) }}
            result={result}
            overview={overviewResult}
            files={filesPage}
            fileRoot={fileRoot}
            filePath={filePath}
            fileProject={fileProject}
            fileProjects={fileProjects}
            error={error}
            busy={busy}
            availability={availability}
            query={query}
            onQuery={setQuery}
            onRefresh={refresh}
            onLoadMore={loadMore}
            onLoadMoreGroup={loadGroup}
            onFileRoot={chooseFileRoot}
            onFileProject={chooseFileProject}
            onFileOpenDir={openFileDir}
            onFileUp={fileUp}
            onFileOpen={openProjectFile}
            onClose={close}
            onOpen={openDocument}
          />,
          document.body,
        )
        : null}
    </div>
  )
}
