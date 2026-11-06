/** Browser-safe view of the Host's durable file-delivery history. */
export const FILES_PROJECTION = 'missherProjectOpsFiles'
export interface DeliveredFile {
  path: string
  description?: string | undefined
  updatedAt: number
}
export interface DeliveredFiles {
  files: DeliveredFile[]
  truncated: boolean
}
export interface FilesResult extends DeliveredFiles { unavailable?: boolean }

export const FILE_CATEGORIES = ['word', 'excel', 'slides', 'pdf', 'image', 'media', 'other'] as const
export type FileCategory = typeof FILE_CATEGORIES[number]
export type PanelCategory = 'all' | 'plans' | 'search' | FileCategory

/** Classify the actual format, never words such as “方案” in a filename. */
export function fileCategory(path: string): FileCategory {
  const extension = /\.([^.]+)$/u.exec(path.split(/[\\/]/u).at(-1) ?? '')?.[1]?.toLowerCase()
  if (extension && ['doc', 'docx', 'docm', 'odt', 'rtf'].includes(extension)) return 'word'
  if (extension && ['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv'].includes(extension)) return 'excel'
  if (extension && ['ppt', 'pptx', 'pptm', 'odp'].includes(extension)) return 'slides'
  if (extension === 'pdf') return 'pdf'
  if (extension && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tif', 'tiff'].includes(extension)) return 'image'
  if (extension && ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'mov', 'webm', 'mkv', 'avi'].includes(extension)) return 'media'
  return 'other'
}

/** Missing or incompatible projections are an unavailable capability, not an empty list. */
export function isDeliveredFiles(value: unknown): value is DeliveredFiles {
  if (typeof value !== 'object' || value === null) return false
  const row = value as DeliveredFiles
  return typeof row.truncated === 'boolean' && Array.isArray(row.files) && row.files.length <= 1000 && row.files.every(file =>
    typeof file?.path === 'string' && file.path.trim() !== '' && file.path.length <= 4096 && !/[\u0000-\u001f]/u.test(file.path)
    && typeof file.updatedAt === 'number' && Number.isFinite(file.updatedAt)
    && (file.description === undefined || typeof file.description === 'string'))
}
