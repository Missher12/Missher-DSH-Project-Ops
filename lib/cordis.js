import { a as ProjectOpsService, i as sourceSnapshot, r as SNAPSHOT_LIMITS, t as PROJECT_OPS_AGENT_GUIDANCE } from "./agent-guidance-Bexu1ghB.js";
//#region src/cordis.ts
const name = "project-ops-core";
const inject = ["projectOpsHost"];
/** The bridge exposes projectOps methods as its native Agent tools and owns their disposal. */
function apply(ctx) {
	const host = ctx.get("projectOpsHost");
	if (!host) throw new Error("Project Ops requires a projectOpsHost adapter");
	const service = new ProjectOpsService(host);
	ctx.effect(() => () => service.dispose());
	ctx.provide("projectOps", service);
	if (host.bind) ctx.effect(() => host.bind(service));
}
//#endregion
export { PROJECT_OPS_AGENT_GUIDANCE, ProjectOpsService, SNAPSHOT_LIMITS, apply, inject, name, sourceSnapshot };
