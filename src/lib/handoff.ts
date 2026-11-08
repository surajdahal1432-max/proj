/**
 * Lightweight, in-memory hand-off of dropped files between routes.
 * Files never leave the browser — this only avoids asking the user to
 * re-select a document after the homepage suggests a workflow.
 */

export const HANDOFF_EVENT = 'folio:add-files'

let pending: File[] | null = null

export function stashFiles(files: File[]) {
  pending = files.length ? files : null
}

export function consumeStashedFiles(): File[] {
  const files = pending ?? []
  pending = null
  return files
}

export function dispatchHandoff(files: File[]) {
  if (!files.length) return
  window.dispatchEvent(new CustomEvent<File[]>(HANDOFF_EVENT, { detail: files }))
}

/** Maps a dropped file to the most useful workflow in Folio. */
export function suggestTool(ext: string, count: number): string {
  switch (ext) {
    case 'pdf':
      return count > 1 ? 'merge' : 'ai-workspace'
    case 'docx':
    case 'doc':
      return 'word-to-pdf'
    case 'xlsx':
    case 'xls':
    case 'csv':
      return 'excel-to-pdf'
    case 'pptx':
    case 'ppt':
      return 'powerpoint-to-pdf'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return 'image-to-pdf'
    case 'md':
    case 'markdown':
    case 'txt':
      return 'markdown-to-pdf'
    case 'html':
    case 'htm':
      return 'html-to-pdf'
    default:
      return 'merge'
  }
}

export const DROP_ACCEPT = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'md',
  'markdown',
  'txt',
  'html',
  'csv',
]
