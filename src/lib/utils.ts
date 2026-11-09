import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  const value = bytes / Math.pow(k, i)
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${sizes[i]}`
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

export function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Parse a human page-range expression such as `1-3, 5, 8-12, -2` into
 * zero-based page indices. Duplicates are removed while order is preserved.
 */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const add = (page: number) => {
    if (page >= 1 && page <= pageCount && !seen.has(page - 1)) { seen.add(page - 1); result.push(page - 1) }
  }
  const normalized = input
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/(\d)\s*-(?=\s*(?:[,;]|$))/g, '$1-')
  const tokens = normalized.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean)
  for (const token of tokens) {
    const range = /^(\d+)-(\d+)$/.exec(token)
    if (range) {
      const a = parseInt(range[1], 10), b = parseInt(range[2], 10)
      const [from, to] = a <= b ? [a, b] : [b, a]
      if (to < 1 || from > pageCount) continue
      for (let p = Math.max(1, from); p <= Math.min(pageCount, to); p++) add(p)
      continue
    }
    const openEnded = /^(\d+)-$/.exec(token)
    if (openEnded) { for (let p = Math.max(1, parseInt(openEnded[1], 10)); p <= pageCount; p++) add(p); continue }
    const single = /^(\d+)$/.exec(token)
    if (single) { add(parseInt(single[1], 10)); continue }
    const negative = /^-(\d+)$/.exec(token)
    if (negative) add(pageCount - parseInt(negative[1], 10) + 1)
  }
  return result
}

/** Compress an ordered page list into a readable range string: 1-3, 5, 8-12 */
export function formatPageRanges(indices: number[]): string {
  if (indices.length === 0) return ''
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i]
    if (current !== prev + 1) {
      parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`)
      start = current
    }
    prev = current
  }
  return parts.join(', ')
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function readAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error(`Could not read ${(file as File).name || 'file'}`))
    reader.readAsArrayBuffer(file)
  })
}

export function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

export function readAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsText(file)
  })
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}
