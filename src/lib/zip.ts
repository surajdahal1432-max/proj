import JSZip from 'jszip'
import { downloadBlob } from './utils'

export interface ZipEntry {
  name: string
  blob: Blob
}

export async function zipBlobs(entries: ZipEntry[], onProgress?: (percent: number) => void): Promise<Blob> {
  const zip = new JSZip()
  for (const entry of entries) {
    zip.file(uniqueName(zip, entry.name), entry.blob)
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (meta) => {
    onProgress?.(Math.round(meta.percent))
  })
}

function uniqueName(zip: JSZip, name: string): string {
  if (!zip.file(name)) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let counter = 2
  while (zip.file(`${base}-${counter}${ext}`)) counter++
  return `${base}-${counter}${ext}`
}

export async function downloadZip(entries: ZipEntry[], archiveName: string): Promise<void> {
  const blob = await zipBlobs(entries)
  downloadBlob(blob, archiveName)
}

export async function readZip(file: File | Blob): Promise<JSZip> {
  return JSZip.loadAsync(file)
}

export async function extractTextFile(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path)
  if (!entry) return ''
  return entry.async('string')
}
