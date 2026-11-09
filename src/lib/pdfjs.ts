import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const ASSET_BASE = `${import.meta.env.BASE_URL || '/'}pdfjs/`

export const pdfjs = pdfjsLib

export class PdfPasswordError extends Error {
  readonly needsPassword: boolean
  constructor(message: string, needsPassword: boolean) {
    super(message)
    this.name = 'PdfPasswordError'
    this.needsPassword = needsPassword
  }
}

export interface LoadOptions {
  password?: string
  /** Copies the buffer before handing it to the worker (safer when reusing bytes). */
  copy?: boolean
}

/**
 * Load a PDF through PDF.js. Throws {@link PdfPasswordError} when the document
 * is encrypted so the UI can prompt for a password instead of failing silently.
 */
export async function loadPdf(source: ArrayBuffer | Uint8Array, options: LoadOptions = {}): Promise<PDFDocumentProxy> {
  const raw = source instanceof Uint8Array ? source : new Uint8Array(source)
  const data = options.copy === false ? raw : raw.slice(0)

  const task = pdfjsLib.getDocument({
    data,
    password: options.password,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    useSystemFonts: true,
  })

  try {
    return await task.promise
  } catch (error) {
    const name = (error as { name?: string })?.name
    const code = (error as { code?: number })?.code
    if (name === 'PasswordException') {
      const needsPassword = code === 1
      throw new PdfPasswordError(
        needsPassword ? 'This PDF is password protected. Enter the password to continue.' : 'That password did not unlock the document.',
        needsPassword,
      )
    }
    if (name === 'InvalidPDFException') {
      throw new Error('This file is not a valid PDF, or it is damaged beyond repair. Try the Repair PDF tool.')
    }
    throw error instanceof Error ? error : new Error('Could not open this PDF.')
  }
}

export async function loadPdfFromFile(file: File | Blob, password?: string): Promise<PDFDocumentProxy> {
  const buffer = await file.arrayBuffer()
  return loadPdf(buffer, { password })
}

export async function getPageCount(source: ArrayBuffer | Uint8Array, password?: string): Promise<number> {
  const doc = await loadPdf(source, { password })
  const count = doc.numPages
  await closePdf(doc)
  return count
}

export interface RenderedPage {
  dataUrl: string
  width: number
  height: number
  blob: Blob
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width))
  canvas.height = Math.max(1, Math.floor(height))
  return canvas
}

/** Render a page into an existing canvas at the given CSS scale. */
export async function renderPageIntoCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation = 0,
): Promise<{ width: number; height: number; viewportWidth: number; viewportHeight: number }> {
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2)
  const viewport = page.getViewport({ scale, rotation })
  const pixelWidth = Math.floor(viewport.width * dpr)
  const pixelHeight = Math.floor(viewport.height * dpr)
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`

  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D is not available in this browser.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, pixelWidth, pixelHeight)
  context.scale(dpr, dpr)

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
  } as Parameters<PDFPageProxy['render']>[0]).promise

  return {
    width: pixelWidth,
    height: pixelHeight,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  }
}

/** Render a page off-screen and return a PNG data URL (used for thumbnails). */
export async function renderPageToDataUrl(
  page: PDFPageProxy,
  options: { scale?: number; maxWidth?: number; format?: 'png' | 'jpeg'; quality?: number } = {},
): Promise<RenderedPage> {
  const base = page.getViewport({ scale: 1 })
  const scale = options.scale ?? (options.maxWidth ? options.maxWidth / base.width : 1)
  const canvas = makeCanvas(base.width * scale, base.height * scale)
  await renderPageIntoCanvas(page, canvas, scale)
  const format = options.format ?? 'png'
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Could not encode page image.'))),
      `image/${format}`,
      options.quality ?? 0.92,
    )
  })
  return {
    dataUrl: canvas.toDataURL(`image/${format}`, options.quality ?? 0.92),
    width: canvas.width,
    height: canvas.height,
    blob,
  }
}

/** Render a page at an exact pixel width — used by rasterizing compression. */
export async function renderPageToJpegBytes(
  page: PDFPageProxy,
  targetWidth: number,
  quality: number,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.max(0.15, targetWidth / base.width)
  const canvas = makeCanvas(base.width * scale, base.height * scale)
  await renderPageIntoCanvas(page, canvas, scale)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const binary = atob(dataUrl.split(',')[1] ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { bytes, width: canvas.width, height: canvas.height }
}

export interface TextLine {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
}

export interface PageText {
  pageNumber: number
  width: number
  height: number
  text: string
  lines: TextLine[]
}

interface RawTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

function isRawTextItem(item: unknown): item is RawTextItem {
  const candidate = item as RawTextItem
  return typeof candidate?.str === 'string' && Array.isArray(candidate?.transform)
}

/** Extract text from a page, grouped into visual lines with coordinates. */
export async function extractPageText(page: PDFPageProxy): Promise<PageText> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items = content.items.filter(isRawTextItem) as unknown as RawTextItem[]

  const rows: { y: number; height: number; items: RawTextItem[] }[] = []
  for (const item of items) {
    const y = item.transform[5]
    const height = Math.abs(item.height) || Math.abs(item.transform[3]) || 10
    const row = rows.find((candidate) => Math.abs(candidate.y - y) <= Math.max(2, height * 0.45))
    if (row) {
      row.items.push(item)
      row.height = Math.max(row.height, height)
    } else {
      rows.push({ y, height, items: [item] })
    }
  }

  rows.sort((a, b) => b.y - a.y)
  const lines: TextLine[] = rows.map((row) => {
    const sorted = [...row.items].sort((a, b) => a.transform[4] - b.transform[4])
    const x = sorted.length ? sorted[0].transform[4] : 0
    const last = sorted[sorted.length - 1]
    const width = last ? last.transform[4] + last.width - x : 0
    return {
      text: sorted
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      x,
      y: row.y,
      width,
      height: row.height,
      fontSize: Math.max(1, Math.round(row.height)),
    }
  })

  const text = lines
    .map((line) => line.text)
    .filter(Boolean)
    .join('\n')

  return {
    pageNumber: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    text,
    lines: lines.filter((line) => line.text.length > 0),
  }
}

/** Extract text from every page of a loaded document. */
export async function extractDocumentText(
  doc: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
): Promise<PageText[]> {
  const pages: PageText[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber)
    pages.push(await extractPageText(page))
    page.cleanup()
    onProgress?.(pageNumber, doc.numPages)
  }
  return pages
}

export async function renderThumbnail(page: PDFPageProxy, maxWidth = 220): Promise<string> {
  const rendered = await renderPageToDataUrl(page, { maxWidth })
  return rendered.dataUrl
}

/** Read lightweight metadata used by the file cards and history drawer. */
export async function getPdfSummary(
  file: File,
): Promise<{ pages: number; encrypted: boolean; title?: string }> {
  const buffer = await file.arrayBuffer()
  try {
    const doc = await loadPdf(buffer)
    const metadata = await doc.getMetadata().catch(() => null)
    const info = (metadata?.info ?? {}) as { Title?: string }
    const result = { pages: doc.numPages, encrypted: false, title: info.Title }
    await closePdf(doc)
    return result
  } catch (error) {
    if (error instanceof PdfPasswordError) {
      return { pages: 0, encrypted: true }
    }
    throw error
  }
}


/** PDF.js 6 exposes cleanup() on the document proxy; release it safely. */
type ClosablePdfDocument = { cleanup: (keepLoadedFonts?: boolean) => Promise<unknown> }

export async function closePdf(doc: ClosablePdfDocument | null | undefined): Promise<void> {
  if (!doc) return
  try {
    await doc.cleanup()
  } catch {
    /* document already released */
  }
}
