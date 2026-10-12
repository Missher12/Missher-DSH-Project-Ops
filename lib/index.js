import { a as ProjectOpsService, i as sourceSnapshot, n as PROJECT_OPS_AGENT_GUIDANCE_SECTION, o as MAX_MANIFEST_BYTES, t as PROJECT_OPS_AGENT_GUIDANCE } from "./agent-guidance-BQfg25Bc.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createHash } from "node:crypto";
import { JobId } from "@deepseek-ai/dsh-jobs";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
//#region src/receipt-schema.ts
const RECEIPT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		receiptVersion: {
			type: "integer",
			enum: [2, 3],
			required: true
		},
		executionId: { type: "string" },
		sourceDigest: { type: "string" },
		freshness: {
			type: "string",
			enum: [
				"stable",
				"changed",
				"unavailable"
			]
		},
		taskId: {
			type: "string",
			required: true
		},
		source: {
			type: "string",
			enum: [
				"package",
				"make",
				"just"
			],
			required: true
		},
		workspace: {
			type: "string",
			required: true
		},
		purpose: {
			type: "string",
			enum: [
				"test",
				"lint",
				"typecheck",
				"build",
				"format",
				"other"
			],
			required: true
		},
		manifestDigest: {
			type: "string",
			required: true
		},
		executionMode: {
			type: "string",
			enum: ["foreground", "background"],
			required: true
		},
		executorTool: { type: "string" },
		nestedCallId: {
			type: "string",
			required: true
		},
		jobId: { type: "string" },
		startedAt: {
			type: "string",
			required: true
		},
		durationMs: {
			type: "integer",
			required: true
		},
		outcome: {
			type: "string",
			enum: [
				"running",
				"succeeded",
				"failed",
				"blocked",
				"aborted",
				"unavailable"
			],
			required: true
		},
		exitCode: { type: "integer" }
	}
};
//#endregion
//#region src/task-documents.ts
const DOCUMENT_LIMIT = 131072;
const TASK_DIRECTORY = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}-[a-f0-9]{16}$/u;
function digest(text) {
	return createHash("sha256").update(text).digest("hex");
}
function object(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a document object");
	return value;
}
function text(value, label) {
	if (typeof value !== "string" || !value.trim() || value.length > 16e3 || value.includes("\0")) throw new Error(`Invalid ${label}: provide 1–16000 characters`);
	return value;
}
function texts(value, label, empty = false) {
	if (!Array.isArray(value) || value.length > 80 || !empty && value.length === 0) throw new Error(`Invalid ${label}: provide ${empty ? 0 : 1}–80 items`);
	return value.map((item) => text(item, label));
}
function parsePlan(value) {
	const row = object(value);
	const result = {
		title: text(row.title, "title"),
		requirements: text(row.requirements, "requirements"),
		design: text(row.design, "design"),
		steps: texts(row.steps, "steps"),
		acceptance: texts(row.acceptance, "acceptance"),
		progress: text(row.progress, "progress")
	};
	if (new Set(result.acceptance).size !== result.acceptance.length) throw new Error("Acceptance criteria must be unique");
	return result;
}
function parseReport(value, plan) {
	const row = object(value);
	if (!Array.isArray(row.checks) || row.checks.length !== plan.acceptance.length) throw new Error("Report every PLAN acceptance criterion exactly once");
	const checks = row.checks.map((item) => {
		const check = object(item);
		const criterion = text(check.criterion, "criterion");
		const status = check.status;
		if (![
			"reported-pass",
			"failed",
			"unverified"
		].includes(String(status))) throw new Error("Check status must distinguish reported-pass, failed, and unverified");
		return {
			criterion,
			status,
			evidence: text(check.evidence, "evidence")
		};
	});
	if (new Set(checks.map((c) => c.criterion)).size !== checks.length || checks.some((c) => !plan.acceptance.includes(c.criterion))) throw new Error("Report criteria differ from PLAN");
	return {
		implementation: text(row.implementation, "implementation"),
		checks,
		artifacts: texts(row.artifacts, "artifacts", true),
		git: text(row.git, "git"),
		release: text(row.release, "release"),
		installation: text(row.installation, "installation"),
		limitations: texts(row.limitations, "limitations", true),
		rollback: text(row.rollback, "rollback")
	};
}
const bullets = (values) => values.length ? values.map((v) => `- ${v}`).join("\n") : "- 无";
function planBody(record) {
	const p = record.plan;
	return `# Project Ops · ${p.title}\n\n任务：${record.taskId}\n会话：${record.sessionId}\n创建调用：${record.originCallId}\n状态：${record.status}；修订：${record.revision}\n\n## 需求\n\n${p.requirements}\n\n## 方案\n\n${p.design}\n\n## 步骤\n\n${bullets(p.steps)}\n\n## 验收标准\n\n${bullets(p.acceptance)}\n\n## 实际进展与下一步\n\n${p.progress}\n\n${record.delivery ? `交付记录： [查看交付](./READY.md)；${record.delivery.verification}` : "尚未生成交付记录。生成方案后继续已授权开发，不增加审批步骤。"}\n`;
}
/** One atomic PLAN contains its complete restart state; the checksum detects manual edits. */
function encodePlan(record) {
	const body = planBody(record);
	const encoded = `[project-ops-v1]: <data:application/json;base64,${Buffer.from(JSON.stringify({
		record,
		bodyHash: digest(body)
	})).toString("base64")}>\n\n${body}`;
	if (Buffer.byteLength(encoded) > 131072) throw new Error("Task document exceeds 128 KiB");
	return encoded;
}
function decodePlan(content) {
	if (Buffer.byteLength(content) > 131072) throw new Error("Task document exceeds 128 KiB");
	const match = /^\[project-ops-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>\n\n/u.exec(content);
	if (!match) throw new Error("Unmanaged PLAN: preserve manual content");
	const data = object(JSON.parse(Buffer.from(match[1], "base64").toString("utf8")));
	const raw = object(data.record);
	if (raw.format !== 1 || typeof raw.taskId !== "string" || !TASK_DIRECTORY.test(raw.taskId) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || ![
		"active",
		"failed",
		"cancelled",
		"reviewed"
	].includes(String(raw.status))) throw new Error("Invalid managed PLAN state");
	const record = {
		format: 1,
		taskId: raw.taskId,
		sessionId: text(raw.sessionId, "sessionId"),
		originCallId: text(raw.originCallId, "originCallId"),
		created: text(raw.created, "created"),
		revision: Number(raw.revision),
		status: raw.status,
		plan: parsePlan(raw.plan)
	};
	if (raw.previousReadyHash !== void 0) record.previousReadyHash = text(raw.previousReadyHash, "previousReadyHash");
	if (raw.delivery !== void 0) {
		const delivery = object(raw.delivery);
		record.delivery = {
			report: parseReport(delivery.report, record.plan),
			verification: text(delivery.verification, "verification"),
			readyHash: text(delivery.readyHash, "readyHash")
		};
	}
	const body = content.slice(match[0].length);
	if (data.bodyHash !== digest(body) || body !== planBody(record)) throw new Error("PLAN manually edited or inconsistent: preserve it and reconcile before retrying");
	return record;
}
function readyBody(record, report, verification) {
	return `# Project Ops · ${record.plan.title} · 交付记录\n\n任务：${record.taskId}\n会话：${record.sessionId}\n关联方案修订：${record.revision}\n[查看方案](./PLAN.md)\n\n本记录由当前开发会话显式提交；不是回复结束或命令退出自动判定。验收文字为会话报告，原生回执验证另列。文档生成不代表已发布、已安装或所有平台已通过。\n\n## 实现\n\n${report.implementation}\n\n## 验收报告\n\n${report.checks.map((c) => `- ${c.criterion}：${c.status}\n  证据：${c.evidence}`).join("\n")}\n\n## 原生回执验证\n\n${verification}\n\n## 产物\n\n${bullets(report.artifacts)}\n\n## Git\n\n${report.git}\n\n## 发布\n\n${report.release}\n\n## 安装\n\n${report.installation}\n\n## 未完成项与限制\n\n${bullets(report.limitations)}\n\n## 使用与回退\n\n${report.rollback}\n`;
}
/** READY carries enough checked metadata to recover a READY-first interrupted commit. */
function encodeReady(record, report, verification) {
	const body = readyBody(record, report, verification);
	const metadata = {
		planHash: digest(encodePlan(record)),
		reportHash: digest(JSON.stringify(report)),
		verification,
		bodyHash: digest(body)
	};
	return `[project-ops-ready-v1]: <data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}>\n\n${body}`;
}
/** Reuse only the exact generated record for this unchanged PLAN and delivery input. */
function recoverReady(content, record, report) {
	const match = /^\[project-ops-ready-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>\n\n/u.exec(content);
	if (!match) return void 0;
	let data;
	try {
		data = object(JSON.parse(Buffer.from(match[1], "base64").toString("utf8")));
	} catch {
		return;
	}
	if (data.planHash !== digest(encodePlan(record)) || data.reportHash !== digest(JSON.stringify(report)) || typeof data.verification !== "string") return void 0;
	return content === encodeReady(record, report, data.verification) ? data.verification : void 0;
}
//#endregion
//#region src/document-store.ts
/** Filesystem operations use the Host provider, policy, observation guard, and atomic writes. */
var DocumentStore = class {
	ctx;
	busy = /* @__PURE__ */ new Set();
	constructor(ctx) {
		this.ctx = ctx;
	}
	owner(exec) {
		const session = exec.agent?.session;
		if (!session?.id || !session.header.cwd) throw new Error("Task documents require an owning Host Session and workspace");
		return {
			sessionId: session.id,
			cwd: session.header.cwd
		};
	}
	async target(path, exec) {
		const { cwd } = this.owner(exec);
		const parts = path.split("/");
		for (let i = 1; i <= parts.length; i++) if ((await this.ctx.fs.lstat(parts.slice(0, i).join("/"), { cwd }, exec.signal))?.type === "symlink") throw new Error("Task document paths must not contain symlinks");
		const root = await this.ctx.fs.resolve(".", {
			cwd,
			signal: exec.signal
		});
		const target = await this.ctx.fs.resolve(path, {
			cwd,
			signal: exec.signal
		});
		if (!this.ctx.fs.contains(root, target)) throw new Error("Task document escaped Session workspace");
		return target;
	}
	path(taskId, file) {
		if (!TASK_DIRECTORY.test(taskId)) throw new Error("Invalid task directory identifier");
		return `docs/tasks/${taskId}/${file}`;
	}
	async read(path, exec) {
		const target = await this.target(path, exec);
		const before = await this.ctx.fs.stat(target, exec.signal);
		if (before === void 0) {
			this.ctx.emit("fs/observed", target, { kind: "absent" }, exec);
			return {
				target,
				content: void 0,
				version: void 0
			};
		}
		if (before.type !== "file" || (before.size ?? 0) > 131072) throw new Error("Task document must be a regular file under 128 KiB");
		const content = new TextDecoder("utf-8", { fatal: true }).decode(await this.ctx.fs.readBytes(target, exec.signal, DOCUMENT_LIMIT));
		if ((await this.ctx.fs.stat(target, exec.signal))?.version !== before.version) throw new Error("Task document changed during read; retry");
		this.ctx.emit("fs/observed", target, {
			kind: "present",
			version: before.version
		}, exec);
		return {
			target,
			content,
			version: before.version
		};
	}
	async write(path, content, before, exec) {
		exec.signal.throwIfAborted();
		if (Buffer.byteLength(content) > 131072) throw new Error("Task document exceeds 128 KiB");
		const target = await this.target(path, exec);
		if (target.targetKey !== before.target.targetKey) throw new Error("Task path changed before write");
		if (before.content === content) return;
		const expected = before.version === void 0 ? { kind: "createIfAbsent" } : {
			kind: "replaceIfVersion",
			version: before.version
		};
		const policyIntent = await this.ctx.waterfall("fs/write-intent", target, exec, () => void 0);
		if (policyIntent !== void 0 && JSON.stringify(policyIntent) !== JSON.stringify(expected)) throw new Error("Host file observation conflicts with document revision");
		const policy = this.ctx.get("sandboxPolicy");
		if (this.ctx.fs.sandboxMode !== void 0 && policy === void 0) throw new Error("Confining filesystem requires Host sandboxPolicy");
		const outcome = await this.ctx.fs.writeText(target, content, expected, exec.signal, policy?.resolve({ session: exec.agent.session }));
		this.ctx.emit("fs/observed", target, {
			kind: "present",
			version: outcome.version
		}, exec);
	}
	async list(exec) {
		const root = await this.target("docs/tasks", exec);
		if (await this.ctx.fs.stat(root, exec.signal) === void 0) return [];
		const rows = await this.ctx.fs.listDir(root, exec.signal);
		if (rows.length > 1e3) throw new Error("Task directory exceeds 1000 entries");
		const tasks = [];
		for (const row of rows) {
			if (row.type !== "directory" || !TASK_DIRECTORY.test(row.name)) continue;
			try {
				const task = await this.get(row.name, exec);
				if (task.record.sessionId === this.owner(exec).sessionId) tasks.push(this.summary(task.record, task.readyValid));
			} catch (error) {
				tasks.push({
					taskId: row.name,
					status: "unavailable",
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
		return tasks;
	}
	async get(taskId, exec) {
		const plan = await this.read(this.path(taskId, "PLAN.md"), exec);
		if (plan.content === void 0) throw new Error("Task PLAN not found");
		const record = decodePlan(plan.content);
		if (record.taskId !== taskId) throw new Error("PLAN directory identity mismatch");
		if (record.sessionId !== this.owner(exec).sessionId) throw new Error("Task belongs to another Host Session");
		const ready = await this.read(this.path(taskId, "READY.md"), exec);
		return {
			record,
			plan,
			ready,
			readyValid: record.delivery !== void 0 && ready.content !== void 0 && digest(ready.content) === record.delivery.readyHash
		};
	}
	summary(record, readyValid = false) {
		return {
			taskId: record.taskId,
			title: record.plan.title,
			revision: record.revision,
			status: record.status,
			planPath: this.path(record.taskId, "PLAN.md"),
			readyPath: readyValid ? this.path(record.taskId, "READY.md") : null,
			verification: record.delivery?.verification ?? "未验证",
			readyValid
		};
	}
	async mutate(key, exec, fn) {
		const id = `${this.owner(exec).cwd}\0${key}`;
		if (this.busy.has(id)) throw new Error("Task write already in progress; inspect and retry");
		this.busy.add(id);
		try {
			return await fn();
		} finally {
			this.busy.delete(id);
		}
	}
	async begin(slug, value, exec) {
		if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(slug)) throw new Error("slug must contain 1–48 lowercase letters, numbers, or hyphens");
		const owner = this.owner(exec);
		const suffix = digest(`${owner.sessionId}\0${exec.callId}`).slice(0, 16);
		const existing = (await this.list(exec)).find((row) => row.taskId.endsWith(`-${suffix}`));
		const plan = parsePlan(value);
		if (existing) {
			const saved = await this.get(existing.taskId, exec);
			if (JSON.stringify(saved.record.plan) !== JSON.stringify(plan)) throw new Error("Creation call already exists with different content; use update");
			return this.summary(saved.record, saved.readyValid);
		}
		const created = (/* @__PURE__ */ new Date()).toISOString();
		const taskId = `${created.slice(0, 10)}-${slug}-${suffix}`;
		return this.mutate(taskId, exec, async () => {
			const record = {
				format: 1,
				taskId,
				sessionId: owner.sessionId,
				originCallId: exec.callId,
				created,
				revision: 1,
				status: "active",
				plan
			};
			const path = this.path(taskId, "PLAN.md");
			const before = await this.read(path, exec);
			if (before.content !== void 0) throw new Error("Task directory already exists; inspect before retrying");
			await this.write(path, encodePlan(record), before, exec);
			return this.summary(record);
		});
	}
	async update(taskId, revision, value, status, exec) {
		return this.mutate(taskId, exec, async () => {
			const saved = await this.get(taskId, exec);
			const plan = parsePlan(value);
			if (saved.record.status === status && JSON.stringify(saved.record.plan) === JSON.stringify(plan) && !saved.record.delivery) return this.summary(saved.record);
			if (saved.record.revision !== revision) throw new Error("Stale task revision; read current PLAN before updating");
			if (saved.record.delivery && !saved.readyValid) throw new Error("READY manually edited or missing; preserve and reconcile it");
			const record = {
				...saved.record,
				plan,
				status,
				revision: revision + 1
			};
			if (record.delivery) record.previousReadyHash = record.delivery.readyHash;
			delete record.delivery;
			await this.write(this.path(taskId, "PLAN.md"), encodePlan(record), saved.plan, exec);
			return this.summary(record);
		});
	}
	async finish(taskId, revision, value, verification, exec) {
		return this.mutate(taskId, exec, async () => {
			const saved = await this.get(taskId, exec);
			const report = parseReport(value, saved.record.plan);
			if (saved.record.delivery && saved.readyValid && JSON.stringify(saved.record.delivery.report) === JSON.stringify(report) && (revision === saved.record.revision - 1 || revision === saved.record.revision && verification === saved.record.delivery.verification)) return this.summary(saved.record, true);
			if (saved.record.revision !== revision) throw new Error("Stale task revision; read current PLAN before finishing");
			if (saved.record.status === "cancelled" || saved.record.status === "failed") throw new Error("Failed or cancelled task must explicitly resume before delivery review");
			if (saved.record.delivery && !saved.readyValid) throw new Error("READY manually edited or missing; preserve and reconcile it");
			verification = (saved.ready.content === void 0 ? void 0 : recoverReady(saved.ready.content, saved.record, report)) ?? verification;
			const ready = encodeReady(saved.record, report, verification);
			if (saved.ready.content !== void 0 && saved.ready.content !== ready && !saved.readyValid && digest(saved.ready.content) !== saved.record.previousReadyHash) throw new Error("Existing READY differs: preserve it and reconcile before delivery");
			const record = {
				...saved.record,
				status: "reviewed",
				revision: revision + 1,
				delivery: {
					report,
					verification,
					readyHash: digest(ready)
				}
			};
			await this.write(this.path(taskId, "READY.md"), ready, saved.ready, exec);
			await this.write(this.path(taskId, "PLAN.md"), encodePlan(record), saved.plan, exec);
			return this.summary(record, true);
		});
	}
};
//#endregion
//#region src/document-tools.ts
/** Explicit development-task lifecycle; no turn-end or shell-exit completion hook. */
function registerDocumentTools(ctx, service) {
	const store = new DocumentStore(ctx);
	ctx.tools.register(defineTool({
		name: "missher_project_ops_document_read",
		description: "Project Ops: list current Session development tasks, or read one PLAN and its checked READY. Read before resuming or retrying. Ordinary questions need no task documents.",
		parameters: { taskId: { type: "string" } },
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args, exec) {
			if (args.taskId === void 0) return { tasks: await store.list(exec) };
			const saved = await store.get(args.taskId, exec);
			return {
				...store.summary(saved.record, saved.readyValid),
				plan: { ...saved.record.plan },
				planMarkdown: saved.plan.content,
				readyMarkdown: saved.readyValid ? saved.ready.content : null
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "Project Ops · 查看方案 / 查看交付"
		})
	}));
	ctx.tools.register(defineTool({
		name: "missher_project_ops_document_write",
		description: "Project Ops: explicitly begin/update a substantial authorized development task, or record delivery after acceptance review. Reuses Host Session, permissions and filesystem. Never pushes Git or calls another model. PLAN data: title, requirements, design, steps[], acceptance[], progress. Finish data: implementation, checks[{criterion,status:reported-pass|failed|unverified,evidence}], artifacts[], git, release, installation, limitations[], rollback. Evidence text is a Session report, not automatic proof. Failed/cancelled tasks require explicit active update before finish. Continue authorized work after writing PLAN.",
		parameters: {
			action: {
				type: "string",
				enum: [
					"begin",
					"update",
					"finish"
				],
				required: true
			},
			slug: {
				type: "string",
				description: "Begin only: short lowercase ASCII task name."
			},
			taskId: {
				type: "string",
				description: "Exact taskId returned by begin/read; required for update/finish."
			},
			expectedRevision: {
				type: "integer",
				description: "Revision read from PLAN, required for update/finish."
			},
			status: {
				type: "string",
				enum: [
					"active",
					"failed",
					"cancelled"
				],
				description: "Update only; cancellation/failure never means complete."
			},
			data: {
				type: "json",
				required: true,
				description: "PLAN or delivery report object, as described above. No secrets or full private conversations."
			},
			verification: {
				type: "object",
				additionalProperties: false,
				properties: {
					changedFiles: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					goal: {
						type: "string",
						enum: [
							"verify",
							"build",
							"all"
						],
						required: true
					},
					planDigest: {
						type: "string",
						required: true
					},
					receipts: {
						type: "array",
						items: RECEIPT_SCHEMA,
						required: true
					}
				},
				description: "Finish only: existing verification_gate arguments; missing evidence remains unverified."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args, exec) {
			if (args.action === "begin") return store.begin(args.slug ?? "", args.data, exec);
			if (!args.taskId || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 1) throw new Error("taskId and expectedRevision from document_read are required");
			if (args.action === "update") return store.update(args.taskId, args.expectedRevision, args.data, args.status ?? "active", exec);
			let verification = "未验证：未提供可核验的原生 Project Ops 回执；验收文字仅为会话报告。";
			if (args.verification !== void 0) {
				const gate = await service.gate(exec, {
					...args.verification,
					goal: args.verification.goal,
					receipts: args.verification.receipts
				});
				verification = `原生回执门：${gate.verdict}；planDigest=${gate.planDigest}；原因=${gate.reasonCodes.join(",") || "无"}。此结果核验文档写入前的源码快照，不代表发布、安装或其他平台通过。`;
			}
			return store.finish(args.taskId, args.expectedRevision, args.data, verification, exec);
		},
		presentCall: (args) => ({
			card: "generic",
			title: `Project Ops · ${args.action === "finish" ? "记录交付" : "维护方案"}`
		})
	}));
}
//#endregion
//#region src/task-execution.ts
function quote(value, executor) {
	return executor === "bash" ? `'${value.replaceAll("'", "'\\''")}'` : `'${value.replaceAll("'", "''")}'`;
}
/** Construct one fixed invocation from a rediscovered task declaration. */
function commandFor(task, executor) {
	const invocation = task.invocation;
	if (!task.runnable || invocation === void 0) throw new Error("task is not runnable");
	switch (invocation.kind) {
		case "package": return `${invocation.manager} run ${quote(invocation.script, executor)}`;
		case "make": return `make -- ${quote(invocation.target, executor)}`;
		case "just": return `just -- ${quote(invocation.recipe, executor)}`;
	}
}
function record$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function foregroundExitCode(result) {
	if (result === void 0 || result.isError) return void 0;
	const value = record$1(result.value);
	if (typeof value?.exitCode === "number" && Number.isInteger(value.exitCode)) return value.exitCode;
}
function foregroundOutcome(input) {
	const result = input.result;
	if (input.executorTool === void 0 || result === void 0) return "unavailable";
	if (result.isError) {
		const code = result.error.info?.code ?? "";
		if (code === "ABORTED" || code === "ABORTED_BEFORE_DISPATCH") return "aborted";
		if (/APPROVAL|BLOCK|DENIED|PERMISSION|SANDBOX/u.test(code)) return "blocked";
		return "failed";
	}
	const value = record$1(result.value);
	if (value?.aborted === true || typeof value?.signal === "string") return "aborted";
	if (value?.timedOut === true || record$1(value?.sandbox)?.runnerFailed === true) return "failed";
	if (record$1(value?.sandbox)?.denied === true) return "blocked";
	const code = foregroundExitCode(result);
	return code === void 0 ? "unavailable" : code !== 0 ? "failed" : "succeeded";
}
function jobExitCode(snapshot) {
	const match = /(?:^|\b)exit code:\s*(-?\d+)(?:\b|$)/u.exec(snapshot.detail ?? "");
	return match === null ? void 0 : Number(match[1]);
}
function jobOutcome(snapshot, output) {
	if (snapshot.status === "running" || snapshot.status === "stopping") return "running";
	if (snapshot.status === "killed") return "aborted";
	if (snapshot.status === "failed") return "failed";
	if (/\[sandbox: the sandbox runner itself failed/u.test(`${snapshot.detail ?? ""} ${output ?? ""}`)) return "failed";
	if (/\[sandbox: file access denied under [^\]]+\]/u.test(`${snapshot.detail ?? ""} ${output ?? ""}`)) return "blocked";
	const code = jobExitCode(snapshot);
	return code === void 0 ? "unavailable" : code !== 0 ? "failed" : "succeeded";
}
function receiptBase(task, startedAt, durationMs) {
	return {
		receiptVersion: 2,
		taskId: task.id,
		source: task.source,
		workspace: task.workspace,
		purpose: task.purpose,
		manifestDigest: task.manifestDigest,
		startedAt,
		durationMs: Math.max(0, Math.round(durationMs))
	};
}
/** Project a nested foreground tool settlement into a durable output-free receipt. */
function createReceipt(input) {
	const code = foregroundExitCode(input.result);
	return {
		...receiptBase(input.task, input.startedAt, input.durationMs),
		executionMode: input.executionMode ?? "foreground",
		...input.executorTool === void 0 ? {} : { executorTool: input.executorTool },
		nestedCallId: input.nestedCallId,
		outcome: foregroundOutcome(input),
		...code === void 0 ? {} : { exitCode: code }
	};
}
/** Project an owner-fenced Harness Job snapshot into a durable output-free receipt. */
function createJobReceipt(input) {
	const code = jobExitCode(input.snapshot);
	return {
		...receiptBase(input.task, input.startedAt, input.durationMs),
		executionMode: "background",
		executorTool: input.executorTool,
		nestedCallId: input.nestedCallId,
		jobId: input.jobId,
		outcome: jobOutcome(input.snapshot, input.output),
		...code === void 0 ? {} : { exitCode: code }
	};
}
/** Forward nested content and append one receipt block. */
function receiptContent(nested, receipt) {
	return [...nested, {
		type: "text",
		text: `Project Ops receipt:\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``
	}];
}
//#endregion
//#region src/harness-host.ts
const LOCKFILES = [
	"pnpm-lock.yaml",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"bun.lock",
	"bun.lockb"
];
/** Preserve official composite-tool control metadata on the enclosing result. */
function forwardNestedResult(result, exec) {
	for (const context of result.additionalContexts ?? []) exec.deferContext(context);
	if (!result.isError && result.concludesTurn) exec.concludeTurn();
}
var HarnessManifestReader = class {
	fs;
	cwd;
	constructor(fs, cwd) {
		this.fs = fs;
		this.cwd = cwd;
	}
	async readCandidate(name, signal) {
		const pathInfo = await this.fs.lstat(name, { cwd: this.cwd }, signal);
		if (pathInfo?.type === "symlink") throw new Error("symlink task manifests and configuration are unsupported");
		if (pathInfo === void 0 || pathInfo.type !== "file") return void 0;
		if (pathInfo.size !== void 0 && pathInfo.size > 1048576) return new Uint8Array(MAX_MANIFEST_BYTES + 1);
		const target = await this.fs.resolve(name, {
			cwd: this.cwd,
			...signal === void 0 ? {} : { signal }
		});
		const root = await this.fs.resolve(".", {
			cwd: this.cwd,
			...signal === void 0 ? {} : { signal }
		});
		if (!this.fs.contains(root, target)) return void 0;
		return this.fs.readBytes(target, signal, MAX_MANIFEST_BYTES);
	}
	async lockfiles(signal) {
		const found = [];
		for (const name of LOCKFILES) if ((await this.fs.lstat(name, { cwd: this.cwd }, signal))?.type === "file") found.push(name);
		return found;
	}
	async listDirectories(path, signal) {
		if ((await this.fs.lstat(path, { cwd: this.cwd }, signal))?.type !== "directory") return [];
		const root = await this.fs.resolve(".", {
			cwd: this.cwd,
			...signal === void 0 ? {} : { signal }
		});
		const directory = await this.fs.resolve(path, {
			cwd: this.cwd,
			...signal === void 0 ? {} : { signal }
		});
		if (!this.fs.contains(root, directory)) return [];
		const entries = await this.fs.listDir(directory, signal);
		const names = [];
		for (const entry of entries) {
			if (entry.type !== "directory" || !this.fs.contains(root, entry.target)) continue;
			const candidate = path === "." ? entry.name : `${path}/${entry.name}`;
			if ((await this.fs.lstat(candidate, { cwd: this.cwd }, signal))?.type === "directory") names.push(entry.name);
		}
		return names;
	}
};
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function sessionCwd(exec) {
	const cwd = exec.agent?.session.header.cwd;
	if (cwd === void 0 || cwd.trim() === "") throw new Error("Project Ops requires an owning Agent Session cwd");
	return cwd;
}
async function taskWorkdir(ctx, cwd, task, signal) {
	const root = await ctx.fs.resolve(".", {
		cwd,
		...signal === void 0 ? {} : { signal }
	});
	const directory = await ctx.fs.resolve(task.workspace, {
		cwd,
		...signal === void 0 ? {} : { signal }
	});
	if (!ctx.fs.contains(root, directory)) throw new Error("project task workspace escaped the Session cwd");
	return ctx.fs.processPath(directory);
}
function executorFor(ctx, owner) {
	const selected = process.platform === "win32" ? "pwsh" : "bash";
	return ctx.tools.get(selected, owner) === void 0 ? void 0 : selected;
}
function schemaFor(ctx, owner, name) {
	return ctx.tools.schemas(owner).find((schema) => schema.name === name);
}
function parameterProperties(schema) {
	return record(schema?.parameters.properties) ?? {};
}
function supportsBackground(ctx, owner, executor) {
	return Object.hasOwn(parameterProperties(schemaFor(ctx, owner, executor)), "run_in_background");
}
function shellArguments(ctx, owner, executor, command, workdir, background) {
	const properties = parameterProperties(schemaFor(ctx, owner, executor));
	return {
		command,
		...Object.hasOwn(properties, "description") ? { description: "Run declared project task" } : {},
		...Object.hasOwn(properties, "workdir") ? { workdir } : {},
		...background ? { run_in_background: true } : {}
	};
}
function backgroundJobId(result) {
	if (result.isError) return void 0;
	const value = record(result.value);
	return (value?.kind === "background" || value?.kind === "promoted") && typeof value.jobId === "string" ? value.jobId : void 0;
}
function jobContent(output, fallback) {
	return output === "" ? [...fallback] : [{
		type: "text",
		text: output
	}];
}
async function executeTask(ctx, task, args, exec) {
	const mode = args.mode ?? "foreground";
	const waitMs = args.waitMs ?? 3e3;
	if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 1e4) throw new Error("waitMs must be an integer from 1 through 10000");
	const cwd = sessionCwd(exec);
	const executorTool = executorFor(ctx, exec.agent);
	const nestedCallId = ToolCallId(`${exec.callId}:project-ops:1`);
	const startedAtMs = Date.now();
	const startedAt = new Date(startedAtMs).toISOString();
	if (executorTool === void 0) return {
		nestedContent: [{
			type: "text",
			text: "No platform shell tool is visible to this Agent."
		}],
		receipt: createReceipt({
			task,
			nestedCallId,
			startedAt,
			durationMs: Date.now() - startedAtMs
		})
	};
	const backgroundAvailable = supportsBackground(ctx, exec.agent, executorTool);
	if (mode === "background" && !backgroundAvailable) throw new Error("background execution is unavailable for the visible shell tool");
	const background = mode !== "foreground" && backgroundAvailable;
	const command = commandFor(task, executorTool);
	if (task.workspace !== "." && !Object.hasOwn(parameterProperties(schemaFor(ctx, exec.agent, executorTool)), "workdir")) throw new Error("visible shell cannot select a workspace workdir");
	exec.signal.throwIfAborted();
	const workdir = await taskWorkdir(ctx, cwd, task, exec.signal);
	const result = await ctx.tools.execute({
		callId: nestedCallId,
		rootCallId: exec.rootCallId,
		name: executorTool,
		arguments: shellArguments(ctx, exec.agent, executorTool, command, workdir, background),
		...exec.agent === void 0 ? {} : { agent: exec.agent },
		parent: exec.token,
		signal: exec.signal
	});
	forwardNestedResult(result, exec);
	const jobId = backgroundJobId(result);
	if (!background && jobId === void 0) {
		const receipt = createReceipt({
			task,
			executorTool,
			nestedCallId,
			startedAt,
			durationMs: Date.now() - startedAtMs,
			result
		});
		return {
			nestedContent: [...result.content],
			receipt
		};
	}
	if (jobId === void 0) {
		const receipt = createReceipt({
			task,
			executorTool,
			nestedCallId,
			startedAt,
			durationMs: Date.now() - startedAtMs,
			executionMode: "background",
			result
		});
		return {
			nestedContent: [...result.content],
			receipt
		};
	}
	let snapshot;
	let output = "";
	if (mode === "auto") {
		snapshot = await ctx.jobs.wait(JobId(jobId), waitMs, exec.agent?.session.id, exec.signal);
		const read = ctx.jobs.read(JobId(jobId), exec.agent?.session.id);
		snapshot = read.job;
		output = read.chunks.map((chunk) => chunk.text).join("") + (read.result ?? "");
	} else snapshot = ctx.jobs.get(JobId(jobId), exec.agent?.session.id);
	const receipt = createJobReceipt({
		task,
		executorTool,
		nestedCallId,
		jobId,
		startedAt,
		durationMs: Date.now() - startedAtMs,
		snapshot,
		output
	});
	return {
		nestedContent: jobContent(output, result.content),
		receipt
	};
}
async function collectTask(ctx, task, args, exec) {
	if (args.jobId.trim() === "" || args.jobId.length > 128) throw new Error("jobId must contain 1 through 128 characters");
	if (args.nestedCallId.trim() === "" || args.nestedCallId.length > 512) throw new Error("nestedCallId must contain 1 through 512 characters");
	const startedAtMs = Date.parse(args.startedAt);
	if (!Number.isFinite(startedAtMs)) throw new Error("startedAt must be an ISO timestamp");
	if (args.waitMs !== void 0 && (!Number.isInteger(args.waitMs) || args.waitMs < 1 || args.waitMs > 1e4)) throw new Error("waitMs must be an integer from 1 through 10000");
	const executorTool = executorFor(ctx, exec.agent);
	if (executorTool === void 0) throw new Error("No platform shell tool is visible to this Agent.");
	const id = JobId(args.jobId);
	ctx.jobs.get(id, exec.agent?.session.id);
	if (args.waitMs !== void 0) await ctx.jobs.wait(id, args.waitMs, exec.agent?.session.id, exec.signal);
	const snapshot = ctx.jobs.get(id, exec.agent?.session.id);
	if (snapshot.kind !== executorTool || snapshot.label !== commandFor(task, executorTool)) throw new Error("background job does not belong to the declared project task");
	const read = ctx.jobs.read(id, exec.agent?.session.id);
	const receipt = createJobReceipt({
		task,
		executorTool,
		nestedCallId: args.nestedCallId,
		jobId: args.jobId,
		startedAt: args.startedAt,
		durationMs: Date.now() - startedAtMs,
		snapshot: read.job,
		output: read.chunks.map((chunk) => chunk.text).join("") + (read.result ?? "")
	});
	return {
		nestedContent: [{
			type: "text",
			text: read.chunks.map((chunk) => chunk.text).join("") + (read.result ?? "") || "(no new job output)"
		}],
		receipt
	};
}
var HarnessSourceReader = class {
	fs;
	cwd;
	constructor(fs, cwd) {
		this.fs = fs;
		this.cwd = cwd;
	}
	async target(path, signal) {
		const root = await this.fs.resolve(".", {
			cwd: this.cwd,
			signal
		});
		const target = await this.fs.resolve(path, {
			cwd: this.cwd,
			signal
		});
		if (!this.fs.contains(root, target)) throw new Error("source escaped project root");
		if ((await this.fs.lstat(path, { cwd: this.cwd }, signal))?.type === "symlink") throw new Error("source symlink unsupported");
		return target;
	}
	async entries(path, signal) {
		const rows = await this.fs.listDir(await this.target(path, signal), signal);
		return Promise.all(rows.map(async (row) => {
			const info = await this.fs.lstat(path === "." ? row.name : `${path}/${row.name}`, { cwd: this.cwd }, signal);
			return {
				name: row.name,
				type: info?.type === "file" ? "file" : info?.type === "directory" ? "directory" : "unsupported"
			};
		}));
	}
	async read(path, maxBytes, signal) {
		const info = await this.fs.lstat(path, { cwd: this.cwd }, signal);
		if (info?.type !== "file" || info.size !== void 0 && info.size > maxBytes) throw new Error("source file unavailable or too large");
		return this.fs.readBytes(await this.target(path, signal), signal, maxBytes);
	}
};
function createHarnessHost(ctx, config = {}) {
	return {
		apiVersion: 1,
		signal: (call) => call.signal,
		async scope(call) {
			const cwd = sessionCwd(call);
			if (!call.agent?.id) throw new Error("Project Ops requires an owning Agent");
			const root = await ctx.fs.resolve(".", {
				cwd,
				signal: call.signal
			});
			return {
				identity: JSON.stringify([call.agent.id, ctx.fs.processPath(root)]),
				reader: new HarnessManifestReader(ctx.fs, cwd),
				snapshot: (signal) => sourceSnapshot(new HarnessSourceReader(ctx.fs, cwd), signal, { outputDirectories: config.snapshotOutputDirectories ?? [] })
			};
		},
		capabilities(call) {
			const executor = executorFor(ctx, call.agent);
			return {
				host: "deepseek-harness",
				version: "unknown",
				foreground: executor !== void 0,
				background: executor !== void 0 && supportsBackground(ctx, call.agent, executor),
				cancellation: ctx.tools.get("job_kill", call.agent) !== void 0
			};
		},
		execute: (task, args, call) => executeTask(ctx, task, args, call),
		collect: (task, args, call) => collectTask(ctx, task, args, call),
		tools: (call) => ctx.tools.schemas(call.agent).map((tool) => ({
			source: "tool",
			id: `tool:${tool.name}`,
			name: tool.name,
			description: tool.description
		})),
		async cancel(receipt, call) {
			if (!receipt.jobId) throw new Error("execution has no native background job");
			const result = await ctx.tools.execute({
				callId: ToolCallId(`${call.callId}:project-ops:cancel`),
				rootCallId: call.rootCallId,
				name: "job_kill",
				arguments: { job_id: receipt.jobId },
				agent: call.agent,
				parent: call.token,
				signal: call.signal
			});
			forwardNestedResult(result, call);
			if (result.isError) throw new Error("native cancellation failed");
		}
	};
}
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "missher-project-ops";
/** Harness services required by Project Ops. */
const inject = [
	"fs",
	"tools",
	"jobs"
];
const TASK_LIST = "missher_project_ops_task_list";
const TASK_PLAN = "missher_project_ops_task_plan";
const TASK_RUN = "missher_project_ops_task_run";
const TASK_COLLECT = "missher_project_ops_task_collect";
const VERIFICATION_GATE = "missher_project_ops_verification_gate";
const CAPABILITY_SEARCH = "missher_project_ops_capability_search";
function publicTask(task) {
	const { id, name: taskName, description, source, manifest, manifestDigest, workspace, packageName, purpose, dependsOn, runnable, automatic } = task;
	return {
		id,
		name: taskName,
		description,
		source,
		manifest,
		manifestDigest,
		workspace,
		...packageName === void 0 ? {} : { packageName },
		purpose,
		dependsOn,
		runnable,
		...automatic === void 0 ? {} : { automatic }
	};
}
const TASK_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true
		},
		name: {
			type: "string",
			required: true
		},
		description: {
			type: "string",
			required: true
		},
		source: {
			type: "string",
			enum: [
				"package",
				"make",
				"just"
			],
			required: true
		},
		manifest: {
			type: "string",
			required: true
		},
		manifestDigest: {
			type: "string",
			required: true
		},
		workspace: {
			type: "string",
			required: true
		},
		packageName: { type: "string" },
		purpose: {
			type: "string",
			enum: [
				"test",
				"lint",
				"typecheck",
				"build",
				"format",
				"other"
			],
			required: true
		},
		dependsOn: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		runnable: {
			type: "boolean",
			required: true
		},
		automatic: { type: "boolean" }
	}
};
const DIAGNOSTIC_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		source: {
			type: "string",
			enum: [
				"package",
				"make",
				"just",
				"all"
			],
			required: true
		},
		code: {
			type: "string",
			required: true
		},
		message: {
			type: "string",
			required: true
		}
	}
};
const GATE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		gateVersion: {
			type: "integer",
			const: 1,
			required: true
		},
		verdict: {
			type: "string",
			enum: [
				"passed",
				"pending",
				"failed",
				"stale"
			],
			required: true
		},
		planDigest: {
			type: "string",
			required: true
		},
		requiredTaskIds: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		missingTaskIds: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		runningTaskIds: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		failedTaskIds: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		staleTaskIds: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		reasonCodes: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
function renderJson(value) {
	return [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}];
}
function taskListTool(service) {
	return defineTool({
		name: TASK_LIST,
		description: "List bounded root and declared-workspace tasks in the current Agent Session project.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					tasks: {
						type: "array",
						items: TASK_SCHEMA,
						required: true
					},
					diagnostics: {
						type: "array",
						items: DIAGNOSTIC_SCHEMA,
						required: true
					}
				}
			},
			render: (_args, value) => renderJson(value)
		},
		async execute(_args, exec) {
			const discovered = await service.list(exec);
			return {
				tasks: discovered.tasks.map(publicTask),
				diagnostics: discovered.diagnostics
			};
		}
	});
}
function taskPlanTool(service) {
	return defineTool({
		name: TASK_PLAN,
		description: "Plan safe affected verification/build tasks from explicit workspace-relative changed files.",
		parameters: {
			changedFiles: {
				type: "array",
				items: { type: "string" },
				required: true,
				description: "One through 256 workspace-relative changed file paths."
			},
			goal: {
				type: "string",
				enum: [
					"verify",
					"build",
					"all"
				],
				required: true
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					planVersion: {
						type: "integer",
						const: 1,
						required: true
					},
					goal: {
						type: "string",
						enum: [
							"verify",
							"build",
							"all"
						],
						required: true
					},
					changedFilesDigest: {
						type: "string",
						required: true
					},
					planDigest: {
						type: "string",
						required: true
					},
					sourceDigest: { type: "string" },
					snapshotStatus: {
						type: "string",
						enum: ["available", "unavailable"],
						required: true
					},
					affectedWorkspaces: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					tasks: {
						type: "array",
						items: TASK_SCHEMA,
						required: true
					},
					diagnostics: {
						type: "array",
						items: DIAGNOSTIC_SCHEMA,
						required: true
					}
				}
			},
			render: (_args, value) => renderJson(value)
		},
		async execute(args, exec) {
			const plan = await service.plan(exec, {
				changedFiles: args.changedFiles,
				goal: args.goal
			});
			return {
				planVersion: plan.planVersion,
				goal: plan.goal,
				changedFilesDigest: plan.changedFilesDigest,
				planDigest: plan.planDigest,
				...plan.sourceDigest === void 0 ? {} : { sourceDigest: plan.sourceDigest },
				snapshotStatus: plan.snapshotStatus,
				affectedWorkspaces: plan.affectedWorkspaces,
				tasks: plan.tasks.map(publicTask),
				diagnostics: plan.diagnostics
			};
		}
	});
}
function taskRunTool(service) {
	return defineTool({
		name: TASK_RUN,
		description: "Run one fresh declared task in foreground, background, or background-first auto mode.",
		parameters: {
			taskId: {
				type: "string",
				required: true,
				description: `Task id returned by ${TASK_LIST} or ${TASK_PLAN}.`
			},
			manifestDigest: {
				type: "string",
				required: true,
				description: "Matching lowercase SHA-256 manifest digest."
			},
			mode: {
				type: "string",
				enum: [
					"foreground",
					"background",
					"auto"
				],
				description: "Defaults to foreground for backward compatibility."
			},
			waitMs: {
				type: "integer",
				description: "Auto-mode wait from 1 through 10000 ms; defaults to 3000."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					nestedContent: {
						type: "array",
						items: { type: "json" },
						required: true
					},
					receipt: {
						...RECEIPT_SCHEMA,
						required: true
					}
				}
			},
			render: (_args, value) => {
				const output = value;
				return receiptContent(output.nestedContent, output.receipt);
			}
		},
		async execute(args, exec) {
			const result = await service.run(exec, args);
			return {
				receipt: result.receipt,
				nestedContent: result.nestedContent
			};
		}
	});
}
function taskCollectTool(service) {
	return defineTool({
		name: TASK_COLLECT,
		description: "Poll or wait for one Project Ops background task and return a fresh owner-fenced receipt.",
		parameters: {
			taskId: {
				type: "string",
				required: true
			},
			manifestDigest: {
				type: "string",
				required: true
			},
			jobId: {
				type: "string",
				required: true
			},
			nestedCallId: {
				type: "string",
				required: true
			},
			startedAt: {
				type: "string",
				required: true
			},
			waitMs: {
				type: "integer",
				description: "Optional wait from 1 through 10000 ms; omission polls immediately."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					nestedContent: {
						type: "array",
						items: { type: "json" },
						required: true
					},
					receipt: {
						...RECEIPT_SCHEMA,
						required: true
					}
				}
			},
			render: (_args, value) => {
				const output = value;
				return receiptContent(output.nestedContent, output.receipt);
			}
		},
		async execute(args, exec) {
			const result = await service.collect(exec, args);
			return {
				receipt: result.receipt,
				nestedContent: result.nestedContent
			};
		}
	});
}
function verificationGateTool(service) {
	return defineTool({
		name: VERIFICATION_GATE,
		description: "Recompute an affected-task plan and decide whether supplied Project Ops receipts are fresh and complete.",
		parameters: {
			changedFiles: {
				type: "array",
				items: { type: "string" },
				required: true
			},
			goal: {
				type: "string",
				enum: [
					"verify",
					"build",
					"all"
				],
				required: true
			},
			planDigest: {
				type: "string",
				required: true
			},
			receipts: {
				type: "array",
				items: RECEIPT_SCHEMA,
				required: true
			}
		},
		output: {
			schema: GATE_SCHEMA,
			render: (_args, value) => renderJson(value)
		},
		async execute(args, exec) {
			return service.gate(exec, {
				changedFiles: args.changedFiles,
				goal: args.goal,
				receipts: args.receipts,
				planDigest: args.planDigest
			});
		}
	});
}
function capabilitySearchTool(service) {
	return defineTool({
		name: CAPABILITY_SEARCH,
		description: "Search tools visible to this Agent and tasks declared by its current project workspaces.",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "Capability or task to find."
			},
			limit: {
				type: "integer",
				description: "Maximum matches from 1 through 10; defaults to 5."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { matches: {
					type: "array",
					required: true,
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							source: {
								type: "string",
								enum: ["project-task", "tool"],
								required: true
							},
							id: {
								type: "string",
								required: true
							},
							name: {
								type: "string",
								required: true
							},
							description: {
								type: "string",
								required: true
							},
							score: {
								type: "integer",
								required: true
							},
							reason: {
								type: "string",
								required: true
							}
						}
					}
				} }
			},
			render: (_args, value) => renderJson(value)
		},
		async execute(args, exec) {
			return service.search(exec, args.query, args.limit ?? 5);
		}
	});
}
/** Register the Project Ops model tools. */
function apply(ctx, config = {}) {
	const service = new ProjectOpsService(createHarnessHost(ctx, config));
	ctx.effect(() => () => service.dispose());
	ctx.provide("projectOps", service);
	const systemPrompt = ctx.get("systemPrompt");
	if (systemPrompt?.section !== void 0) systemPrompt.section({
		name: PROJECT_OPS_AGENT_GUIDANCE_SECTION,
		order: 145,
		text: PROJECT_OPS_AGENT_GUIDANCE
	});
	registerDocumentTools(ctx, service);
	ctx.tools.register(taskListTool(service));
	ctx.tools.register(taskPlanTool(service));
	ctx.tools.register(taskRunTool(service));
	ctx.tools.register(taskCollectTool(service));
	ctx.tools.register(verificationGateTool(service));
	ctx.tools.register(capabilitySearchTool(service));
	ctx.tools.register(defineTool({
		name: "missher_project_ops_doctor",
		description: "Read-only Project Ops host capability and source snapshot readiness check. Does not install dependencies.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, value) => renderJson(value)
		},
		execute: (_args, exec) => service.doctor(exec)
	}));
}
//#endregion
export { apply, inject, name };
