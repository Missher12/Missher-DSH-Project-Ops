import "@deepseek-ai/dsh-tools";
import { Context } from "@deepseek-ai/cordis";
//#region src/harness-host.d.ts
interface HarnessConfig {
  snapshotOutputDirectories?: string[];
}
//#endregion
//#region src/index.d.ts
/** Stable Cordis plugin name. */
declare const name = "missher-project-ops";
/**
 * Harness services Project Ops cannot work without.
 *
 * Only the minimum lives here: a cordis 4.x plugin `inject` entry is a hard
 * activation requirement, so a Host without the optional native Jobs service
 * must still load Project Ops and see the background half reported as disabled
 * (see `doctor`) instead of losing the whole plugin.
 */
declare const inject: string[];
/** Register the Project Ops model tools. */
declare function apply(ctx: Context, config?: HarnessConfig): void;
//#endregion
export { type HarnessConfig, apply, inject, name };