import { expect, test } from 'vitest'
import { fileCategory, isDeliveredFiles } from '../src/delivered-files.ts'

test.each([
  ['/out/方案.docx', 'word'], ['C:\\out\\预算.XLSX', 'excel'],
  ['data.csv', 'excel'], ['deck.pptx', 'slides'], ['report.PDF', 'pdf'],
  ['image.png', 'image'], ['clip.mp4', 'media'], ['archive.zip', 'other'],
  ['docs.xlsx/README', 'other'], ['docx', 'other'],
])('classifies the actual filename %s as %s', (path, category) => {
  expect(fileCategory(path)).toBe(category)
})

test('rejects unavailable and malformed history instead of presenting an empty success', () => {
  expect(isDeliveredFiles(undefined)).toBe(false)
  expect(isDeliveredFiles({ files: [{ path: '/out/a.docx' }], truncated: false })).toBe(false)
  expect(isDeliveredFiles({ files: [{ path: '/out/a\u0000.docx', updatedAt: 1 }], truncated: false })).toBe(false)
  expect(isDeliveredFiles({ files: [], truncated: false })).toBe(true)
})
