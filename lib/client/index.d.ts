import { Context } from "@deepseek-ai/cordis";
//#region src/client/document-status.d.ts
/** Read-only browser hints. Hash linkage is freshness evidence, not delivery acceptance. */
type DeliveryState = 'current' | 'historical' | 'inspect' | 'missing';
//#endregion
//#region src/client/index.d.ts
declare const zh: {
  title: string;
  plan: string;
  ready: string;
  loading: string;
  empty: string;
  close: string;
  refresh: string;
  hint: string;
  missing: string;
  error: string;
  truncated: string;
  current: string;
  historical: string;
  inspect: string;
};
type Key = keyof typeof zh;
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    projectOps: Key;
  }
}
declare const inject: string[];
interface TaskLink {
  id: string;
  plan: boolean;
  ready: boolean;
  title?: string;
  delivery: DeliveryState;
}
/** Register into the existing Session header and native file preview; no new remote or host patch. */
declare function apply(ctx: Context): void;
//#endregion
export { TaskLink, apply, inject };