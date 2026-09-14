# R7 candidate consumption

The canonical plugin remains 0.3.1 from `a08ce80def7876a82dc2b3e51cb653a81b1f846a`: 40,328 bytes, SHA-256 `9fed65a24615211a06867223fd6f5510f51e9f775522294ead3a1d7a8fbe98c9`. R7 changes validation tooling only. The runtime, package manifest, shipped declarations and archive bytes are unchanged. This document and the validation scripts are source-side integration aids, not new package entries.

## Fixed candidate checks

Run from the Project Ops checkout, with absolute paths selected by the integration owner:

```sh
export PROJECT_OPS_ARCHIVE=/absolute/path/dsh-project-ops-0.3.1.tgz
export PROJECT_OPS_ARCHIVE_SHA256=9fed65a24615211a06867223fd6f5510f51e9f775522294ead3a1d7a8fbe98c9
export PROJECT_OPS_HOST_ROOT=/absolute/path/to/final-runtime-npm-project
export PROJECT_OPS_NODE=/absolute/path/to/selected/node
node scripts/check-declarations.mjs
node scripts/smoke-profile.mjs
```

`PROJECT_OPS_HOST_ROOT` must contain a real project `package.json` and a `node_modules` installation. Both probes use `scripts/selected-host.mjs`: they read required packages directly through that installation's package links, without Node's ancestor search. The Profile probe requires `@deepseek-ai/dsh`; the declaration probe requires every declared official peer. Missing projects, missing package links, mismatched package identities and wrong versions fail before a consumer result or CLI run is created. The expected versions remain Harness 0.1.5-rc.2 and Cordis 4.0.2. Omit the variable only to select this checkout's installed official packages. The declaration check uses this checkout's TypeScript compiler and declaration entries from the selected archive and peer packages, with strict NodeNext and `skipLibCheck=false`.

pnpm package links may resolve outside the selected project into a shared store. An explicitly linked `node_modules` installation is also accepted; an empty installation cannot borrow missing packages from ancestors. `hostInstallation` records the project manifest, logical installation directory, actual directory, and each package's logical and actual manifest paths. This validates the selected installation projection; it does not attest that its packages were built from the final Desktop SHA.

The Profile check starts the selected runtime's `dsh` through `PROJECT_OPS_NODE` (default: the driver's Node executable), with fresh isolated HOME/DSH_HOME and a headless-derived Profile. A supplied archive requires its expected SHA-256 and is never rebuilt. With no archive variables, the existing development pack-and-test mode remains available.

`PROJECT_OPS_EXTRA_PATCH=/absolute/path/combination.patch.yml` optionally supplies a final-composition overlay to both installed and removed Profile boots. Its dependencies must be resolvable in the selected runtime. The overlay must not reinstall Project Ops after the removal phase; remaining references should fail, not be silently hidden. Actual combined overlays require the integration owner's final runtime and a fresh corresponding run.

## Evidence and publication

The archive check requires both entry declarations, the exact Bundle patch and official peer versions, rejects extra/missing/duplicate files and non-regular tar entries, and compares the expected archive hash before inspection. Type checks include rejected invalid public configuration and host arguments. The package has no product executable bin.

Reports are written to `.artifacts/r7-declarations/consumer-*/report.json` and `.artifacts/official-compat/profile-*/report.json`. The latter records the selected host root, Node executable, CLI hash, optional overlay hash, actual child runtime version/platform, fixed archive hash and the complete tool lifecycle. Its legacy `lockfileSha256` field refers to the Project Ops tooling checkout lockfile; it is not an attestation of a caller-supplied Desktop dependency tree. The integration owner must bind the supplied runtime and overlay to the final Desktop SHA.

Existing S2 evidence covers Intel macOS 15.7.4 / Node 25.6.0 and official CLI/Profile lifecycle. R7 verifies the fixed-candidate selection path against that official runtime. Windows, Ubuntu, ARM, Electron UI and the final Desktop combination remain unverified until their owners run the corresponding combination. An unknown platform is not evidence of a broken plugin and must not cause silent removal or data deletion.

The coordinator owns the final release matrix and publication. No extra `dsh` manifest fields or automatic pause behavior are invented by this plugin. The existing package manifest, strict declarations, fixed archive and explicit evidence records are the handoff inputs.

## Failure evidence

The driver writes `selected-runtime.json` before invoking the CLI and one `command-N.json` beside each command log. Driver subprocess exit and signal fields describe the CLI process, not the declared task. Each Profile activation creates a unique `attempts/installed-*/` or `attempts/removed-*/` directory. Its numbered JSON records capture activation checks, tool calls and settlements, native shell calls and settlements, and errors before assertions unwind. `result.json` belongs to that attempt. Files use exclusive creation; `installed.json` and `removed.json` remain the first attempt's summary and are never overwritten by diagnostics. Read a later attempt's own `result.json` when diagnosing a repeated activation.

Native records preserve returned exitCode, signal, timedOut, sandbox facts and bounded output/error summaries. Tool records separately preserve receipt fields, outcome, gate verdict and model-control metadata. `requestedWorkdir` comes from the invocation; returned `workdir`/`cwd` is recorded only when supplied by the result. The header records the Profile process's actual Node/executable/cwd and the driver-selected host/CLI/archive facts. It does not imply knowledge of a nested child's Node or cwd. Missing facts are the string `unavailable`, while supplied null, zero and false remain unchanged. No environment variables or credentials are collected.

The synthetic failure fixture validates this instrumentation with a real child exit of 7, a deliberate assertion, a thrown native error, and repeated attempts that preserve the first files. It is not an official Harness lifecycle or final Desktop run. The original vilN8t failure remains unexplained. Final combination acceptance must cover the same first foreground declared task using these records; do not close that question by retrying until a pass.
