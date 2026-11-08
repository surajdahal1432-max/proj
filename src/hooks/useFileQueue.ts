import * as React from 'react'
import { closePdf, loadPdfFromFile, PdfPasswordError } from '@/lib/pdfjs'
import { extensionOf } from '@/lib/utils'
import { HANDOFF_EVENT } from '@/lib/handoff'

export interface QueueFileResult {
  name: string
  blob: Blob
  size: number
}

export interface QueueFile {
  id: string
  file: File
  name: string
  size: number
  ext: string
  pageCount: number | null
  status: 'ready' | 'processing' | 'done' | 'error'
  progress: number
  error?: string
  needsPassword?: boolean
  result?: QueueFileResult
}

export interface RejectedFile {
  name: string
  reason: string
}

interface UseFileQueueOptions {
  accept?: string[]
  multiple?: boolean
  detectPages?: boolean
}

let counter = 0
function nextId() {
  counter += 1
  return `f${Date.now().toString(36)}${counter}`
}

export function useFileQueue({ accept, multiple = false, detectPages = true }: UseFileQueueOptions = {}) {
  const [files, setFiles] = React.useState<QueueFile[]>([])
  const [loading, setLoading] = React.useState(false)
  const [rejected, setRejected] = React.useState<RejectedFile[]>([])

  const inspect = React.useCallback(
    async (entry: QueueFile): Promise<QueueFile> => {
      if (!detectPages || entry.ext !== 'pdf') return entry
      try {
        const doc = await loadPdfFromFile(entry.file)
        const pageCount = doc.numPages
        void closePdf(doc)
        return { ...entry, pageCount }
      } catch (error) {
        if (error instanceof PdfPasswordError) {
          return { ...entry, needsPassword: true }
        }
        return { ...entry, error: error instanceof Error ? error.message : 'Could not read file' }
      }
    },
    [detectPages],
  )

  const add = React.useCallback(
    async (incoming: File[] | FileList | null) => {
      if (!incoming) return
      const list = Array.from(incoming)
      if (!list.length) return
      const allowed = multiple ? list : list.slice(0, 1)
      const rejectedLocal: RejectedFile[] = []

      const accepted: QueueFile[] = []
      for (const file of allowed) {
        const ext = extensionOf(file.name)
        if (accept && accept.length > 0 && !accept.includes(ext)) {
          rejectedLocal.push({ name: file.name, reason: `.${ext || '?'} files are not supported here` })
          continue
        }
        if (file.size === 0) {
          rejectedLocal.push({ name: file.name, reason: 'File is empty' })
          continue
        }
        accepted.push({
          id: nextId(),
          file,
          name: file.name,
          size: file.size,
          ext,
          pageCount: null,
          status: 'ready',
          progress: 0,
        })
      }

      setRejected(rejectedLocal)
      if (!accepted.length) return

      setFiles((current) => (multiple ? [...current, ...accepted] : accepted))
      setLoading(true)
      try {
        const inspected = await Promise.all(accepted.map((entry) => inspect(entry)))
        setFiles((current) => {
          const map = new Map(inspected.map((entry) => [entry.id, entry]))
          return current.map((entry) => map.get(entry.id) ?? entry)
        })
      } finally {
        setLoading(false)
      }
    },
    [accept, inspect, multiple],
  )

  // Accept files handed over from another route (e.g. the homepage dropzone).
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<File[]>).detail
      if (Array.isArray(detail) && detail.length) void add(detail)
    }
    window.addEventListener(HANDOFF_EVENT, handler as EventListener)
    return () => window.removeEventListener(HANDOFF_EVENT, handler as EventListener)
  }, [add])

  const remove = React.useCallback((id: string) => {
    setFiles((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const clear = React.useCallback(() => {
    setFiles([])
    setRejected([])
  }, [])

  const move = React.useCallback((from: number, to: number) => {
    setFiles((current) => {
      if (to < 0 || to >= current.length || from === to) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const update = React.useCallback((id: string, patch: Partial<QueueFile>) => {
    setFiles((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  }, [])

  const updateMany = React.useCallback((patchMap: Record<string, Partial<QueueFile>>) => {
    setFiles((current) => current.map((entry) => (patchMap[entry.id] ? { ...entry, ...patchMap[entry.id] } : entry)))
  }, [])

  const resetStatuses = React.useCallback(() => {
    setFiles((current) =>
      current.map((entry) => ({ ...entry, status: 'ready', progress: 0, error: undefined, result: undefined })),
    )
  }, [])

  const totalSize = React.useMemo(() => files.reduce((sum, entry) => sum + entry.size, 0), [files])
  const totalPages = React.useMemo(
    () => files.reduce((sum, entry) => sum + (entry.pageCount ?? 0), 0),
    [files],
  )
  const hasResults = React.useMemo(() => files.some((entry) => entry.result), [files])
  const busy = loading || files.some((entry) => entry.status === 'processing')

  return {
    files,
    setFiles,
    add,
    remove,
    clear,
    move,
    update,
    updateMany,
    resetStatuses,
    totalSize,
    totalPages,
    hasResults,
    busy,
    loading,
    rejected,
    clearRejected: () => setRejected([]),
    single: files[0],
  }
}

export type FileQueueApi = ReturnType<typeof useFileQueue>
