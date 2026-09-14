# Official Harness 0.1.5-rc.2 adapter

The default Bundle consumes published Harness 0.1.5-rc.2 and Cordis 4.0.2. Public call identity uses `ToolCallId`; JSON types belong to `dsh-util-values`. The portable entry and task engine are unchanged.

Project Ops is a composite tool. Its enclosing result must carry the native child's deferred contexts in their original order and preserve a successful child's terminal-turn marker. Native failures may retain contexts but cannot conclude the outer turn. The adapter forwards these fields before projecting the child outcome into a Project Ops receipt, including the optional native cancellation adapter. It does not synthesize context or derive terminal authority from output text or exit codes.

Focused ToolRuntime tests cover successful and throwing native leaves, context order, and removal of the terminal marker on failure. A separate installed-artifact check boots an official named `dsh` Profile and uses official Agent handles, Tools, FS and Jobs. Its keyless output fixture records the forwarded model-facing metadata. The fixture is an application consumer loaded by the official Profile, not a new product launcher or scheduler.

The previous task core and v3 receipt rules remain the source of truth. No Desktop source, official core API or released Session format is changed. Live-model and cross-platform acceptance remain separate evidence.
