import { createHash, randomUUID } from "node:crypto";
//#region src/capability-ranking.ts
function normalize(value) {
	return value.normalize("NFKC").toLocaleLowerCase("en").trim();
}
function tokens(value) {
	return normalize(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
function score(query, row) {
	const name = normalize(row.name);
	const nameTokens = tokens(row.name);
	const description = normalize(row.description);
	const descriptionTokens = tokens(row.description);
	if (name === query) return {
		score: 120,
		reason: "exact-name"
	};
	if (name.startsWith(query)) return {
		score: 100,
		reason: "name-prefix"
	};
	if (nameTokens.includes(query)) return {
		score: 90,
		reason: "name-token"
	};
	if (nameTokens.some((token) => token.startsWith(query))) return {
		score: 75,
		reason: "name-token-prefix"
	};
	if (descriptionTokens.includes(query)) return {
		score: 40,
		reason: "description-token"
	};
	if (description.includes(query)) return {
		score: 20,
		reason: "description-match"
	};
}
/** Rank visible capabilities without accessing another registry or network service. */
function rankCapabilities(query, rows, limit) {
	const normalized = normalize(query);
	if (normalized === "") throw new Error("query must be nonblank");
	if ([...query].length > 256) throw new Error("query must be at most 256 characters");
	if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("limit must be an integer from 1 through 10");
	return rows.flatMap((row) => {
		const match = score(normalized, row);
		return match === void 0 ? [] : [{
			...row,
			...match
		}];
	}).sort((left, right) => right.score - left.score || left.source.localeCompare(right.source, "en") || left.id.localeCompare(right.id, "en")).slice(0, limit);
}
//#endregion
//#region src/task-discovery.ts
const MAX_MANIFEST_BYTES = 1048576;
const decoder = new TextDecoder("utf-8", { fatal: true });
const SOURCE_ORDER = {
	package: 0,
	make: 1,
	just: 2
};
const PACKAGE_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies"
];
function diagnostic(source, code, message) {
	return {
		source,
		code,
		message
	};
}
async function readManifest(reader, source, name, diagnostics, signal) {
	signal?.throwIfAborted();
	let bytes;
	try {
		bytes = await reader.readCandidate(name, signal);
	} catch {
		signal?.throwIfAborted();
		diagnostics.push(diagnostic(source, "manifest-read-failed", `Could not read ${name.split("/").at(-1) ?? "manifest"}.`));
		return;
	}
	if (bytes === void 0) return void 0;
	if (bytes.byteLength > 1048576) {
		diagnostics.push(diagnostic(source, "manifest-too-large", `${name.split("/").at(-1) ?? "Manifest"} exceeds the 1 MiB discovery limit.`));
		return;
	}
	try {
		return {
			bytes,
			digest: createHash("sha256").update(bytes).digest("hex"),
			name,
			text: decoder.decode(bytes)
		};
	} catch {
		signal?.throwIfAborted();
		diagnostics.push(diagnostic(source, "invalid-manifest", `${name.split("/").at(-1) ?? "Manifest"} is not valid UTF-8 text.`));
		return;
	}
}
async function readFirst(reader, source, names, diagnostics, signal) {
	for (const name of names) {
		const manifest = await readManifest(reader, source, name, diagnostics, signal);
		if (manifest !== void 0) return manifest;
	}
}
function packageManagerFromField(value) {
	if (typeof value !== "string") return void 0;
	return /^(npm|pnpm|yarn|bun)@/u.exec(value.trim())?.[1];
}
function packageManagerFromLocks(lockfiles) {
	const managers = /* @__PURE__ */ new Set();
	for (const name of lockfiles) {
		if (name === "pnpm-lock.yaml") managers.add("pnpm");
		if (name === "package-lock.json" || name === "npm-shrinkwrap.json") managers.add("npm");
		if (name === "yarn.lock") managers.add("yarn");
		if (name === "bun.lock" || name === "bun.lockb") managers.add("bun");
	}
	if (managers.size > 1) return "ambiguous";
	return [...managers][0];
}
function taskPurpose(name) {
	const normalized = name.toLowerCase();
	const tokens = normalized.split(/[:._-]+/u);
	if (normalized.includes("typecheck") || normalized.includes("type-check") || tokens.includes("type") && tokens.includes("check")) return "typecheck";
	if (tokens.includes("lint") || tokens.includes("eslint")) return "lint";
	if (tokens.some((token) => [
		"test",
		"tests",
		"spec",
		"check",
		"verify"
	].includes(token))) return "test";
	if (tokens.some((token) => [
		"build",
		"compile",
		"bundle",
		"package"
	].includes(token))) return "build";
	if (tokens.some((token) => [
		"format",
		"fmt",
		"prettier"
	].includes(token))) return "format";
	return "other";
}
function automaticTask(name, command = "") {
	return !name.toLowerCase().split(/[:._-]+/u).some((token) => [
		"fix",
		"write",
		"update",
		"watch",
		"dev",
		"serve",
		"start"
	].includes(token)) && !/(?:^|\s)(?:--(?:fix|write|update|watch)(?:[=\s]|$)|-u(?:\s|$))/u.test(command);
}
function parsePackage(manifest, workspace, diagnostics) {
	let parsed;
	try {
		parsed = JSON.parse(manifest.text);
	} catch {
		diagnostics.push(diagnostic("package", "invalid-manifest", `${manifest.name} is not valid JSON.`));
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		diagnostics.push(diagnostic("package", "invalid-manifest", `${manifest.name} must contain an object.`));
		return;
	}
	const record = parsed;
	const dependencies = /* @__PURE__ */ new Set();
	for (const field of PACKAGE_FIELDS) {
		const value = record[field];
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		for (const name of Object.keys(value)) dependencies.add(name);
	}
	const manager = packageManagerFromField(record.packageManager);
	if (record.packageManager !== void 0 && manager === void 0) diagnostics.push(diagnostic("package", "unsupported-package-manager", "packageManager does not name npm, pnpm, yarn, or bun."));
	return {
		dependencies: [...dependencies].sort((left, right) => left.localeCompare(right, "en")),
		...manager === void 0 ? {} : { manager },
		manifest,
		...typeof record.name === "string" && record.name.trim() !== "" ? { name: record.name } : {},
		record,
		workspace
	};
}
function packageTasks(pkg, inheritedManager) {
	const scripts = pkg.record.scripts;
	if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return [];
	const manager = pkg.record.packageManager !== void 0 ? pkg.manager : inheritedManager;
	return Object.entries(scripts).flatMap(([name, command]) => {
		if (typeof command !== "string" || name.trim() === "") return [];
		return [{
			id: pkg.workspace === "." ? `package:${name}` : `package@${pkg.workspace}:${name}`,
			name,
			description: pkg.workspace === "." ? `Run package script ${JSON.stringify(name)}.` : `Run package script ${JSON.stringify(name)} in workspace ${JSON.stringify(pkg.workspace)}.`,
			source: "package",
			manifest: pkg.manifest.name,
			manifestDigest: pkg.manifest.digest,
			workspace: pkg.workspace,
			...pkg.name === void 0 ? {} : { packageName: pkg.name },
			purpose: taskPurpose(name),
			dependsOn: [],
			runnable: manager !== void 0,
			automatic: automaticTask(name, command),
			...manager === void 0 ? {} : { invocation: {
				kind: "package",
				manager,
				script: name,
				cwd: pkg.workspace
			} }
		}];
	});
}
function workspacePatternsFromPackage(record) {
	const workspaces = record.workspaces;
	if (Array.isArray(workspaces)) return workspaces.filter((value) => typeof value === "string");
	if (typeof workspaces !== "object" || workspaces === null) return [];
	const packages = workspaces.packages;
	return Array.isArray(packages) ? packages.filter((value) => typeof value === "string") : [];
}
function workspacePatternsFromPnpm(text, diagnostics) {
	const patterns = [];
	let inPackages = false;
	for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
		if (/^packages\s*:\s*(?:#.*)?$/u.test(line)) {
			inPackages = true;
			continue;
		}
		if (/^packages\s*:/u.test(line)) diagnostics.push(diagnostic("package", "unsupported-workspace-syntax", "Use a block packages list in pnpm-workspace.yaml."));
		if (!inPackages) continue;
		const match = /^\s*-\s*(.+?)\s*$/u.exec(line);
		if (match === null) {
			if (/^[^\s#]/u.test(line)) break;
			if (line.trim() !== "" && !line.trimStart().startsWith("#")) diagnostics.push(diagnostic("package", "unsupported-workspace-syntax", "Expected a scalar packages list item in pnpm-workspace.yaml."));
			continue;
		}
		let value = match[1].replace(/\s+#.*$/u, "").trim();
		if (value.startsWith("'") && value.endsWith("'") || value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
		patterns.push(value);
	}
	return patterns;
}
function patternSegments(pattern) {
	if (pattern.trim() !== pattern || pattern === "" || pattern.startsWith("/") || pattern.startsWith("!") || pattern.includes("\\") || pattern.includes("//") || /^[A-Za-z]:/u.test(pattern)) return void 0;
	const segments = pattern.split("/");
	if (segments.length > 8 || segments.some((segment) => segment === "" || segment === "..")) return void 0;
	for (const [index, segment] of segments.entries()) {
		if (segment === "*") continue;
		if (segment === "**" && index === segments.length - 1) continue;
		if (!/^[A-Za-z0-9@._-]+$/u.test(segment)) return void 0;
	}
	return segments;
}
async function workspaceDirectories(reader, patterns, diagnostics, signal) {
	const matches = /* @__PURE__ */ new Set();
	const visited = /* @__PURE__ */ new Set();
	const directoryCache = /* @__PURE__ */ new Map();
	let directoryLimit = false;
	let depthLimit = false;
	async function children(path) {
		signal?.throwIfAborted();
		const cached = directoryCache.get(path);
		if (cached !== void 0) return cached;
		if (visited.size >= 256) {
			directoryLimit = true;
			return [];
		}
		visited.add(path);
		try {
			const names = [...await reader.listDirectories(path, signal)].filter((name) => !["node_modules", ".git"].includes(name)).sort((a, b) => a.localeCompare(b, "en"));
			directoryCache.set(path, names);
			return names;
		} catch {
			signal?.throwIfAborted();
			diagnostics.push(diagnostic("package", "workspace-read-failed", "Could not inspect workspace directories."));
			directoryCache.set(path, []);
			return [];
		}
	}
	async function expand(path, segments, index) {
		if (index === segments.length) {
			if (path !== ".") matches.add(path);
			return;
		}
		const segment = segments[index];
		const names = await children(path);
		if (segment === "**") {
			if (path !== ".") matches.add(path);
			for (const name of names) {
				const next = path === "." ? name : `${path}/${name}`;
				matches.add(next);
				if (next.split("/").length < 8) await expand(next, segments, index);
				else depthLimit = true;
			}
			return;
		}
		const selected = segment === "*" ? names : names.filter((name) => name === segment);
		for (const name of selected) await expand(path === "." ? name : `${path}/${name}`, segments, index + 1);
	}
	const boundedPatterns = patterns.slice(0, 128);
	if (patterns.length > 128) diagnostics.push(diagnostic("package", "workspace-pattern-limit", `Workspace discovery evaluated the first 128 patterns.`));
	for (const pattern of boundedPatterns) {
		const segments = patternSegments(pattern);
		if (segments === void 0) {
			diagnostics.push(diagnostic("package", "unsupported-workspace-pattern", "Ignored unsupported workspace pattern."));
			continue;
		}
		await expand(".", segments, 0);
	}
	if (depthLimit) diagnostics.push(diagnostic("package", "workspace-depth-limit", "Workspace traversal reached the depth limit."));
	if (directoryLimit) diagnostics.push(diagnostic("package", "workspace-directory-limit", `Workspace traversal inspected at most 256 directories.`));
	const sorted = [...matches].sort((left, right) => left.localeCompare(right, "en"));
	if (sorted.length > 64) {
		sorted.length = 64;
		diagnostics.push(diagnostic("package", "workspace-limit", `Workspace discovery returned the first 64 package directories.`));
	}
	return sorted;
}
function linkPackageDependencies(tasks, packages) {
	const byName = new Map(packages.flatMap((pkg) => pkg.name === void 0 ? [] : [[pkg.name, pkg]]));
	const tasksByWorkspace = /* @__PURE__ */ new Map();
	for (const task of tasks) {
		const existing = tasksByWorkspace.get(task.workspace) ?? [];
		existing.push(task);
		tasksByWorkspace.set(task.workspace, existing);
	}
	for (const pkg of packages) {
		const ownTasks = tasksByWorkspace.get(pkg.workspace) ?? [];
		const reachable = /* @__PURE__ */ new Set();
		const pending = [...pkg.dependencies];
		while (pending.length > 0) {
			const dependency = byName.get(pending.pop());
			if (dependency === void 0 || reachable.has(dependency.workspace)) continue;
			reachable.add(dependency.workspace);
			pending.push(...dependency.dependencies);
		}
		for (const own of ownTasks) {
			own.workspaceDependencies = [...reachable].sort();
			const dependencies = pkg.dependencies.flatMap((name) => {
				const dependency = byName.get(name);
				if (dependency === void 0) return [];
				return (tasksByWorkspace.get(dependency.workspace) ?? []).filter((candidate) => candidate.purpose === own.purpose && candidate.automatic !== false).map((candidate) => candidate.id);
			});
			own.dependsOn = [...new Set(dependencies)].sort((left, right) => left.localeCompare(right, "en"));
		}
	}
}
function makeTasks(manifest) {
	const lines = manifest.text.replaceAll("\r\n", "\n").split("\n");
	const names = /* @__PURE__ */ new Set();
	for (let index = 0; index < lines.length - 1; index += 1) {
		const line = lines[index];
		if (/^\s/u.test(line) || line.includes(":=") || line.includes("::")) continue;
		const separator = line.indexOf(":");
		if (separator <= 0 || !/^\t/u.test(lines[index + 1])) continue;
		for (const target of line.slice(0, separator).trim().split(/\s+/u)) {
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(target) || target.includes("%") || target.startsWith(".")) continue;
			names.add(target);
		}
	}
	return [...names].map((name) => ({
		id: `make:${name}`,
		name,
		description: `Run Make target ${JSON.stringify(name)}.`,
		source: "make",
		manifest: manifest.name,
		manifestDigest: manifest.digest,
		workspace: ".",
		purpose: taskPurpose(name),
		dependsOn: [],
		runnable: true,
		invocation: {
			kind: "make",
			target: name
		}
	}));
}
function justTasks(manifest) {
	const lines = manifest.text.replaceAll("\r\n", "\n").split("\n");
	const names = /* @__PURE__ */ new Set();
	for (let index = 0; index < lines.length - 1; index += 1) {
		const line = lines[index];
		if (/^\s/u.test(line) || line.startsWith("@")) continue;
		const match = /^([A-Za-z][A-Za-z0-9_-]*)([^:]*)\s*:/u.exec(line);
		if (match === null || match[2].trim() !== "" || !/^\s+\S/u.test(lines[index + 1])) continue;
		const name = match[1];
		if (name.startsWith("_")) continue;
		names.add(name);
	}
	return [...names].map((name) => ({
		id: `just:${name}`,
		name,
		description: `Run Just recipe ${JSON.stringify(name)}.`,
		source: "just",
		manifest: manifest.name,
		manifestDigest: manifest.digest,
		workspace: ".",
		purpose: taskPurpose(name),
		dependsOn: [],
		runnable: true,
		invocation: {
			kind: "just",
			recipe: name
		}
	}));
}
/** Discover bounded task declarations from the root and declared package workspaces. */
async function discoverProjectTasks(reader, signal) {
	const declarations = /* @__PURE__ */ new Map();
	const underlying = reader;
	reader = {
		async readCandidate(name, signal) {
			const bytes = await underlying.readCandidate(name, signal);
			declarations.set(name, bytes === void 0 ? "absent" : createHash("sha256").update(bytes).digest("hex"));
			return bytes;
		},
		lockfiles: (signal) => underlying.lockfiles(signal),
		listDirectories: (path, signal) => underlying.listDirectories(path, signal)
	};
	const diagnostics = [];
	for (const config of [
		"pnpm-lock.yaml",
		"package-lock.json",
		"npm-shrinkwrap.json",
		"yarn.lock",
		"bun.lock",
		"bun.lockb",
		".npmrc",
		".yarnrc.yml",
		"tsconfig.json",
		"turbo.json",
		"nx.json"
	]) {
		signal?.throwIfAborted();
		try {
			const bytes = await reader.readCandidate(config, signal);
			if (bytes !== void 0 && bytes.byteLength > 1048576) diagnostics.push(diagnostic("all", "config-too-large", "Configuration exceeds the 1 MiB freshness limit."));
		} catch {
			signal?.throwIfAborted();
			diagnostics.push(diagnostic("all", "config-read-failed", "Could not read project configuration."));
		}
	}
	const tasks = [];
	const packages = [];
	const rootManifest = await readManifest(reader, "package", "package.json", diagnostics, signal);
	const rootPackage = rootManifest === void 0 ? void 0 : parsePackage(rootManifest, ".", diagnostics);
	let rootManager = rootPackage?.manager;
	if (rootPackage !== void 0 && rootManager === void 0 && rootPackage.record.packageManager === void 0) {
		let selected;
		try {
			selected = packageManagerFromLocks(await reader.lockfiles(signal));
		} catch {
			signal?.throwIfAborted();
			diagnostics.push(diagnostic("package", "lockfile-read-failed", "Could not inspect project lockfiles."));
			selected = void 0;
		}
		if (selected === "ambiguous") diagnostics.push(diagnostic("package", "ambiguous-package-manager", "Multiple package-manager lockfiles are present."));
		else rootManager = selected;
		if (rootManager === void 0 && !diagnostics.some((row) => row.source === "package")) diagnostics.push(diagnostic("package", "package-manager-unavailable", "No packageManager field or unambiguous lockfile selects a runner."));
	}
	if (rootPackage !== void 0) {
		packages.push(rootPackage);
		tasks.push(...packageTasks(rootPackage, rootManager));
		const pnpmWorkspace = await readManifest(reader, "package", "pnpm-workspace.yaml", diagnostics, signal);
		const patterns = [...workspacePatternsFromPackage(rootPackage.record), ...pnpmWorkspace === void 0 ? [] : workspacePatternsFromPnpm(pnpmWorkspace.text, diagnostics)];
		const directories = await workspaceDirectories(reader, [...new Set(patterns)], diagnostics, signal);
		for (const workspace of directories) {
			const manifest = await readManifest(reader, "package", `${workspace}/package.json`, diagnostics, signal);
			if (manifest === void 0) continue;
			const pkg = parsePackage(manifest, workspace, diagnostics);
			if (pkg === void 0) continue;
			packages.push(pkg);
			tasks.push(...packageTasks(pkg, rootManager));
		}
	}
	const names = packages.flatMap((pkg) => pkg.name === void 0 ? [] : [pkg.name]);
	if (new Set(names).size !== names.length) diagnostics.push(diagnostic("package", "duplicate-package-name", "Local package names must be unique."));
	linkPackageDependencies(tasks, packages);
	const makeManifest = await readFirst(reader, "make", [
		"GNUmakefile",
		"makefile",
		"Makefile"
	], diagnostics, signal);
	if (makeManifest !== void 0) tasks.push(...makeTasks(makeManifest));
	const justManifest = await readFirst(reader, "just", ["justfile", "Justfile"], diagnostics, signal);
	if (justManifest !== void 0) tasks.push(...justTasks(justManifest));
	tasks.sort((left, right) => SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source] || left.id.localeCompare(right.id, "en"));
	if (tasks.length > 256) {
		tasks.length = 256;
		diagnostics.push(diagnostic("all", "task-limit", `Task discovery returned the first 256 declarations.`));
	}
	const contextDigest = createHash("sha256").update(JSON.stringify([...declarations].sort())).digest("hex");
	for (const task of tasks) {
		task.automatic ??= automaticTask(task.name);
		task.manifestDigest = createHash("sha256").update(JSON.stringify([
			contextDigest,
			task.manifestDigest,
			task.invocation
		])).digest("hex");
	}
	signal?.throwIfAborted();
	return {
		tasks,
		diagnostics
	};
}
//#endregion
//#region src/task-planning.ts
const GOAL_PURPOSES = {
	verify: /* @__PURE__ */ new Set([
		"test",
		"lint",
		"typecheck"
	]),
	build: /* @__PURE__ */ new Set(["build"]),
	all: /* @__PURE__ */ new Set([
		"test",
		"lint",
		"typecheck",
		"build"
	])
};
function digest(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function normalizeChangedFiles(paths) {
	if (paths.length < 1 || paths.length > 256) throw new Error("changedFiles must contain 1 through 256 paths");
	const normalized = /* @__PURE__ */ new Set();
	for (const value of paths) {
		if (typeof value !== "string" || [...value].length > 512) throw new Error("each changed file path must be at most 512 characters");
		if (value === "" || value.includes("\0") || /^[A-Za-z]:[\\/]/u.test(value)) throw new Error("changed file paths must be workspace-relative");
		const path = value.replaceAll("\\", "/");
		if (path.startsWith("/") || path.endsWith("/")) throw new Error("changed file paths must be workspace-relative");
		const segments = path.split("/").filter((segment) => segment !== ".");
		if (segments.length === 0 || segments.some((segment) => segment === "" || segment === "..")) throw new Error("changed file paths must be workspace-relative");
		normalized.add(segments.join("/"));
	}
	return [...normalized].sort((left, right) => left.localeCompare(right, "en"));
}
function taskOrder(left, right) {
	if (left.workspace === "." && right.workspace !== ".") return 1;
	if (left.workspace !== "." && right.workspace === ".") return -1;
	return left.id.localeCompare(right.id, "en");
}
function affectedWorkspaces(tasks, changedFiles) {
	const workspaces = [...new Set(tasks.flatMap((task) => [task.workspace, ...task.workspaceDependencies ?? []]).filter((workspace) => workspace !== "."))].sort((left, right) => right.length - left.length || left.localeCompare(right, "en"));
	const affected = /* @__PURE__ */ new Set();
	let rootChange = false;
	for (const file of changedFiles) {
		const workspace = workspaces.find((candidate) => file === candidate || file.startsWith(`${candidate}/`));
		if (workspace === void 0) rootChange = true;
		else affected.add(workspace);
	}
	if (rootChange) for (const workspace of workspaces) affected.add(workspace);
	const byId = new Map(tasks.map((task) => [task.id, task]));
	let changed = true;
	while (changed) {
		changed = false;
		for (const task of tasks) {
			if (task.workspace === "." || affected.has(task.workspace)) continue;
			if (task.workspaceDependencies?.some((workspace) => affected.has(workspace)) || task.dependsOn.some((id) => {
				const dependency = byId.get(id);
				return dependency !== void 0 && dependency.workspace !== "." && affected.has(dependency.workspace);
			})) {
				affected.add(task.workspace);
				changed = true;
			}
		}
	}
	return [...affected].sort((left, right) => left.localeCompare(right, "en"));
}
function dependencyClosure(initial, tasks) {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const selected = new Map(initial.map((task) => [task.id, task]));
	const pending = [...initial];
	while (pending.length > 0) {
		const task = pending.pop();
		for (const id of task.dependsOn) {
			const dependency = byId.get(id);
			if (dependency === void 0 || !dependency.runnable || dependency.automatic === false || selected.has(id)) continue;
			selected.set(id, dependency);
			pending.push(dependency);
		}
	}
	return [...selected.values()];
}
function topologicalOrder(tasks, diagnostics) {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const indegree = new Map(tasks.map((task) => [task.id, 0]));
	const dependents = /* @__PURE__ */ new Map();
	for (const task of tasks) for (const dependency of task.dependsOn) {
		if (!byId.has(dependency)) continue;
		indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
		const rows = dependents.get(dependency) ?? [];
		rows.push(task.id);
		dependents.set(dependency, rows);
	}
	const ready = tasks.filter((task) => indegree.get(task.id) === 0).sort(taskOrder);
	const ordered = [];
	while (ready.length > 0) {
		const task = ready.shift();
		ordered.push(task);
		for (const id of dependents.get(task.id) ?? []) {
			const next = (indegree.get(id) ?? 1) - 1;
			indegree.set(id, next);
			if (next === 0) {
				ready.push(byId.get(id));
				ready.sort(taskOrder);
			}
		}
	}
	if (ordered.length !== tasks.length) {
		diagnostics.push({
			source: "all",
			code: "task-dependency-cycle",
			message: "Affected tasks contain a dependency cycle; cyclic tasks use stable order."
		});
		const included = new Set(ordered.map((task) => task.id));
		ordered.push(...tasks.filter((task) => !included.has(task.id)).sort(taskOrder));
	}
	return ordered;
}
/** Build a stable, bounded execution plan from explicit workspace-relative changes. */
function createTaskPlan(tasks, changedFileInput, goal, discoveryDiagnostics = []) {
	if (!(goal in GOAL_PURPOSES)) throw new Error("goal must be verify, build, or all");
	const changedFiles = normalizeChangedFiles(changedFileInput);
	const workspaces = affectedWorkspaces(tasks, changedFiles);
	const workspaceSet = new Set(workspaces);
	const purposes = GOAL_PURPOSES[goal];
	const initial = tasks.filter((task) => task.runnable && task.automatic !== false && purposes.has(task.purpose) && (task.workspace === "." || workspaceSet.has(task.workspace)));
	const diagnostics = [...discoveryDiagnostics];
	const planned = topologicalOrder(dependencyClosure(initial, tasks), diagnostics);
	if (planned.some((task) => task.dependsOn.some((id) => tasks.find((candidate) => candidate.id === id)?.automatic === false))) diagnostics.push({
		source: "all",
		code: "manual-task-dependency",
		message: "An automatic task depends on a task requiring explicit execution."
	});
	const changedFilesDigest = digest(changedFiles);
	return {
		planVersion: 1,
		goal,
		changedFiles,
		changedFilesDigest,
		planDigest: digest({
			planVersion: 1,
			goal,
			changedFilesDigest,
			affectedWorkspaces: workspaces,
			diagnostics: diagnostics.map((row) => row.code),
			tasks: planned.map((task) => ({
				id: task.id,
				manifestDigest: task.manifestDigest,
				dependsOn: task.dependsOn.filter((id) => planned.some((candidate) => candidate.id === id))
			}))
		}),
		affectedWorkspaces: workspaces,
		tasks: planned,
		diagnostics
	};
}
//#endregion
//#region src/verification-gate.ts
const REASON_ORDER = [
	"discovery-incomplete",
	"no-required-tasks",
	"plan-digest-mismatch",
	"task-set-changed",
	"manifest-changed",
	"receipt-task-mismatch",
	"missing-receipt",
	"running-receipt",
	"unsuccessful-receipt"
];
function latestReceipt(receipts) {
	const risk = {
		succeeded: 0,
		running: 1,
		failed: 2,
		blocked: 3,
		aborted: 4,
		unavailable: 5
	};
	const terminalDispatches = new Set(receipts.filter((receipt) => receipt.outcome !== "running").map((receipt) => JSON.stringify([
		receipt.startedAt,
		receipt.nestedCallId,
		receipt.jobId
	])));
	return [...receipts.filter((receipt) => receipt.outcome !== "running" || !terminalDispatches.has(JSON.stringify([
		receipt.startedAt,
		receipt.nestedCallId,
		receipt.jobId
	])))].sort((left, right) => {
		const time = Date.parse(right.startedAt) - Date.parse(left.startedAt);
		if (time !== 0) return time;
		const outcome = risk[right.outcome] - risk[left.outcome];
		if (outcome !== 0) return outcome;
		return JSON.stringify(right).localeCompare(JSON.stringify(left), "en");
	})[0];
}
function orderedReasons(reasons) {
	return REASON_ORDER.filter((reason) => reasons.has(reason));
}
/** Evaluate only fresh, task-scoped receipts against a freshly recomputed plan. */
function evaluateVerificationGate(plan, tasks, receipts, expectedPlanDigest = plan.planDigest) {
	if (!/^[a-f0-9]{64}$/u.test(expectedPlanDigest)) throw new Error("planDigest must be a lowercase SHA-256 digest");
	for (const receipt of receipts) if (![2, 3].includes(receipt.receiptVersion) || !Number.isFinite(Date.parse(receipt.startedAt))) throw new Error("receipts must contain valid version-2 or version-3 execution receipts");
	const reasons = /* @__PURE__ */ new Set();
	if (plan.diagnostics.length > 0) reasons.add("discovery-incomplete");
	if (plan.tasks.length === 0) reasons.add("no-required-tasks");
	const requiredTaskIds = plan.tasks.map((task) => task.id);
	const currentById = new Map(tasks.map((task) => [task.id, task]));
	const receiptByTask = /* @__PURE__ */ new Map();
	for (const taskId of requiredTaskIds) {
		const selected = latestReceipt(receipts.filter((receipt) => receipt.taskId === taskId));
		if (selected !== void 0) receiptByTask.set(taskId, selected);
	}
	const missingTaskIds = [];
	const runningTaskIds = [];
	const failedTaskIds = [];
	const staleTaskIds = [];
	if (expectedPlanDigest !== plan.planDigest) reasons.add("plan-digest-mismatch");
	for (const planned of plan.tasks) {
		const current = currentById.get(planned.id);
		if (current === void 0) {
			staleTaskIds.push(planned.id);
			reasons.add("task-set-changed");
			continue;
		}
		if (current.manifestDigest !== planned.manifestDigest) {
			staleTaskIds.push(planned.id);
			reasons.add("manifest-changed");
			continue;
		}
		const receipt = receiptByTask.get(planned.id);
		if (receipt === void 0) {
			missingTaskIds.push(planned.id);
			reasons.add("missing-receipt");
			continue;
		}
		if (receipt.manifestDigest !== current.manifestDigest) {
			staleTaskIds.push(planned.id);
			reasons.add("manifest-changed");
			continue;
		}
		if (receipt.source !== current.source || receipt.workspace !== current.workspace || receipt.purpose !== current.purpose) {
			staleTaskIds.push(planned.id);
			reasons.add("receipt-task-mismatch");
			continue;
		}
		if (receipt.outcome === "running") {
			runningTaskIds.push(planned.id);
			reasons.add("running-receipt");
		} else if (receipt.outcome !== "succeeded" || receipt.exitCode !== 0) {
			failedTaskIds.push(planned.id);
			reasons.add("unsuccessful-receipt");
		}
	}
	return {
		gateVersion: 1,
		verdict: expectedPlanDigest !== plan.planDigest || staleTaskIds.length > 0 ? "stale" : failedTaskIds.length > 0 || plan.diagnostics.length > 0 ? "failed" : missingTaskIds.length > 0 || runningTaskIds.length > 0 || plan.tasks.length === 0 ? "pending" : "passed",
		planDigest: plan.planDigest,
		requiredTaskIds,
		missingTaskIds,
		runningTaskIds,
		failedTaskIds,
		staleTaskIds,
		reasonCodes: orderedReasons(reasons)
	};
}
//#endregion
//#region src/project-ops.ts
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const receiptHash = (receipt) => sha(Object.entries(receipt).filter(([, value]) => value !== void 0).sort(([left], [right]) => left.localeCompare(right, "en")));
/** Shared execution policy; records correlation and evidence, never schedules or owns native jobs. */
var ProjectOpsService = class {
	host;
	evidence = /* @__PURE__ */ new Map();
	active = true;
	inflight = 0;
	sequence = 0;
	constructor(host) {
		this.host = host;
		if (host.apiVersion !== 1) throw new Error("unsupported Project Ops host API version");
	}
	dispose() {
		this.active = false;
		this.evidence.clear();
	}
	async scope(call) {
		if (!this.active) throw new Error("Project Ops plugin is disposed");
		this.host.signal(call).throwIfAborted();
		const scope = await this.host.scope(call);
		if (!this.active) throw new Error("Project Ops plugin is disposed");
		if (!scope.identity) throw new Error("Project Ops requires an owning project identity");
		return scope;
	}
	async snapshot(scope, call) {
		try {
			const digest = await scope.snapshot?.(this.host.signal(call));
			return digest !== void 0 && /^[a-f0-9]{64}$/u.test(digest) ? digest : void 0;
		} catch {
			this.host.signal(call).throwIfAborted();
			return;
		}
	}
	async list(call) {
		return discoverProjectTasks((await this.scope(call)).reader, this.host.signal(call));
	}
	async plan(call, args) {
		const scope = await this.scope(call);
		const found = await discoverProjectTasks(scope.reader, this.host.signal(call));
		const plan = createTaskPlan(found.tasks, args.changedFiles, args.goal, found.diagnostics);
		const sourceDigest = await this.snapshot(scope, call);
		return {
			...plan,
			planDigest: sha([
				scope.identity,
				plan.planDigest,
				sourceDigest ?? null
			]),
			sourceDigest,
			snapshotStatus: sourceDigest === void 0 ? "unavailable" : "available"
		};
	}
	async task(call, args) {
		if (typeof args.taskId !== "string" || args.taskId.trim() === "" || args.taskId.length > 256) throw new Error("invalid taskId");
		if (!/^[a-f0-9]{64}$/u.test(args.manifestDigest)) throw new Error("manifestDigest must be a lowercase SHA-256 digest");
		const discovered = await this.list(call);
		if (discovered.diagnostics.length) throw new Error("task discovery is incomplete; resolve diagnostics before execution");
		const task = discovered.tasks.find((row) => row.id === args.taskId);
		if (!task) throw new Error("project task is not declared");
		if (task.manifestDigest !== args.manifestDigest) throw new Error("project task manifest changed; list tasks again");
		if (!task.runnable || !task.invocation) throw new Error("project task is not runnable");
		return task;
	}
	remember(id, entry, receipt, after) {
		const bound = {
			...receipt,
			receiptVersion: 3,
			executionId: id,
			...entry.before === void 0 ? {} : { sourceDigest: entry.before },
			freshness: entry.before === void 0 || after === void 0 ? "unavailable" : entry.before === after ? "stable" : "changed"
		};
		if (entry.receipts.some((row) => row.freshness === "changed")) bound.freshness = "changed";
		entry.receipts = [...entry.receipts.filter((row) => row.outcome !== bound.outcome), structuredClone(bound)];
		if (this.active) this.evidence.set(id, entry);
		return bound;
	}
	async run(call, args) {
		const scope = await this.scope(call);
		if (!this.host.execute) throw new Error("native execution adapter unavailable");
		if (args.mode !== void 0 && ![
			"auto",
			"foreground",
			"background"
		].includes(args.mode)) throw new Error("invalid execution mode");
		if (args.waitMs !== void 0 && (!Number.isInteger(args.waitMs) || args.waitMs < 1 || args.waitMs > 1e4)) throw new Error("invalid waitMs");
		for (const [id, entry] of this.evidence) {
			if (this.evidence.size < 1024) break;
			if (!entry.dispatching && entry.receipts.at(-1)?.outcome !== "running") this.evidence.delete(id);
		}
		if (this.evidence.size + this.inflight >= 4096) throw new Error("Project Ops active evidence limit reached; collect native jobs");
		this.inflight++;
		try {
			const before = await this.snapshot(scope, call);
			const task = await this.task(call, args);
			if (!this.active) throw new Error("Project Ops plugin is disposed");
			this.host.signal(call).throwIfAborted();
			const id = randomUUID();
			const entry = {
				order: ++this.sequence,
				dispatching: true,
				scope: scope.identity,
				task,
				receipts: [],
				...before === void 0 ? {} : { before }
			};
			this.evidence.set(id, entry);
			try {
				const result = await this.host.execute(structuredClone(task), args, call);
				const after = await this.snapshot(scope, call);
				const receipt = this.remember(id, entry, result.receipt, after);
				return {
					nestedContent: result.nestedContent,
					receipt
				};
			} finally {
				entry.dispatching = false;
			}
		} finally {
			this.inflight--;
		}
	}
	async collect(call, args) {
		const scope = await this.scope(call);
		if (!this.host.collect) throw new Error("native collection adapter unavailable");
		const pair = [...this.evidence].find(([, entry]) => entry.scope === scope.identity && entry.receipts.some((row) => row.taskId === args.taskId && row.manifestDigest === args.manifestDigest && row.jobId === args.jobId && row.nestedCallId === args.nestedCallId && row.startedAt === args.startedAt));
		if (!pair) throw new Error("background job does not belong to this Project Ops dispatch; use native Jobs after reload");
		const [id, entry] = pair;
		const result = await this.host.collect(structuredClone(entry.task), args, call);
		return {
			nestedContent: result.nestedContent,
			receipt: this.remember(id, entry, result.receipt, await this.snapshot(scope, call))
		};
	}
	async gate(call, args) {
		const scope = await this.scope(call);
		const plan = await this.plan(call, args);
		const gate = evaluateVerificationGate(plan, plan.tasks, args.receipts, args.planDigest);
		const newest = /* @__PURE__ */ new Map();
		for (const [id, entry] of this.evidence) if (entry.scope === scope.identity && (newest.get(entry.task.id)?.order ?? 0) < entry.order) newest.set(entry.task.id, {
			id,
			order: entry.order
		});
		const invalid = plan.tasks.flatMap((task) => {
			const receipt = latestReceipt(args.receipts.filter((row) => row.taskId === task.id));
			return receipt ? [receipt] : [];
		}).filter((receipt) => {
			const entry = receipt.executionId === void 0 ? void 0 : this.evidence.get(receipt.executionId);
			return receipt.receiptVersion !== 3 || !entry || entry.scope !== scope.identity || newest.get(receipt.taskId)?.id !== receipt.executionId || !entry.receipts.some((row) => receiptHash(row) === receiptHash(receipt)) || receipt.freshness !== "stable" || !plan.sourceDigest || receipt.sourceDigest !== plan.sourceDigest;
		});
		if (invalid.length || !plan.sourceDigest) {
			gate.verdict = "stale";
			gate.reasonCodes.push(plan.sourceDigest ? "execution-evidence-stale" : "source-snapshot-unavailable");
			gate.staleTaskIds = [.../* @__PURE__ */ new Set([...gate.staleTaskIds, ...invalid.map((row) => row.taskId)])].sort();
		}
		return gate;
	}
	async search(call, query, limit = 5) {
		const found = await this.list(call);
		return { matches: rankCapabilities(query, [...this.host.tools?.(call) ?? [], ...found.tasks.map((task) => ({
			source: "project-task",
			id: task.id,
			name: task.name,
			description: task.description
		}))], limit) };
	}
	async doctor(call) {
		const scope = await this.scope(call);
		return {
			apiVersion: 1,
			...this.host.capabilities(call),
			executionAdapter: this.host.execute !== void 0,
			collectionAdapter: this.host.collect !== void 0,
			sourceSnapshot: await this.snapshot(scope, call) !== void 0,
			runnerDependencies: "unknown",
			guidance: "Host must expose tools and load the packaged Agent contract."
		};
	}
	async cancel(call, executionId) {
		const scope = await this.scope(call);
		const entry = this.evidence.get(executionId);
		if (!entry || entry.scope !== scope.identity) throw new Error("unknown Project Ops execution");
		if (!this.host.cancel) throw new Error("use native host cancellation");
		await this.host.cancel(structuredClone(entry.receipts.at(-1)), call);
	}
};
//#endregion
//#region src/source-snapshot.ts
const SNAPSHOT_LIMITS = {
	entries: 8192,
	depth: 32,
	fileBytes: 8388608,
	totalBytes: 67108864
};
/** Bounded project content, including untracked files; excludes only VCS metadata and dependencies. */
async function sourceSnapshot(reader, signal, options = {}) {
	const hash = createHash("sha256");
	if (options.outputDirectories !== void 0 && !Array.isArray(options.outputDirectories)) throw new Error("outputDirectories must be an array");
	const outputs = [...new Set(options.outputDirectories ?? [])].sort();
	if (outputs.length > 32 || outputs.some((path) => typeof path !== "string" || path.length > 512 || !path || /[\\\0*]/u.test(path) || path.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":")))) throw new Error("outputDirectories must contain at most 32 explicit relative directories");
	hash.update(JSON.stringify(["project-source-v1", outputs]));
	let count = 0;
	let bytes = 0;
	async function visit(path, depth) {
		signal.throwIfAborted();
		if (depth > SNAPSHOT_LIMITS.depth) throw new Error("source snapshot depth limit");
		const rows = [...await reader.entries(path, signal)].sort((a, b) => a.name.localeCompare(b.name, "en"));
		const names = /* @__PURE__ */ new Set();
		for (const row of rows) {
			if (++count > SNAPSHOT_LIMITS.entries) throw new Error("source snapshot entry limit");
			if (!row.name || row.name === "." || row.name === ".." || /[\\/\0]/u.test(row.name) || names.has(row.name)) throw new Error("invalid source snapshot entry");
			names.add(row.name);
			if (row.name === ".git" || row.name === "node_modules") continue;
			const child = path === "." ? row.name : `${path}/${row.name}`;
			if (outputs.includes(child)) {
				if (row.type !== "directory") throw new Error("declared output must be a directory");
				continue;
			}
			hash.update(JSON.stringify([child, row.type]));
			if (row.type === "directory") await visit(child, depth + 1);
			else if (row.type === "file") {
				const data = await reader.read(child, SNAPSHOT_LIMITS.fileBytes, signal);
				bytes += data.byteLength;
				if (data.byteLength > SNAPSHOT_LIMITS.fileBytes || bytes > SNAPSHOT_LIMITS.totalBytes) throw new Error("source snapshot byte limit");
				hash.update(createHash("sha256").update(data).digest());
			} else throw new Error("source snapshot does not follow symlinks or special files");
		}
	}
	await visit(".", 0);
	signal.throwIfAborted();
	return hash.digest("hex");
}
//#endregion
//#region src/agent-guidance.ts
/**
* Short, host-injected onboarding contract for a freshly started Agent.
* The full reference is shipped as docs/AGENT_USAGE.md; keep this prompt
* procedural and bounded so it remains useful in every project.
*/
const PROJECT_OPS_AGENT_GUIDANCE = [
	"# Project Ops task workflow",
	"",
	"Use Project Ops for substantial authorized development tasks and declared project checks/builds. Keep the host native execution tools, Jobs, approvals, sandboxing, and cancellation as the authority. Missing host capabilities must be reported, never bypassed.",
	"",
	"For substantial development, first use missher_project_ops_document_read to resume an existing task; otherwise begin with document_write and provide requirements, design, steps, acceptance and actual progress. Keep each task isolated. Ordinary questions and tiny edits do not require documents. Continue authorized implementation after PLAN is saved; do not introduce an approval gate.",
	"Update PLAN at meaningful progress/requirement changes and before interruption. Explicitly record failed or cancelled state when known. After acceptance review, finish with a factual delivery report, linking existing verification receipts when available. Never equate reply completion, shell exit, or a passed verification gate with full delivery, publication, installation or platform acceptance. Missing evidence stays unverified; do not automatically push Git or invoke another model.",
	"",
	"1. Call `missher_project_ops_task_list` when you need to understand the project task map.",
	"2. Call `missher_project_ops_task_plan` with explicit workspace-relative `changedFiles` and a `goal` (`verify`, `build`, or `all`). Resolve every discovery diagnostic before executing.",
	"3. Run planned tasks in the returned order, waiting for dependencies to succeed before starting their dependents. Pass the exact task `id` and `manifestDigest`; prefer `auto` for short or uncertain work and `background` for work that should continue. Never invent shell text or rerun a task because a wait expired. Tasks marked automatic=false require explicit selection.",
	"4. Track every running receipt. Use `missher_project_ops_task_collect` with the original task, digest, job, call, and start fields. Use native `job_output` or `job_kill` when a job survives plugin reload or no longer matters.",
	"5. Call `missher_project_ops_verification_gate` with the same changed files, goal, plan digest, and all relevant receipts. Source edits invalidate old evidence; unavailable snapshots are not verification. Treat `stale`, `failed`, `pending`, and discovery diagnostics as requiring more work; only `passed` satisfies this verification gate, not the whole development task.",
	"",
	"Do not pass arbitrary commands, bypass a denied shell call, treat output text as proof, or claim a check passed without a zero-exit receipt."
].join("\n");
const PROJECT_OPS_AGENT_GUIDANCE_SECTION = "missher-project-ops:agent-guidance";
//#endregion
export { ProjectOpsService as a, sourceSnapshot as i, PROJECT_OPS_AGENT_GUIDANCE_SECTION as n, MAX_MANIFEST_BYTES as o, SNAPSHOT_LIMITS as r, PROJECT_OPS_AGENT_GUIDANCE as t };
