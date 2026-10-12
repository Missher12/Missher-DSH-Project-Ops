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
/** Harness services required by Project Ops. */
declare const inject: string[];
/** Register the Project Ops model tools. */
declare function apply(ctx: Context, config?: HarnessConfig): void;
//#endregion
export { type HarnessConfig, apply, inject, name };