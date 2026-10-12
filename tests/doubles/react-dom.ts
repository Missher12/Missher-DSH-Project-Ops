/**
 * Test double for the platform module row `react-dom`.
 *
 * React DOM is served from the Host's platform module table and is not an npm
 * dependency of this package, so a unit test cannot import it. The double
 * renders portal children inline, which keeps a portaled subtree reachable when
 * the tests walk an element tree.
 */
import { createElement, Fragment, type ReactElement, type ReactNode } from 'react'

/** Portal children inline: a tree walk then sees the panel where it is rendered. */
export function createPortal(children: ReactNode, _container?: Element | DocumentFragment, key?: string | number | null): ReactElement {
  return createElement(Fragment, key === undefined || key === null ? null : { key }, children)
}
