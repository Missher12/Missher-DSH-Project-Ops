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
import { ProjectOpsPanel, ProjectOpsTrigger } from './ProjectOpsPanel.tsx'
import { styles } from './styles.ts'
import type { TaskListResult } from './task-view.ts'

/** Registration-side business face: one bounded read and the native preview opener. */
export interface Face {
  /** Read this session's `docs/tasks` listing, abortable by the caller. */
  list: (signal: AbortSignal) => Promise<TaskListResult>
  /** Open one document in the native right-sidebar file preview. */
  open: (task: string, file: 'PLAN.md' | 'READY.md') => void
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
export function ProjectOpsAction({ t, list, open, sessionId }: ProjectOpsActionProps) {
  const [expanded, setExpanded] = useState(false)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<TaskListResult>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  // One read per open/refresh/session: the effect's cleanup aborts the previous
  // request, so a refresh can never race its predecessor into the panel.
  useEffect(() => {
    if (!expanded) return
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
  }, [expanded, reload, sessionId, list])

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
        count={result?.tasks.length}
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
            onRefresh={() => { setReload(value => value + 1) }}
            onClose={close}
            onOpen={openDocument}
          />,
          document.body,
        )
        : null}
    </div>
  )
}
