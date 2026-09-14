import { createHash } from 'node:crypto'

export interface SourceReader {
  entries(path: string, signal: AbortSignal): Promise<readonly { name: string; type: 'file' | 'directory' | 'unsupported' }[]>
  read(path: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>
}

export const SNAPSHOT_LIMITS = { entries: 8192, depth: 32, fileBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 } as const
export interface SnapshotOptions { outputDirectories?: readonly string[] }

/** Bounded project content, including untracked files; excludes only VCS metadata and dependencies. */
export async function sourceSnapshot(reader: SourceReader, signal: AbortSignal, options: SnapshotOptions = {}): Promise<string> {
  const hash = createHash('sha256')
  if (options.outputDirectories !== undefined && !Array.isArray(options.outputDirectories)) throw new Error('outputDirectories must be an array')
  const outputs = [...new Set(options.outputDirectories ?? [])].sort()
  if (outputs.length > 32 || outputs.some(path => typeof path !== 'string' || path.length > 512
    || !path || /[\\\0*]/u.test(path) || path.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.includes(':')))) {
    throw new Error('outputDirectories must contain at most 32 explicit relative directories')
  }
  hash.update(JSON.stringify(['project-source-v1', outputs]))
  let count = 0
  let bytes = 0
  async function visit(path: string, depth: number): Promise<void> {
    signal.throwIfAborted()
    if (depth > SNAPSHOT_LIMITS.depth) throw new Error('source snapshot depth limit')
    const rows = [...await reader.entries(path, signal)].sort((a, b) => a.name.localeCompare(b.name, 'en'))
    const names = new Set<string>()
    for (const row of rows) {
      if (++count > SNAPSHOT_LIMITS.entries) throw new Error('source snapshot entry limit')
      if (!row.name || row.name === '.' || row.name === '..' || /[\\/\0]/u.test(row.name) || names.has(row.name)) {
        throw new Error('invalid source snapshot entry')
      }
      names.add(row.name)
      if (row.name === '.git' || row.name === 'node_modules') continue
      const child = path === '.' ? row.name : `${path}/${row.name}`
      if (outputs.includes(child)) {
        if (row.type !== 'directory') throw new Error('declared output must be a directory')
        continue
      }
      hash.update(JSON.stringify([child, row.type]))
      if (row.type === 'directory') await visit(child, depth + 1)
      else if (row.type === 'file') {
        const data = await reader.read(child, SNAPSHOT_LIMITS.fileBytes, signal)
        bytes += data.byteLength
        if (data.byteLength > SNAPSHOT_LIMITS.fileBytes || bytes > SNAPSHOT_LIMITS.totalBytes) throw new Error('source snapshot byte limit')
        hash.update(createHash('sha256').update(data).digest())
      } else throw new Error('source snapshot does not follow symlinks or special files')
    }
  }
  await visit('.', 0)
  signal.throwIfAborted()
  return hash.digest('hex')
}
