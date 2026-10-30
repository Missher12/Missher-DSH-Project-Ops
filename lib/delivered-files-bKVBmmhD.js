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
export { isDeliveredFiles as i, FILE_CATEGORIES as n, fileCategory as r, FILES_PROJECTION as t };
