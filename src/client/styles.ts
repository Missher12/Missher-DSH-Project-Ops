/**
 * Stylesheet delivery for the Project Ops panel.
 *
 * The Host fetches a plugin's client bundle outside Vite's module graph, so
 * the bundle itself must carry its CSS. `?inline` yields the compiled sheet as
 * text, which is mounted for exactly the owning plugin lifetime as a
 * `<style data-plugin>` tag — the same channel the official theme package
 * uses, and the tag the client module loader inventories as plugin-owned CSS.
 */
import type { Context } from '@deepseek-ai/cordis'
import css from './styles/project-ops.css?inline'

/** Package id stamped on the injected tag and on the registry row. */
export const PLUGIN_ID = '@missher/dsh-project-ops'

/** Compiled sheet text inlined into the client bundle by the build. */
export const PROJECT_OPS_CSS: string = css

/**
 * Class names of the sheet. Declared once here so a component reference and
 * the stylesheet cannot drift apart unnoticed: `tests/client-styles.spec.ts`
 * reads the stylesheet and fails on any name that the sheet does not define.
 */
export const styles = {
  root: 'po-root',
  trigger: 'po-trigger',
  triggerIcon: 'po-trigger-icon',
  triggerLabel: 'po-trigger-label',
  triggerChevron: 'po-trigger-chevron',
  triggerChevronOpen: 'po-trigger-chevron-open',
  menu: 'po-menu',
  header: 'po-header',
  headerTitle: 'po-header-title',
  headerCount: 'po-header-count',
  iconButton: 'po-icon-button',
  spin: 'po-spin',
  notice: 'po-notice',
  noticeError: 'po-notice-error',
  noticeAction: 'po-notice-action',
  skeleton: 'po-skeleton',
  skeletonLine: 'po-skeleton-line',
  skeletonLineShort: 'po-skeleton-line-short',
  list: 'po-list',
  row: 'po-row',
  rowDot: 'po-row-dot',
  rowMain: 'po-row-main',
  rowTitle: 'po-row-title',
  rowId: 'po-row-id',
  rowMeta: 'po-row-meta',
  rowStatus: 'po-row-status',
  rowActions: 'po-row-actions',
  action: 'po-action',
  actionIcon: 'po-action-icon',
  footer: 'po-footer',
} as const

/** Every class name the sheet must define. */
export const styleClassNames: readonly string[] = Object.values(styles)

/** Join conditional class names without pulling a `clsx`-style dependency. */
export function classNames(...values: readonly (string | false | undefined)[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ')
}

/**
 * Mount the panel stylesheet for the owning plugin lifetime.
 * @param ctx - client root context.
 */
export function installStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/project-ops.css`
    tag.textContent = PROJECT_OPS_CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'project-ops: stylesheet')
}
