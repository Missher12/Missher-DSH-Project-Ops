/*
 * Platform module-table surface consumed by this client bundle.
 *
 * The Host web shell exposes a fixed baseline module table to every dynamic
 * client bundle:
 *
 *   react, react/jsx-runtime, react-dom, react-dom/client,
 *   @deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
 *   @deepseek-ai/dsh-client-ui-slots,
 *   @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
 *
 * (`@deepseek-ai/dsh-web-frontend` 0.2.1-alpha.2, the shell's platform table.)
 * Those specifiers resolve through the closure-factory `require` and stay
 * external at build time, but they are not npm dependencies of this package, so
 * TypeScript cannot read their published types from `node_modules` here.
 *
 * This file is therefore a NARROW, EXPLICIT COMPATIBILITY LIMITATION: only the
 * surface this plugin consumes is declared, so an unrelated import of these
 * packages stays a compile error instead of silently relying on an undeclared
 * row. Signatures mirror the installed official artifacts of the target Host
 * (`@deepseek-ai/dsh-client-ui-primitives` 0.2.1-alpha.2) and the standard
 * React 18 client API; `npm run check:ui` re-verifies every declared primitives
 * name against the installed artifact and fails when the two drift.
 *
 * When this repository can install dev dependencies again, delete the two
 * `declare module` blocks below and consume the official types directly
 * (`@deepseek-ai/dsh-client-ui-primitives@0.2.1-alpha.2` and a React 18
 * `@types/react-dom`), keeping only the `*.css?inline` block — that one types a
 * build-time virtual module which no package ships.
 */

declare module 'react-dom' {
  import type { ReactElement, ReactNode } from 'react'
  /** Portal a subtree into another DOM container; the shell's platform table provides React DOM. */
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | number | null): ReactElement
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { CSSProperties, ReactElement, RefObject } from 'react'

  /** Shared props for every product icon component. */
  export interface IconProps {
    /** Square edge in px; defaults to the glyph's own drawn size. */
    size?: number | undefined
    /** Extra class for layout placement; color rides currentColor. */
    className?: string | undefined
  }

  /** State semantic: green done / amber user-attention / tertiary loading / red error / neutral idle. */
  export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

  /** Render a state dot (aria-hidden; pair with text for accessibility). */
  export function StateDot(props: {
    state: StateDotState
    size?: number | undefined
    className?: string | undefined
    appearance?: 'dot' | 'step'
  }): ReactElement

  /** Inputs for {@link useAnchoredPosition}. */
  export interface AnchoredPositionOptions {
    open: boolean
    anchorRef: RefObject<HTMLElement | null>
    panelRef: RefObject<HTMLElement | null>
    side?: 'top' | 'bottom'
    align?: 'start' | 'end'
    gap: number
    margin: number
  }

  /** Track an anchor and return the portaled panel's fixed coordinates, or `null` before the first measurement. */
  export function useAnchoredPosition(options: AnchoredPositionOptions): CSSProperties | null

  /** Dismiss a floating surface on a pointer press outside the anchor and the portal. */
  export function useDismissOnOutsidePointer(
    root: RefObject<HTMLElement | null>,
    open: boolean,
    setOpen: (open: boolean) => void,
    portal?: RefObject<HTMLElement | null>,
  ): void

  export function IconArchiveOutlineRegular(props: IconProps): ReactElement
  export function IconChecklistOutlineRegular(props: IconProps): ReactElement
  export function IconChevronDownOutlineRegular(props: IconProps): ReactElement
  export function IconCloseOutlineRegular(props: IconProps): ReactElement
  export function IconInspectOutlineRegular(props: IconProps): ReactElement
  export function IconRefreshOutlineRegular(props: IconProps): ReactElement
}

declare module '*.css?inline' {
  const css: string
  export default css
}
