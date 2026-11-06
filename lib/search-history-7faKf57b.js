//#region src/delivered-files.ts
/** Browser-safe view of the Host's durable file-delivery history. */
const FILES_PROJECTION = "missherProjectOpsFiles";
const FILE_CATEGORIES = [
	"word",
	"excel",
	"slides",
	"pdf",
	"image",
	"media",
	"other"
];
/** Classify the actual format, never words such as “方案” in a filename. */
function fileCategory(path) {
	const extension = /\.([^.]+)$/u.exec(path.split(/[\\/]/u).at(-1) ?? "")?.[1]?.toLowerCase();
	if (extension && [
		"doc",
		"docx",
		"docm",
		"odt",
		"rtf"
	].includes(extension)) return "word";
	if (extension && [
		"xls",
		"xlsx",
		"xlsm",
		"xlsb",
		"ods",
		"csv",
		"tsv"
	].includes(extension)) return "excel";
	if (extension && [
		"ppt",
		"pptx",
		"pptm",
		"odp"
	].includes(extension)) return "slides";
	if (extension === "pdf") return "pdf";
	if (extension && [
		"png",
		"jpg",
		"jpeg",
		"gif",
		"webp",
		"svg",
		"avif",
		"bmp",
		"tif",
		"tiff"
	].includes(extension)) return "image";
	if (extension && [
		"mp3",
		"wav",
		"m4a",
		"flac",
		"ogg",
		"mp4",
		"mov",
		"webm",
		"mkv",
		"avi"
	].includes(extension)) return "media";
	return "other";
}
/** Missing or incompatible projections are an unavailable capability, not an empty list. */
function isDeliveredFiles(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	return typeof row.truncated === "boolean" && Array.isArray(row.files) && row.files.length <= 1e3 && row.files.every((file) => typeof file?.path === "string" && file.path.trim() !== "" && file.path.length <= 4096 && !/[\u0000-\u001f]/u.test(file.path) && typeof file.updatedAt === "number" && Number.isFinite(file.updatedAt) && (file.description === void 0 || typeof file.description === "string"));
}
//#endregion
//#region src/search-history.ts
/**
* Browser-safe view of the native search results Project Ops records.
*
* Only structured tool metadata is stored: glob `meta.paths`, grep
* `meta.files[].path`, web_search `meta.sources[]` (title/url) and a successful
* web_fetch `meta.url`. Hit lines, snippets and page bodies never leave the
* event log, and free text is never parsed back into files.
*/
/** Projection key registered beside the delivered-files projection. */
const SEARCH_PROJECTION = "missherProjectOpsSearch";
/** The native tools whose structured result metadata is recorded. */
const SEARCH_MODES = [
	"glob",
	"grep",
	"web_search",
	"web_fetch",
	"session_search",
	"session_event_search"
];
/** Bounded retention: search history never crowds out delivered files. */
const SEARCH_LIMITS = {
	searches: 50,
	files: 100,
	sources: 50,
	error: 300
};
/** Whether a value names one of the recorded search modes. */
function isSearchMode(value) {
	return typeof value === "string" && SEARCH_MODES.includes(value);
}
/** An http(s) URL, or undefined for every other scheme and malformed value. */
function safeHttpUrl(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 4096) return void 0;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : void 0;
	} catch {
		return;
	}
}
const validText = (value, max) => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
function isSource(value) {
	if (typeof value !== "object" || value === null) return false;
	const source = value;
	return validText(source.title, 1e3) && safeHttpUrl(source.url) !== void 0;
}
function isEntry(value) {
	if (typeof value !== "object" || value === null) return false;
	const entry = value;
	return typeof entry.callId === "string" && entry.callId.length <= 200 && isSearchMode(entry.mode) && validText(entry.query, 4e3) && Array.isArray(entry.files) && entry.files.length <= SEARCH_LIMITS.files && entry.files.every((path) => validText(path, 4096)) && Array.isArray(entry.sources) && entry.sources.length <= SEARCH_LIMITS.sources && entry.sources.every(isSource) && (entry.opened === void 0 || safeHttpUrl(entry.opened) !== void 0) && typeof entry.total === "number" && Number.isFinite(entry.total) && typeof entry.truncated === "boolean" && (entry.error === void 0 || validText(entry.error, SEARCH_LIMITS.error)) && typeof entry.time === "number" && Number.isFinite(entry.time);
}
/** Missing or incompatible search projections are unavailable, not an empty history. */
function isSearchHistory(value) {
	if (typeof value !== "object" || value === null) return false;
	const history = value;
	return typeof history.truncated === "boolean" && Array.isArray(history.searches) && history.searches.length <= SEARCH_LIMITS.searches && history.searches.every(isEntry);
}
//#endregion
export { isSearchMode as a, FILE_CATEGORIES as c, isSearchHistory as i, fileCategory as l, SEARCH_MODES as n, safeHttpUrl as o, SEARCH_PROJECTION as r, FILES_PROJECTION as s, SEARCH_LIMITS as t, isDeliveredFiles as u };
