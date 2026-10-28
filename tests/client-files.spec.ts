import { expect, test } from 'vitest'
import {
  dedupeFiles, fileKind, filterFiles, formatSize, isExecutable, parentPath, previewKind,
  safeFilePath, sortFileEntries, underRoot, type FileEntryView,
} from '../src/client/files.ts'

test('file kinds label known types and never hide unknown suffixes', () => {
  expect(fileKind('setup.exe')).toBe('executable')
  expect(fileKind('App.AppImage')).toBe('executable')
  expect(fileKind('报告 2026.xlsx')).toBe('sheet')
  expect(fileKind('说明.pdf')).toBe('pdf')
  expect(fileKind('cover.PNG')).toBe('image')
  expect(fileKind('产物.zip')).toBe('archive')
  expect(fileKind('产物.weird')).toBe('binary')
  expect(fileKind('LICENSE')).toBe('other')
  expect(fileKind('docs', 'directory')).toBe('directory')
  // Preview support is a display choice; a missing preview never removes the row.
  expect(previewKind('报告 2026.xlsx')).toBe('sheet')
  expect(previewKind('说明.pdf')).toBe('pdf')
  expect(previewKind('cover.png')).toBe('image')
  expect(previewKind('setup.exe')).toBeUndefined()
  expect(previewKind('产物.weird')).toBeUndefined()
  expect(isExecutable('setup.exe')).toBe(true)
  expect(isExecutable('App.dmg')).toBe(true)
  expect(isExecutable('报告 2026.xlsx')).toBe(false)
})

test('directory paths stay inside one approved root', () => {
  expect(safeFilePath('dist/app.exe')).toBe(true)
  expect(safeFilePath('产出 目录/报告.xlsx')).toBe(true)
  expect(safeFilePath('/etc/passwd')).toBe(false)
  expect(safeFilePath('C:\\Windows')).toBe(false)
  expect(safeFilePath('dist/../../secret')).toBe(false)
  expect(safeFilePath('a\\b')).toBe(false)
  expect(underRoot('.', 'docs/x')).toBe(true)
  expect(underRoot('dist', 'dist/app.exe')).toBe(true)
  expect(underRoot('dist', 'dist2/app.exe')).toBe(false)
  expect(parentPath('dist', 'dist/a/b.exe')).toBe('dist/a')
  expect(parentPath('dist', 'dist/a.exe')).toBe('dist')
  expect(parentPath('.', 'docs/a.md')).toBe('docs')
  expect(parentPath('.', 'a.md')).toBe('.')
})

test('sizes are explicit, and an unknown size is never guessed', () => {
  expect(formatSize(undefined)).toBe('—')
  expect(formatSize(512)).toBe('512 B')
  expect(formatSize(2048)).toBe('2.0 KB')
  expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
})

const row = (path: string, type: 'file' | 'directory' = 'file', size?: number): FileEntryView => {
  const item: FileEntryView = { path, name: path.split('/').at(-1)!, root: '.', type, sessionId: 'session' }
  if (size !== undefined) item.size = size
  return item
}

test('directories sort first and same names in different paths stay distinct', () => {
  const sorted = sortFileEntries([row('b/同名.exe'), row('docs', 'directory'), row('a/同名.exe')])
  expect(sorted[0]!.type).toBe('directory')
  expect(sorted.map(entry => entry.path)).toContain('a/同名.exe')
  expect(sorted.map(entry => entry.path)).toContain('b/同名.exe')
  expect(new Set(sorted.map(entry => entry.path)).size).toBe(3)
  expect(dedupeFiles([row('a/x'), row('a/x'), row('b/x')])).toHaveLength(2)
})

test('local file search matches names and paths only', () => {
  const entries = [row('dist/报告 2026.xlsx'), row('build/setup.exe')]
  expect(filterFiles(entries, '报告')).toHaveLength(1)
  expect(filterFiles(entries, 'build')).toHaveLength(1)
  expect(filterFiles(entries, '')).toHaveLength(2)
  expect(filterFiles(entries, '不存在')).toHaveLength(0)
})
