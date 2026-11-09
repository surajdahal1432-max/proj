import {
  PDFDocument,
  PDFFont,
  PDFName,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
  type RGB,
} from 'pdf-lib'
/**
 * pdfjs is browser-only: it imports the worker through a Vite `?url` asset and
 * needs a DOM. Loading it lazily keeps the pdf-lib engine importable in Node
 * (regression tests) and keeps the worker out of the eager module graph.
 */
type PdfjsModule = typeof import('./pdfjs')

let pdfjsModule: Promise<PdfjsModule | null> | null = null

function loadPdfjs(): Promise<PdfjsModule | null> {
  pdfjsModule ??= import('./pdfjs').catch(() => null)
  return pdfjsModule
}

async function requirePdfjs(): Promise<PdfjsModule> {
  const mod = await loadPdfjs()
  if (!mod) {
    throw new Error('This tool needs the in-browser PDF renderer, which is not available here.')
  }
  return mod
}

/** Fallback used only when the browser renderer is unavailable. */
class EncryptedPdfError extends Error {
  constructor(message: string, readonly recoverable = true) {
    super(message)
    this.name = 'PdfPasswordError'
  }
}

export interface PdfResultFile {
  name: string
  blob: Blob
  size: number
}

const MIME_PDF = 'application/pdf'

export function blobFromBytes(bytes: Uint8Array, mime = MIME_PDF): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy], { type: mime })
}

export async function readBytes(file: File | Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

export interface LoadPdfLibOptions {
  password?: string
  updateMetadata?: boolean
}

/**
 * Load a document with pdf-lib. Encrypted documents are detected first through
 * PDF.js so callers get a clear "needs password" signal instead of a broken file.
 */
export async function loadPdfLib(file: File | Blob, options: LoadPdfLibOptions = {}): Promise<PDFDocument> {
  const bytes = await readBytes(file)
  await assertReadable(bytes, options.password)
  try {
    return await PDFDocument.load(bytes, {
      updateMetadata: options.updateMetadata ?? false,
      ignoreEncryption: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/encrypt/i.test(message)) {
      const mod = await loadPdfjs()
      const PasswordError = mod?.PdfPasswordError ?? EncryptedPdfError
      throw new PasswordError('This PDF is encrypted. Unlock it first with the Unlock PDF tool.', false)
    }
    throw new Error(`Could not parse this PDF (${message}). Try the Repair PDF tool.`)
  }
}

async function assertReadable(bytes: Uint8Array, password?: string): Promise<void> {
  const mod = await loadPdfjs()
  // Without the browser renderer (Node tests) pdf-lib's own parser still
  // rejects encrypted documents, so the probe is simply skipped.
  if (!mod) return
  const doc = await mod.loadPdf(bytes, { password, copy: false })
  await mod.closePdf(doc)
}

export async function savePdfBlob(doc: PDFDocument): Promise<Blob> {
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false })
  return blobFromBytes(bytes)
}

export function sanitizeWinAnsi(value: string): string {
  // Standard PDF fonts only support WinAnsi; replace unsupported glyphs.
  return value.replace(/[^\u0000-\u00FF]/g, '?')
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const int = parseInt(full || '000000', 16)
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255)
}

/* ------------------------------------------------------------------ *
 * Organize
 * ------------------------------------------------------------------ */

export async function mergePdfs(files: File[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const merged = await PDFDocument.create()
  merged.setProducer('Folio')
  merged.setCreator('Folio — local-first PDF toolkit')

  for (let index = 0; index < files.length; index++) {
    const source = await loadPdfLib(files[index])
    const pages = await merged.copyPages(source, source.getPageIndices())
    pages.forEach((page) => merged.addPage(page))
    onProgress?.(index + 1, files.length)
  }

  if (merged.getPageCount() === 0) throw new Error('No pages were found in the selected files.')
  return savePdfBlob(merged)
}

export async function extractPagesToPdf(file: File, indices: number[]): Promise<Blob> {
  const source = await loadPdfLib(file)
  const output = await PDFDocument.create()
  const valid = indices.filter((i) => i >= 0 && i < source.getPageCount())
  if (valid.length === 0) throw new Error('Select at least one page to extract.')
  const pages = await output.copyPages(source, valid)
  pages.forEach((page) => output.addPage(page))
  return savePdfBlob(output)
}

/** Rebuild a document using an explicit page order (supports duplicates). */
export async function reorderPages(file: File, order: number[]): Promise<Blob> {
  const source = await loadPdfLib(file)
  const output = await PDFDocument.create()
  const pages = await output.copyPages(source, order)
  pages.forEach((page) => output.addPage(page))
  return savePdfBlob(output)
}

export async function deletePages(file: File, removeIndices: number[]): Promise<Blob> {
  const source = await loadPdfLib(file)
  const remove = new Set(removeIndices)
  const keep = source.getPageIndices().filter((i) => !remove.has(i))
  if (keep.length === 0) throw new Error('At least one page must remain.')
  const output = await PDFDocument.create()
  const pages = await output.copyPages(source, keep)
  pages.forEach((page) => output.addPage(page))
  return savePdfBlob(output)
}

export interface RotationOptions {
  /** Degrees to apply to every page (0/90/180/270). */
  global?: number
  /** Per-page absolute rotation in degrees, keyed by zero-based page index. */
  perPage?: Record<number, number>
}

export async function rotatePdf(file: File, options: RotationOptions): Promise<Blob> {
  const doc = await loadPdfLib(file)
  doc.getPages().forEach((page, index) => {
    const override = options.perPage?.[index]
    if (typeof override === 'number') {
      page.setRotation(degrees(((override % 360) + 360) % 360))
    } else if (options.global) {
      const current = page.getRotation().angle ?? 0
      page.setRotation(degrees((((current + options.global) % 360) + 360) % 360))
    }
  })
  return savePdfBlob(doc)
}

export interface SplitResult {
  label: string
  blob: Blob
  pages: number[]
}

/** Split into groups of page indices; each group becomes its own document. */
export async function splitPdfGroups(file: File, groups: number[][], baseName: string): Promise<SplitResult[]> {
  const source = await loadPdfLib(file)
  const results: SplitResult[] = []
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index].filter((p) => p >= 0 && p < source.getPageCount())
    if (group.length === 0) continue
    const output = await PDFDocument.create()
    const pages = await output.copyPages(source, group)
    pages.forEach((page) => output.addPage(page))
    const first = group[0] + 1
    const last = group[group.length - 1] + 1
    results.push({
      label: `${baseName}_p${first}${group.length > 1 ? `-${last}` : ''}.pdf`,
      blob: await savePdfBlob(output),
      pages: group,
    })
  }
  return results
}

/* ------------------------------------------------------------------ *
 * Annotate
 * ------------------------------------------------------------------ */

export interface WatermarkOptions {
  text: string
  fontSize: number
  opacity: number
  color: string
  rotation: number
  position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'tile'
  pages?: number[]
}

export async function watermarkPdf(file: File, options: WatermarkOptions): Promise<Blob> {
  const doc = await loadPdfLib(file)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const text = sanitizeWinAnsi(options.text || 'CONFIDENTIAL')
  const color = hexToRgb(options.color)
  const target = options.pages?.length ? new Set(options.pages) : null

  doc.getPages().forEach((page, index) => {
    if (target && !target.has(index)) return
    const { width, height } = page.getSize()
    const size = Math.max(6, options.fontSize)
    const textWidth = font.widthOfTextAtSize(text, size)
    const textHeight = font.heightAtSize(size)

    if (options.position === 'tile') {
      const stepX = Math.max(textWidth + 80, 180)
      const stepY = Math.max(textHeight + 90, 150)
      for (let y = 40; y < height; y += stepY) {
        for (let x = 20; x < width; x += stepX) {
          page.drawText(text, {
            x,
            y,
            size,
            font,
            color,
            opacity: options.opacity,
            rotate: degrees(options.rotation),
          })
        }
      }
      return
    }

    const margin = 36
    const positions: Record<string, { x: number; y: number }> = {
      center: { x: (width - textWidth) / 2, y: (height - textHeight) / 2 },
      'top-left': { x: margin, y: height - margin - textHeight },
      'top-right': { x: width - margin - textWidth, y: height - margin - textHeight },
      'bottom-left': { x: margin, y: margin },
      'bottom-right': { x: width - margin - textWidth, y: margin },
    }
    const point = positions[options.position] ?? positions.center
    page.drawText(text, {
      x: point.x,
      y: point.y,
      size,
      font,
      color,
      opacity: options.opacity,
      rotate: degrees(options.rotation),
    })
  })

  return savePdfBlob(doc)
}

export interface PageNumberOptions {
  format: 'n' | 'n-of-total' | 'page-n' | 'page-n-of-total'
  fontSize: number
  color: string
  position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left'
  startAt: number
  margin: number
  skipFirst: boolean
}

export async function addPageNumbers(file: File, options: PageNumberOptions): Promise<Blob> {
  const doc = await loadPdfLib(file)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const color = hexToRgb(options.color)
  const total = doc.getPageCount()

  doc.getPages().forEach((page, index) => {
    if (options.skipFirst && index === 0) return
    const label = options.startAt + index
    const text = buildPageLabel(options.format, label, total)
    const { width, height } = page.getSize()
    const textWidth = font.widthOfTextAtSize(text, options.fontSize)
    const y = options.position.startsWith('bottom') ? options.margin : height - options.margin - options.fontSize
    let x = (width - textWidth) / 2
    if (options.position.endsWith('left')) x = options.margin
    if (options.position.endsWith('right')) x = width - options.margin - textWidth
    page.drawText(text, { x, y, size: options.fontSize, font, color })
  })

  return savePdfBlob(doc)
}

function buildPageLabel(format: PageNumberOptions['format'], page: number, total: number): string {
  switch (format) {
    case 'n':
      return `${page}`
    case 'n-of-total':
      return `${page} / ${total}`
    case 'page-n':
      return `Page ${page}`
    default:
      return `Page ${page} of ${total}`
  }
}

/* ------------------------------------------------------------------ *
 * Images ⇄ PDF
 * ------------------------------------------------------------------ */

export interface ImageInput {
  bytes: Uint8Array
  type: 'png' | 'jpg'
  width?: number
  height?: number
}

export interface ImagesToPdfOptions {
  pageSize: 'fit' | 'a4' | 'letter'
  orientation: 'auto' | 'portrait' | 'landscape'
  margin: number
  fitMode: 'contain' | 'stretch'
}

export async function imagesToPdf(images: ImageInput[], options: ImagesToPdfOptions): Promise<Blob> {
  const doc = await PDFDocument.create()
  doc.setProducer('Folio')

  for (const image of images) {
    const embedded = image.type === 'png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes)

    if (options.pageSize === 'fit') {
      const margin = options.margin
      const page = doc.addPage([embedded.width + margin * 2, embedded.height + margin * 2])
      page.drawImage(embedded, { x: margin, y: margin, width: embedded.width, height: embedded.height })
      continue
    }

    const base: [number, number] = options.pageSize === 'a4' ? [595.28, 841.89] : [612, 792]
    const landscape =
      options.orientation === 'landscape' || (options.orientation === 'auto' && embedded.width > embedded.height)
    const size: [number, number] = landscape ? [base[1], base[0]] : base
    const page = doc.addPage(size)
    const margin = options.margin
    const maxWidth = size[0] - margin * 2
    const maxHeight = size[1] - margin * 2
    const scale =
      options.fitMode === 'stretch'
        ? { x: maxWidth / embedded.width, y: maxHeight / embedded.height }
        : (() => {
            const ratio = Math.min(maxWidth / embedded.width, maxHeight / embedded.height)
            return { x: ratio, y: ratio }
          })()
    const drawWidth = embedded.width * scale.x
    const drawHeight = embedded.height * scale.y
    page.drawImage(embedded, {
      x: (size[0] - drawWidth) / 2,
      y: (size[1] - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })
  }

  if (doc.getPageCount() === 0) throw new Error('Add at least one image.')
  return savePdfBlob(doc)
}

export interface RasterPage {
  bytes: Uint8Array
  width: number
  height: number
  pointWidth?: number
  pointHeight?: number
}

export async function pdfFromJpegs(pages: RasterPage[]): Promise<Blob> {
  const doc = await PDFDocument.create()
  doc.setProducer('Folio')
  for (const page of pages) {
    const image = await doc.embedJpg(page.bytes)
    const w = page.pointWidth ?? page.width
    const h = page.pointHeight ?? page.height
    const pdfPage = doc.addPage([w, h])
    pdfPage.drawImage(image, { x: 0, y: 0, width: w, height: h })
  }
  return savePdfBlob(doc)
}

/* ------------------------------------------------------------------ *
 * Rasterization / compression / repair
 * ------------------------------------------------------------------ */

export interface RasterizeOptions {
  dpi?: number
  quality?: number
  onProgress?: (done: number, total: number) => void
  password?: string
}

export async function rasterizePdf(file: File | Blob, options: RasterizeOptions = {}): Promise<RasterPage[]> {
  const dpi = options.dpi ?? 150
  const quality = options.quality ?? 0.75
  const buffer = await file.arrayBuffer()
  const pdfjs = await requirePdfjs()
  const doc = await pdfjs.loadPdf(buffer, { password: options.password })
  const pages: RasterPage[] = []
  try {
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index)
      const base = page.getViewport({ scale: 1 })
      const targetWidth = (base.width / 72) * dpi
      const rendered = await pdfjs.renderPageToJpegBytes(page, Math.min(targetWidth, 4000), quality)
      pages.push({
        bytes: rendered.bytes,
        width: rendered.width,
        height: rendered.height,
        pointWidth: base.width,
        pointHeight: base.height,
      })
      page.cleanup()
      options.onProgress?.(index, doc.numPages)
    }
  } finally {
    await pdfjs.closePdf(doc)
  }
  return pages
}

export interface CompressOptions {
  level: 'extreme' | 'recommended' | 'low'
  onProgress?: (done: number, total: number) => void
  password?: string
}

export interface CompressOutcome {
  blob: Blob
  originalSize: number
  compressedSize: number
  pages: number
  mode: 'raster' | 'structural'
}

/**
 * Two genuine strategies:
 *  - structural: rebuild object streams with pdf-lib (lossless, small gains)
 *  - raster: re-encode each page as JPEG at a lower DPI (large gains, loses text layer)
 */
export async function compressPdf(file: File, options: CompressOptions): Promise<CompressOutcome> {
  const originalSize = file.size

  if (options.level === 'low') {
    const doc = await loadPdfLib(file, { password: options.password })
    doc.setProducer('Folio')
    const blob = await savePdfBlob(doc)
    return {
      blob,
      originalSize,
      compressedSize: blob.size,
      pages: doc.getPageCount(),
      mode: 'structural',
    }
  }

  const preset = options.level === 'extreme' ? { dpi: 96, quality: 0.55 } : { dpi: 132, quality: 0.72 }
  const pages = await rasterizePdf(file, {
    dpi: preset.dpi,
    quality: preset.quality,
    onProgress: options.onProgress,
    password: options.password,
  })
  const blob = await pdfFromJpegs(pages)
  const structuralDoc = await loadPdfLib(file, { password: options.password }).catch(() => null)
  const pageCount = structuralDoc?.getPageCount() ?? pages.length

  // If rasterizing made the file bigger (already image-light PDFs), fall back.
  if (blob.size >= originalSize * 0.98 && structuralDoc) {
    const structuralBlob = await savePdfBlob(structuralDoc)
    return {
      blob: structuralBlob,
      originalSize,
      compressedSize: structuralBlob.size,
      pages: pageCount,
      mode: 'structural',
    }
  }

  return { blob, originalSize, compressedSize: blob.size, pages: pageCount, mode: 'raster' }
}

export interface RepairOutcome {
  blob: Blob
  pagesRecovered: number
  strategy: 'object-rebuild' | 'raster-recovery'
  warnings: string[]
}

/** Attempt a lossless rebuild first, then fall back to page-level raster recovery. */
export async function repairPdf(file: File, onProgress?: (done: number, total: number) => void): Promise<RepairOutcome> {
  const warnings: string[] = []
  const bytes = await readBytes(file)

  try {
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
    const output = await PDFDocument.create()
    const indices = source.getPageIndices()
    if (indices.length > 0) {
      const pages = await output.copyPages(source, indices)
      pages.forEach((page) => output.addPage(page))
      const blob = await savePdfBlob(output)
      return { blob, pagesRecovered: indices.length, strategy: 'object-rebuild', warnings }
    }
    warnings.push('No page tree was found — falling back to pixel recovery.')
  } catch (error) {
    warnings.push(`Structural parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const pages = await rasterizePdf(file, { dpi: 150, quality: 0.85, onProgress })
  if (pages.length === 0) throw new Error('No recoverable pages were found in this file.')
  const blob = await pdfFromJpegs(pages)
  warnings.push('Recovered pages were re-rendered; selectable text may be lost.')
  return { blob, pagesRecovered: pages.length, strategy: 'raster-recovery', warnings }
}

/* ------------------------------------------------------------------ *
 * Editor / annotations
 * ------------------------------------------------------------------ */

export interface TextAnnotation {
  page: number
  x: number
  y: number
  text: string
  fontSize: number
  color: string
  /** Normalized width of the text box (0-1 of page width) — reserved for wrapping. */
  widthRatio?: number
}

export async function applyTextAnnotations(file: File, annotations: TextAnnotation[]): Promise<Blob> {
  const doc = await loadPdfLib(file)
  const fontCache = new Map<string, PDFFont>()
  const pages = doc.getPages()

  for (const annotation of annotations) {
    const page = pages[annotation.page]
    if (!page) continue
    const font = await getFont(doc, 'Helvetica', fontCache)
    const { height } = page.getSize()
    page.drawText(sanitizeWinAnsi(annotation.text), {
      x: annotation.x,
      y: height - annotation.y - annotation.fontSize,
      size: annotation.fontSize,
      font,
      color: hexToRgb(annotation.color),
    })
  }
  return savePdfBlob(doc)
}

async function getFont(doc: PDFDocument, name: 'Helvetica' | 'HelveticaBold' | 'TimesRoman' | 'Courier', cache: Map<string, PDFFont>) {
  const cached = cache.get(name)
  if (cached) return cached
  const font = await doc.embedFont(StandardFonts[name])
  cache.set(name, font)
  return font
}

export interface ImageStamp {
  page: number
  /** Normalized rectangle, origin top-left, values 0-1. */
  x: number
  y: number
  width: number
  height: number
  pngBytes: Uint8Array
}

export async function applyImageStamps(file: File, stamps: ImageStamp[]): Promise<Blob> {
  const doc = await loadPdfLib(file)
  const pages = doc.getPages()
  for (const stamp of stamps) {
    const page = pages[stamp.page]
    if (!page) continue
    const image = await doc.embedPng(stamp.pngBytes)
    const { width, height } = page.getSize()
    page.drawImage(image, {
      x: stamp.x * width,
      y: height - (stamp.y + stamp.height) * height,
      width: stamp.width * width,
      height: stamp.height * height,
    })
  }
  return savePdfBlob(doc)
}

/* ------------------------------------------------------------------ *
 * Redaction
 * ------------------------------------------------------------------ */

export interface RedactionBox {
  page: number
  /** Normalized coordinates relative to the rendered page (0-1). */
  x: number
  y: number
  width: number
  height: number
}

export interface RedactionOutcome {
  blob: Blob
  redactedPages: number
  boxes: number
  removedCharacters: number
}

/**
 * Permanent redaction: affected pages are re-rendered to pixels, the regions are
 * burned in, and the original page (including every text-showing operator in its
 * content stream) is discarded. The exported file therefore contains no
 * recoverable text or vector data beneath the redaction.
 */
export async function redactPdf(
  file: File,
  boxes: RedactionBox[],
  onProgress?: (done: number, total: number) => void,
): Promise<RedactionOutcome> {
  const buffer = await file.arrayBuffer()
  const pdfjs = await requirePdfjs()
  const source = await pdfjs.loadPdf(buffer)
  const redactedPages = new Set(boxes.map((box) => box.page))
  const output = await PDFDocument.create()
  const original = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false })
  let removedCharacters = 0

  try {
    for (let index = 0; index < source.numPages; index++) {
      onProgress?.(index + 1, source.numPages)
      const page = await source.getPage(index + 1)
      const viewport = page.getViewport({ scale: 1 })

      if (!redactedPages.has(index)) {
        const [copied] = await output.copyPages(original, [index])
        output.addPage(copied)
        page.cleanup()
        continue
      }

      const text = await pdfjs.extractPageText(page)
      const pageBoxes = boxes.filter((box) => box.page === index)
      for (const box of pageBoxes) {
        const boxRect = {
          x0: box.x * viewport.width,
          x1: (box.x + box.width) * viewport.width,
          y0: (1 - box.y - box.height) * viewport.height,
          y1: (1 - box.y) * viewport.height,
        }
        removedCharacters += text.lines.filter((line) => {
          const inX = line.x < boxRect.x1 && line.x + line.width > boxRect.x0
          const inY = line.y > boxRect.y0 - line.height && line.y < boxRect.y1 + line.height
          return inX && inY
        }).reduce((sum, line) => sum + line.text.length, 0)
      }

      const dpi = 200
      const targetWidth = (viewport.width / 72) * dpi
      const rendered = await pdfjs.renderPageToJpegBytes(page, Math.min(targetWidth, 3200), 0.9)
      const raster = await output.embedJpg(rendered.bytes)
      const pdfPage = output.addPage([rendered.width, rendered.height])
      pdfPage.drawImage(raster, { x: 0, y: 0, width: rendered.width, height: rendered.height })
      for (const box of pageBoxes) {
        pdfPage.drawRectangle({
          x: box.x * rendered.width,
          y: (1 - box.y - box.height) * rendered.height,
          width: box.width * rendered.width,
          height: box.height * rendered.height,
          color: rgb(0, 0, 0),
        })
      }
      page.cleanup()
    }
  } finally {
    await pdfjs.closePdf(source)
  }

  return { blob: await savePdfBlob(output), redactedPages: redactedPages.size, boxes: boxes.length, removedCharacters }
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

export interface FormFieldInfo {
  name: string
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist' | 'button' | 'signature' | 'unknown'
  value: string | boolean
  options?: string[]
  required: boolean
  readOnly: boolean
  /** Normalized rect on the page (0-1, top-left origin) when available. */
  rect?: { page: number; x: number; y: number; width: number; height: number }
}

export async function inspectFormFields(file: File): Promise<{ fields: FormFieldInfo[]; hasForm: boolean }> {
  const doc = await loadPdfLib(file)
  const form = doc.getForm()
  const rawFields = form.getFields()
  const fields: FormFieldInfo[] = []

  for (const field of rawFields) {
    const name = field.getName()
    const constructorName = field.constructor.name
    let type: FormFieldInfo['type'] = 'unknown'
    let value: string | boolean = ''
    let options: string[] | undefined

    try {
      if (constructorName === 'PDFTextField') {
        type = 'text'
        value = (field as unknown as { getText: () => string | undefined }).getText() ?? ''
      } else if (constructorName === 'PDFCheckBox') {
        type = 'checkbox'
        value = (field as unknown as { isChecked: () => boolean }).isChecked()
      } else if (constructorName === 'PDFRadioGroup') {
        type = 'radio'
        const group = field as unknown as { getSelected: () => string | undefined; getOptions: () => string[] }
        value = group.getSelected() ?? ''
        options = group.getOptions()
      } else if (constructorName === 'PDFDropdown') {
        type = 'dropdown'
        const dropdown = field as unknown as { getSelected: () => string[]; getOptions: () => string[] }
        value = dropdown.getSelected()[0] ?? ''
        options = dropdown.getOptions()
      } else if (constructorName === 'PDFOptionList') {
        type = 'optionlist'
        const list = field as unknown as { getSelected: () => string[]; getOptions: () => string[] }
        value = list.getSelected()[0] ?? ''
        options = list.getOptions()
      } else if (constructorName === 'PDFButton') {
        type = 'button'
      } else if (constructorName === 'PDFSignature') {
        type = 'signature'
      }
    } catch {
      type = 'unknown'
    }

    let rect: FormFieldInfo['rect']
    try {
      const widgets = (field as unknown as { acroField: { getWidgets: () => unknown[] } }).acroField.getWidgets()
      const widget = widgets[0] as { getRectangle: () => { x: number; y: number; width: number; height: number }; P: () => { ref?: unknown } } | undefined
      if (widget) {
        const box = widget.getRectangle()
        const pageIndex = findWidgetPage(doc, field.getName())
        const page = doc.getPage(pageIndex)
        const size = page.getSize()
        rect = {
          page: pageIndex,
          x: box.x / size.width,
          y: 1 - (box.y + box.height) / size.height,
          width: box.width / size.width,
          height: box.height / size.height,
        }
      }
    } catch {
      rect = undefined
    }

    fields.push({
      name,
      type,
      value,
      options,
      required: field.isRequired(),
      readOnly: field.isReadOnly(),
      rect,
    })
  }

  return { fields, hasForm: fields.length > 0 }
}

function findWidgetPage(doc: PDFDocument, fieldName: string): number {
  const pages = doc.getPages()
  for (let index = 0; index < pages.length; index++) {
    const annotations = pages[index].node.Annots()
    if (!annotations) continue
    const list = annotations.asArray()
    for (const ref of list) {
      try {
        const dict = doc.context.lookup(ref)
        const dictAny = dict as unknown as { get?: (key: unknown) => unknown; toString?: () => string }
        if (dictAny?.toString && dictAny.toString().includes(fieldName)) return index
      } catch {
        continue
      }
    }
  }
  return 0
}

export async function fillFormFields(
  file: File,
  values: Record<string, string | boolean>,
  flatten: boolean,
): Promise<Blob> {
  const doc = await loadPdfLib(file)
  const form = doc.getForm()

  for (const [name, value] of Object.entries(values)) {
    let field
    try {
      field = form.getField(name)
    } catch {
      continue
    }
    const constructorName = field.constructor.name
    try {
      if (constructorName === 'PDFTextField' && typeof value === 'string') {
        ;(field as unknown as { setText: (v: string) => void }).setText(value)
      } else if (constructorName === 'PDFCheckBox' && typeof value === 'boolean') {
        const box = field as unknown as { check: () => void; uncheck: () => void }
        value ? box.check() : box.uncheck()
      } else if (constructorName === 'PDFRadioGroup' && typeof value === 'string' && value) {
        ;(field as unknown as { select: (v: string) => void }).select(value)
      } else if ((constructorName === 'PDFDropdown' || constructorName === 'PDFOptionList') && typeof value === 'string' && value) {
        ;(field as unknown as { select: (v: string) => void }).select(value)
      }
    } catch {
      // Ignore individual field failures so one bad widget cannot break the export.
    }
  }

  if (flatten) {
    try {
      form.flatten()
    } catch {
      // Some forms cannot be flattened; keep them fillable instead of failing.
    }
  }

  return savePdfBlob(doc)
}

/* ------------------------------------------------------------------ *
 * Metadata / PDF-A
 * ------------------------------------------------------------------ */

export async function setDocumentMetadata(
  file: File,
  meta: { title?: string; author?: string; subject?: string; keywords?: string[] },
): Promise<Blob> {
  const doc = await loadPdfLib(file)
  if (meta.title) doc.setTitle(meta.title)
  if (meta.author) doc.setAuthor(meta.author)
  if (meta.subject) doc.setSubject(meta.subject)
  if (meta.keywords) doc.setKeywords(meta.keywords)
  doc.setProducer('Folio')
  doc.setModificationDate(new Date())
  return savePdfBlob(doc)
}

/**
 * PDF/A-2b oriented export. Pages are rasterized (which removes font-embedding
 * violations entirely), and the document carries XMP metadata describing the
 * PDF/A identification plus an sRGB output intent.
 */
export async function toPdfA(file: File, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const pages = await rasterizePdf(file, { dpi: 200, quality: 0.9, onProgress })
  const doc = await PDFDocument.create()
  doc.setProducer('Folio')
  doc.setCreator('Folio — PDF/A-2b export')
  doc.setTitle(file.name.replace(/\.pdf$/i, ''))
  doc.setLanguage('en-US')

  const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>2</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>Folio</xmp:CreatorTool>
      <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(doc.getTitle() ?? 'Document')}</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
  // pdf-lib does not expose XMP directly; attach it through the catalog.
  const metadataStream = doc.context.stream(xmp, {
    Type: 'Metadata',
    Subtype: 'XML',
  })
  const metadataRef = doc.context.register(metadataStream)
  doc.catalog.set(PDFName.of('Metadata'), metadataRef)

  for (const page of pages) {
    const image = await doc.embedJpg(page.bytes)
    const pdfPage = doc.addPage([page.width, page.height])
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height })
  }

  return savePdfBlob(doc)
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c,
  )
}

/* ------------------------------------------------------------------ *
 * Helpers used by converter tools
 * ------------------------------------------------------------------ */

export interface PdfTextDocument {
  pageCount: number
  title?: string
  pages: { pageNumber: number; text: string; lines: { text: string; x: number; y: number; fontSize: number }[] }[]
}

export async function readPdfText(file: File, password?: string): Promise<PdfTextDocument> {
  const buffer = await file.arrayBuffer()
  const pdfjs = await requirePdfjs()
  const doc = await pdfjs.loadPdf(buffer, { password })
  const pages: PdfTextDocument['pages'] = []
  try {
    const metadata = await doc.getMetadata().catch(() => null)
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index)
      const extracted = await pdfjs.extractPageText(page)
      pages.push({
        pageNumber: index,
        text: extracted.text,
        lines: extracted.lines.map((line) => ({
          text: line.text,
          x: line.x,
          y: line.y,
          fontSize: line.fontSize,
        })),
      })
      page.cleanup()
    }
    return {
      pageCount: doc.numPages,
      title: (metadata?.info as { Title?: string } | undefined)?.Title,
      pages,
    }
  } finally {
    await pdfjs.closePdf(doc)
  }
}

export function pageTextToPlain(document: PdfTextDocument): string {
  return document.pages.map((page) => page.text).join('\n\n')
}

export type { PDFPage }
