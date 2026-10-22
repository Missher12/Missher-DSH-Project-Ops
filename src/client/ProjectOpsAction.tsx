/**
 * Stateful half of the Project Ops header action.
 *
 * Owns what the presentational tree must not: the bounded, cursor-based read of
 * the session workspace (the Host listing has no cursor, so this shell keeps the
 * offset and appends batches), opening and dismissal, viewport placement of the
 * portaled panel, and keyboard traversal between the trigger and the panel. The
 * panel is portaled to the document body because the session header is a
 * clipping column that the right sidebar borders or overlaps, so an in-place
 * popover is cut off or covered there.
 *
 * Every read carries a generation ticket: a refresh, a session switch or a
 * newer batch invalidates older responses, so a stale page can never be
 * appended to, or replace, the current one.
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
import { styles } from './styles.ts'
import type { TaskListResult } from './task-view.ts'

/** Registration-side business face: bounded cursor reads and the native preview opener. */
export interface Face {
  /**
   * Optional native capabilities observed on this Host, evaluated per render so
   * a service that appears later is picked up without reloading the plugin.
   */
  surface: () => { list: boolean; preview: boolean }
  /**
   * Read one bounded batch of deliveries.
   * @param signal - caller cancellation.
   * @param options - `offset` of the batch; omit for the first one.
   */
  list: (signal: AbortSignal, options?: { offset?: number }) => Promise<TaskListResult>
  /** Open one document in the native right-sidebar file preview. */
  open: (path: string, file: 'PLAN.md' | 'READY.md') => void
}

/** Full props of the session-header action. */
export type ProjectOpsActionProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'projectOps'> & Face

/** Minimum gap kept between the panel and the viewport edges. */
const VIEWPORT_MARGIN = 12

/** Distance between the trigger's bottom edge and the panel. */
const MENU_GAP = 5

/** Unplaced panel: hidden but laid out, so the first placement measures real dimensions. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Keyboard-reachable controls inside the panel, in document order (search field included). */
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Directory warnings kept in the accumulated view. */
const MAX_WARNINGS = 5

/**
 * Render the header action.
 * @param props - locale seat, session id, and the injected read/preview face.
 * @returns the trigger plus, while open, the portaled panel.
 */
export function ProjectOpsAction({ t, surface, list, open, sessionId }: ProjectOpsActionProps) {
  const [expanded, setExpanded] = useState(false)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<TaskListResult>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  // Observed per render: a Host that adds or drops an optional service changes
  // only the affected half of the panel, never the plugin's activation.
  const availability: PanelAvailability = surface()
  const canList = availability.list
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  /** Invalidates every response older than the current reset/batch. */
  const generation = useRef(0)
  /** The one in-flight read; a new read or a reset aborts it. */
  const controller = useRef<AbortController>()

  /**
   * Start one batch read.
   * @param offset - offset into the Host candidate list.
   * @param replace - `true` for the first batch, `false` to append the next one.
   */
  const readPage = useCallback((offset: number, replace: boolean) => {
    const ticket = ++generation.current
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setBusy(true)
    void list(next.signal, { offset }).then(
      (page) => {
        if (next.signal.aborted || ticket !== generation.current) return
        setError(undefined)
        setResult(current => {
          if (replace || current === undefined) return page
          // Append in cursor order; warnings are de-duplicated and bounded.
          return {
            ...page,
            tasks: [...current.tasks, ...page.tasks],
            warnings: [...new Set([...current.warnings, ...page.warnings])].slice(0, MAX_WARNINGS),
          }
        })
        setBusy(false)
      },
      (reason: unknown) => {
        if (next.signal.aborted || ticket !== generation.current) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setBusy(false)
      },
    )
  }, [list])

  // Open, refresh and session switch all start from the first batch: the reset
  // bumps the generation, aborts the in-flight read and drops the old rows, so
  // one session's deliveries can never leak into another's panel.
  useEffect(() => {
    generation.current += 1
    controller.current?.abort()
    setResult(undefined)
    setError(undefined)
    setBusy(false)
    setQuery('')
    if (!expanded) return
    // Without the workspace-files remote there is nothing to read: the panel
    // renders the capability notice instead of a read that cannot succeed.
    if (!canList) return
    readPage(0, true)
    return () => { controller.current?.abort() }
  }, [expanded, reload, canList, sessionId, readPage])

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

  const openDocument = useCallback((path: string, file: 'PLAN.md' | 'READY.md') => {
    open(path, file)
    setExpanded(false)
    triggerRef.current?.focus()
  }, [open])

  const refresh = useCallback(() => { setReload(value => value + 1) }, [])

  // Continue the cursor; the button is disabled while a read is in flight, and
  // the check keeps a duplicate click from issuing a second batch.
  const loadMore = useCallback(() => {
    if (busy || result === undefined || result.pending === 0) return
    readPage(result.nextOffset, false)
  }, [busy, readPage, result])

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
            availability={availability}
            query={query}
            onQuery={setQuery}
            onRefresh={refresh}
            onLoadMore={loadMore}
            onClose={close}
            onOpen={openDocument}
          />,
          document.body,
        )
        : null}
    </div>
  )
}
