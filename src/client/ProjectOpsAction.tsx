/**
 * Stateful half of the Project Ops header action.
 *
 * Owns what the presentational tree must not: the bounded read of the session
 * workspace, opening and dismissal, viewport placement of the portaled panel,
 * and keyboard traversal between the trigger and the panel. The panel is
 * portaled to the document body because the session header is a clipping column
 * that the right sidebar borders or overlaps, so an in-place popover is cut off
 * or covered there.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ProjectOpsPanel, ProjectOpsTrigger, type PanelAvailability } from './ProjectOpsPanel.tsx'
import { RevealError, type RevealOutcome } from './reveal.ts'
import { styles } from './styles.ts'
import type { TaskListResult } from './task-view.ts'
import type { FilesResult, PanelCategory } from '../delivered-files.ts'

/** Registration-side business face: one bounded read and the native preview opener. */
export interface Face {
  /**
   * Optional native capabilities observed on this Host, evaluated per render so
   * a service that appears later is picked up without reloading the plugin.
   */
  surface: () => { list: boolean; preview: boolean }
  /** Read this session's `docs/tasks` listing, abortable by the caller. */
  list: (signal: AbortSignal) => Promise<TaskListResult>
  /** Open one document in the native right-sidebar file preview. */
  open: (task: string, file: 'PLAN.md' | 'READY.md') => void
  files: (signal: AbortSignal) => Promise<FilesResult>
  watchFiles: (changed: () => void) => () => void
  openFile: (path: string, signal: AbortSignal) => Promise<void>
  /** Reveal one delivered file in the Host desktop's file manager. */
  revealFile: (path: string, signal: AbortSignal) => Promise<void>
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
const FOCUSABLE = 'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Render the header action.
 * @param props - locale seat, session id, and the injected read/preview face.
 * @returns the trigger plus, while open, the portaled panel.
 */
export function ProjectOpsAction({ t, surface, list, open, files, watchFiles, openFile, revealFile, sessionId }: ProjectOpsActionProps) {
  const [expanded, setExpanded] = useState(false)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<TaskListResult>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [category, setCategory] = useState<PanelCategory>('all')
  const [fileResult, setFileResult] = useState<FilesResult>()
  const [fileError, setFileError] = useState<string>()
  const [fileBusy, setFileBusy] = useState(false)
  const [fileReload, setFileReload] = useState(0)
  const [openingFile, setOpeningFile] = useState<string>()
  const [openError, setOpenError] = useState<{ path: string; message: string }>()
  const [revealing, setRevealing] = useState<string>()
  const [revealError, setRevealError] = useState<{ path: string; outcome: RevealOutcome; message: string }>()
  const fileOpenController = useRef<AbortController>()
  const revealController = useRef<AbortController>()
  // Observed per render: a Host that adds or drops an optional service changes
  // only the affected half of the panel, never the plugin's activation.
  const availability: PanelAvailability = surface()
  const canList = availability.list
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  // One read per open/refresh/session: the effect's cleanup aborts the previous
  // request, so a refresh can never race its predecessor into the panel.
  useEffect(() => {
    if (!expanded) return
    // Without the workspace-files remote there is nothing to read: the panel
    // renders the capability notice instead of a read that cannot succeed.
    if (!canList) {
      setResult(undefined)
      setError(undefined)
      setBusy(false)
      return
    }
    const controller = new AbortController()
    setBusy(true)
    setResult(undefined)
    setError(undefined)
    void list(controller.signal).then(
      (value) => { if (!controller.signal.aborted) { setResult(value); setBusy(false) } },
      (reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setBusy(false)
      },
    )
    return () => { controller.abort() }
  }, [expanded, reload, canList, sessionId, list])

  useEffect(() => {
    if (!expanded) return
    return watchFiles(() => { setFileReload(value => value + 1) })
  }, [expanded, sessionId, watchFiles])

  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setFileBusy(true)
    setFileResult(undefined)
    setFileError(undefined)
    void files(controller.signal).then(value => {
      if (!controller.signal.aborted) { setFileResult(value); setFileBusy(false) }
    }, reason => {
      if (!controller.signal.aborted) { setFileError(reason instanceof Error ? reason.message : String(reason)); setFileBusy(false) }
    })
    return () => { controller.abort() }
  }, [expanded, reload, fileReload, files, sessionId])

  useEffect(() => {
    setOpeningFile(undefined)
    setOpenError(undefined)
    setRevealing(undefined)
    setRevealError(undefined)
    return () => {
      fileOpenController.current?.abort()
      revealController.current?.abort()
    }
  }, [expanded, sessionId])

  const position = useAnchoredPosition({
    open: expanded, anchorRef: rootRef, panelRef, gap: MENU_GAP, margin: VIEWPORT_MARGIN,
  })
  useDismissOnOutsidePointer(rootRef, expanded, setExpanded, panelRef)

  // Every close path returns focus to the trigger: the panel holds the focus
  // when it unmounts, so without this the keyboard would land on the body.
  const close = useCallback(() => {
    setExpanded(false)
    triggerRef.current?.focus()
  }, [])

  const openDocument = useCallback((task: string, file: 'PLAN.md' | 'READY.md') => {
    open(task, file)
    setExpanded(false)
    triggerRef.current?.focus()
  }, [open])

  const openDeliveredFile = useCallback((path: string) => {
    fileOpenController.current?.abort()
    const controller = new AbortController()
    fileOpenController.current = controller
    setOpeningFile(path)
    setOpenError(undefined)
    void openFile(path, controller.signal).then(() => {
      if (!controller.signal.aborted) close()
    }, reason => {
      if (!controller.signal.aborted) setOpenError({ path, message: reason instanceof Error ? reason.message : String(reason) })
    }).finally(() => { if (!controller.signal.aborted) setOpeningFile(undefined) })
  }, [openFile, close])

  const revealDeliveredFile = useCallback((path: string) => {
    revealController.current?.abort()
    const controller = new AbortController()
    revealController.current = controller
    setRevealing(path)
    setRevealError(undefined)
    void revealFile(path, controller.signal).then(() => {
      if (!controller.signal.aborted) setRevealing(undefined)
    }, reason => {
      if (controller.signal.aborted) return
      setRevealing(undefined)
      setRevealError({
        path,
        outcome: reason instanceof RevealError ? reason.outcome : 'failed',
        message: reason instanceof Error ? reason.message : String(reason),
      })
    })
  }, [revealFile])

  // The portaled panel sits at the end of the document, so Tab is bridged to
  // keep the in-place order: the trigger leads into the panel, and leaving
  // either end returns to the trigger.
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
        count={result === undefined && fileResult === undefined ? undefined : (result?.tasks.length ?? 0) + (fileResult?.files.length ?? 0)}
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
            result={result}
            error={error}
            busy={busy}
            availability={availability}
            onRefresh={() => { setReload(value => value + 1) }}
            onClose={close}
            onOpen={openDocument}
            category={category}
            onCategory={setCategory}
            files={fileResult}
            fileError={fileError}
            fileBusy={fileBusy}
            openingFile={openingFile}
            openError={openError}
            onOpenFile={openDeliveredFile}
            revealing={revealing}
            revealError={revealError}
            onRevealFile={revealDeliveredFile}
          />,
          document.body,
        )
        : null}
    </div>
  )
}
