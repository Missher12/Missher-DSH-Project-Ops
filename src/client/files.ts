/**
 * Project file artifacts: bounded, on-demand browsing of real workspace
 * directories.
 *
 * Pure module (no Node import, no React): the shell reads, the panel renders.
 * Discovery is by directory listing only — never by extension whitelist — so
 * EXE, XLSX, ZIP and unknown suffixes are all listed. A row exists because the
 * Host listing returned it just now, so its existence is the listing's fact, not
 * a guess. Attribution is honest: without a persistent presented record these
 * are "project files, producing session unconfirmed".
 */

/** Output roots browsed on demand; `.` is the project root itself. */
export const FILE_ROOTS = ['.', 'dist', 'build', 'out', 'exports', 'release'] as const
export type FileRoot = typeof FILE_ROOTS[number]

/** Rows per displayed page. The Host caps one directory listing separately. */
export const FILE_PAGE = 40

/** File kinds used for display labels only, never for discovery. */
export type FileKind = 'directory' | 'image' | 'pdf' | 'sheet' | 'document' | 'archive' | 'executable' | 'binary' | 'text' | 'other'

/** One file or directory row of the current page. */
export interface FileEntryView {
  /** Workspace-relative path. */
  path: string
  /** Trailing segment. */
  name: string
  /** Root that produced the row. */
  root: string
  type: 'file' | 'directory'
  /** Bytes when the Host reported them; unknown stays unknown. */
  size?: number
  /** Session whose workspace produced this row: the preview must use it. */
  sessionId: string
}

/** One registered project the files view can browse. */
export interface ProjectOption {
  workspaceId: string
  path: string
  title: string
  /** A session whose cwd is exactly this project path exists. */
  readable: boolean
}

/** One bounded page of one directory. */
export interface FilesPage {
  root: string
  /** Directory being listed, workspace-relative or `.`. */
  path: string
  sessionId: string
  entries: FileEntryView[]
  /** Entries the Host returned for this directory (before display paging). */
  total: number
  nextOffset: number
  /** The Host's own listing cap cut this directory. */
  truncated: boolean
  /** The directory does not exist in this project (for example not built yet). */
  missing?: boolean
  /** Read problems and skipped exotic entries; never a silent empty page. */
  warnings: string[]
}

const EXTENSIONS: Readonly<Record<FileKind, readonly string[]>> = {
  directory: [],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'],
  pdf: ['pdf'],
  sheet: ['xlsx', 'xls', 'csv', 'tsv', 'xlsm', 'ods'],
  document: ['docx', 'doc', 'pptx', 'ppt', 'odt', 'odp', 'rtf', 'md', 'txt', 'html', 'htm'],
  archive: ['zip', '7z', 'gz', 'tgz', 'tar', 'bz2', 'xz', 'rar'],
  executable: ['exe', 'msi', 'dmg', 'appimage', 'bat', 'cmd', 'com', 'sh'],
  binary: [],
  text: [],
  other: [],
}

/** Lower-case trailing extension without the dot, or empty. */
export function extensionOf(name: string): string {
  const at = name.lastIndexOf('.')
  return at === -1 || at === name.length - 1 ? '' : name.slice(at + 1).toLowerCase()
}

/** Display kind of a file name. Extension knowledge only shapes labels and actions. */
export function fileKind(name: string, type: 'file' | 'directory' = 'file'): FileKind {
  if (type === 'directory') return 'directory'
  const extension = extensionOf(name)
  for (const kind of ['image', 'pdf', 'sheet', 'document', 'archive', 'executable'] as const) {
    if (EXTENSIONS[kind].includes(extension)) return kind
  }
  return extension === '' ? 'other' : 'binary'
}

/** Whether the native preview can open this file by name; other files keep their row. */
export function previewKind(name: string): 'image' | 'pdf' | 'sheet' | 'document' | undefined {
  const kind = fileKind(name)
  return kind === 'image' || kind === 'pdf' || kind === 'sheet' || kind === 'document' ? kind : undefined
}

/** Whether this name is an executable artifact that must never be launched from a click. */
export function isExecutable(name: string): boolean {
  return fileKind(name) === 'executable'
}

/** Whether a requested directory stays inside one approved root. */
export function safeFilePath(path: string): boolean {
  if (path.length === 0 || path.length > 4000) return false
  if (path.includes('\u0000') || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/u.test(path)) return false
  const segments = path.split('/')
  return segments.every(segment => segment !== '..' && segment.length > 0 || path === '.')
}

/** Whether a path belongs to the given approved root. */
export function underRoot(root: string, path: string): boolean {
  if (root === '.') return true
  return path === root || path.startsWith(`${root}/`)
}

/** Parent directory inside the root, or the root itself. */
export function parentPath(root: string, path: string): string {
  if (path === root || path === '.') return root
  const at = path.lastIndexOf('/')
  if (at === -1) return root
  const parent = path.slice(0, at)
  return parent === '' || parent.length < root.length ? root : parent
}

/** Human-readable size; unknown stays an explicit dash. */
export function formatSize(size: number | undefined): string {
  if (size === undefined || !Number.isFinite(size) || size < 0) return '—'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** Directories first, then a stable locale order, then path so same names stay distinct. */
export function sortFileEntries(entries: readonly FileEntryView[]): FileEntryView[] {
  return [...entries].sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
    const byName = left.name.localeCompare(right.name, 'zh-Hans-CN')
    return byName === 0 ? left.path.localeCompare(right.path) : byName
  })
}

/** Case-insensitive local search over the loaded file rows. */
export function filterFiles(entries: readonly FileEntryView[], query: string): FileEntryView[] {
  const needle = query.trim().toLowerCase()
  return needle.length === 0 ? [...entries] : entries.filter(entry => entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle))
}

/** Deduplicate rows by path, keeping the first occurrence. */
export function dedupeFiles(entries: readonly FileEntryView[]): FileEntryView[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.path)) return false
    seen.add(entry.path)
    return true
  })
}
