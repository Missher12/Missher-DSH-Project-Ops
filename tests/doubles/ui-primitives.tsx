/**
 * Test double for the platform module row `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The real package is a Host platform row (served from the shell's module
 * table) and is not an npm dependency of this package, so unit tests substitute
 * it. What the tests then verify is this plugin's own tree and decisions; the
 * real primitives are verified against the installed official artifact by
 * `scripts/check-ui-contract.mjs` and, end to end, by the isolated Host run.
 */
import { createElement, type ReactElement } from 'react'

export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

export interface IconProps {
  size?: number | undefined
  className?: string | undefined
}

function icon(name: string) {
  return function Icon({ size, className }: IconProps): ReactElement {
    return createElement('svg', { className, width: size ?? 16, height: size ?? 16, 'data-icon': name })
  }
}

export const IconArchiveOutlineRegular = icon('archive')
export const IconChecklistOutlineRegular = icon('checklist')
export const IconChevronDownOutlineRegular = icon('chevron-down')
export const IconCloseOutlineRegular = icon('close')
export const IconDeliverDocRegular = icon('deliver-doc')
export const IconInspectOutlineRegular = icon('inspect')
export const IconRefreshOutlineRegular = icon('refresh')

export function StateDot({ state, size, className }: { state: StateDotState, size?: number | undefined, className?: string | undefined }): ReactElement {
  return createElement('span', { className, 'data-state': state, 'data-size': String(size ?? 10) })
}

/** The real hook measures DOM geometry; a unit test only needs a stable style. */
export function useAnchoredPosition(): { left: number, top: number } | null {
  return null
}

/** Dismissal is a DOM listener in the real hook; nothing to do without a DOM. */
export function useDismissOnOutsidePointer(): void {}
