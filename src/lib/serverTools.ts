/**
 * Server-backed tool functions.
 *
 * These mirror the signatures the tool components already use, but every call
 * runs on Folio's processing API (qpdf, poppler, Tesseract, LibreOffice,
 * pdf-lib) instead of in the browser. Previews still use PDF.js locally.
 */

import { ProcessingError, runTool, type ServerResult } from './serverClient'

export interface NamedBlob {
  name: string
  blob: Blob
}

export interface SplitResult {
  label: string
  blob: Blob
  pages: number[]
}

export interface RotationOptions {
  global?: number
  perPage?: Record<number, number>
}

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

export interface CompressOutcome {
  blob: Blob
  originalSize: number
  compressedSize: number
  pages: number
  mode: 'raster' | 'structural'
}

export interface RepairOutcome {
  blob: Blob
  pagesRecovered: number
  strategy: 'object-rebuild' | 'raster-recovery'
  warnings: string[]
}

function firstOutput(result: ServerResult, fallback: string): Blob {
  const output = result.outputs[0]
  if (!output) throw new ProcessingError(`The server did not return ${fallback}`)
  return output.blob
}

function named(result: ServerResult, fallback: string): NamedBlob {
  const output = result.outputs[0]
  if (!output) throw new ProcessingError(`The server did not return ${fallback}`)
  return { name: output.name, blob: output.blob }
}

function metaNumber(result: ServerResult, key: string, fallback = 0): number {
  const value = Number((result.meta as Record<string, unknown> | null)?.[key])
  return Number.isFinite(value) ? value : fallback
}

/** Progress reported as (done, total) pairs, matching the previous callbacks. */
function pairProgress(onProgress?: (done: number, total: number) => void) {
  return onProgress ? (percent: number) => onProgress(Math.round(percent), 100) : undefined
}

/* --------------------------------- organize -------------------------------- */

export async function mergePdfs(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const result = await runTool('merge', files, {}, { onProgress: pairProgress(onProgress) })
  return firstOutput(result, 'a merged PDF')
}

export async function extractPagesToPdf(file: File, indices: number[]): Promise<Blob> {
  const pages = indices.map((index) => index + 1)
  const result = await runTool('extract', [file], { pages, individual: false })
  return firstOutput(result, 'the extracted pages')
}

export async function reorderPages(file: File, order: number[]): Promise<Blob> {
  const result = await runTool('rearrange', [file], { order: order.map((index) => index + 1) })
  return firstOutput(result, 'the reordered document')
}

export async function rotatePdf(file: File, options: RotationOptions): Promise<Blob> {
  const perPage = options.perPage ?? {}
  const rotations: Record<number, number> = {}
  for (const [key, value] of Object.entries(perPage)) rotations[Number(key)] = Number(value)
  const hasPerPage = Object.keys(rotations).length > 0
  const result = await runTool('rotate', [file], {
    angle: hasPerPage ? 0 : options.global ?? 90,
    rotations: hasPerPage ? rotations : undefined,
  })
  return firstOutput(result, 'the rotated document')
}

export async function splitPdfGroups(
  file: File,
  groups: number[][],
  _baseName: string,
): Promise<SplitResult[]> {
  const result = await runTool('split', [file], {
    mode: 'groups',
    groups: groups.map((group) => group.map((index) => index + 1)),
    individual: true,
  })
  return result.outputs.map((output, index) => ({
    label: output.name.replace(/\.pdf$/i, ''),
    blob: output.blob,
    pages: groups[index] ?? [],
  }))
}

/* --------------------------------- optimize -------------------------------- */

export async function compressPdf(
  file: File,
  options: { level: 'extreme' | 'recommended' | 'low'; onProgress?: (done: number, total: number) => void },
): Promise<CompressOutcome> {
  const result = await runTool(
    'compress',
    [file],
    { level: options.level },
    { onProgress: pairProgress(options.onProgress) },
  )
  const blob = firstOutput(result, 'a compressed PDF')
  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    pages: metaNumber(result, 'pages'),
    mode: 'structural',
  }
}

export async function repairPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<RepairOutcome> {
  const result = await runTool('repair', [file], {}, { onProgress: pairProgress(onProgress) })
  const blob = firstOutput(result, 'a repaired PDF')
  return {
    blob,
    pagesRecovered: metaNumber(result, 'pages'),
    strategy: 'object-rebuild',
    warnings: result.warnings,
  }
}

export async function toPdfA(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const result = await runTool('pdf-to-pdfa', [file], {}, { onProgress: pairProgress(onProgress) })
  return firstOutput(result, 'a PDF/A document')
}

/* -------------------------------- conversions ------------------------------ */

export async function pdfToImages(
  file: File,
  options: { format: 'jpeg' | 'png'; dpi: number; onProgress?: (done: number, total: number) => void },
): Promise<NamedBlob[]> {
  const tool = options.format === 'png' ? 'pdf-to-png' : 'pdf-to-jpg'
  const result = await runTool(tool, [file], { dpi: options.dpi }, { onProgress: pairProgress(options.onProgress) })
  return result.outputs.map((output) => ({ name: output.name, blob: output.blob }))
}

export async function pdfToDocx(file: File): Promise<NamedBlob> {
  return named(await runTool('pdf-to-word', [file]), 'a Word document')
}

export async function pdfToXlsx(file: File): Promise<NamedBlob> {
  return named(await runTool('pdf-to-excel', [file]), 'a spreadsheet')
}

export async function pdfToPptx(file: File): Promise<NamedBlob> {
  return named(await runTool('pdf-to-powerpoint', [file]), 'a presentation')
}

export async function pdfToMarkdown(file: File): Promise<NamedBlob> {
  return named(await runTool('pdf-to-markdown', [file]), 'a Markdown file')
}

export async function pdfToCsv(file: File): Promise<NamedBlob> {
  return named(await runTool('pdf-to-csv', [file]), 'a CSV file')
}

export async function pdfToTextFile(file: File): Promise<NamedBlob> {
  return named(await runTool('pdf-to-text', [file]), 'a text file')
}

export async function imagesToPdf(images: ImageInput[], options: ImagesToPdfOptions): Promise<Blob> {
  const files = images.map((image, index) => {
    const extension = image.type === 'png' ? 'png' : 'jpg'
    const mime = image.type === 'png' ? 'image/png' : 'image/jpeg'
    const bytes = new Uint8Array(image.bytes)
    return new File([bytes], `image-${index + 1}.${extension}`, { type: mime })
  })
  const result = await runTool('image-to-pdf', files, {
    pageSize: options.pageSize,
    margin: options.margin,
  })
  return firstOutput(result, 'a PDF built from the images')
}

export async function docxToPdf(file: File, _layout: unknown = {}): Promise<NamedBlob> {
  return named(await runTool('word-to-pdf', [file]), 'a PDF')
}

export async function xlsxToPdf(file: File, _layout: unknown = {}): Promise<NamedBlob> {
  return named(await runTool('excel-to-pdf', [file]), 'a PDF')
}

export async function pptxToPdf(file: File, _layout: unknown = {}): Promise<NamedBlob> {
  return named(await runTool('powerpoint-to-pdf', [file]), 'a PDF')
}

export async function markdownToPdf(file: File, _layout: unknown = {}): Promise<NamedBlob> {
  return named(await runTool('markdown-to-pdf', [file]), 'a PDF')
}

export async function htmlToPdf(file: File, _layout: unknown = {}): Promise<NamedBlob> {
  return named(await runTool('html-to-pdf', [file]), 'a PDF')
}

export async function textToPdfFile(file: File, _layout: unknown = {}): Promise<NamedBlob> {
  return named(await runTool('markdown-to-pdf', [file]), 'a PDF')
}

export async function urlToPdf(
  url: string,
  _layout: unknown = {},
): Promise<{ file: NamedBlob; note: string }> {
  const file = named(await runTool('webpage-to-pdf', [], { url }), 'a PDF')
  return { file, note: "Captured by the server's headless Chromium renderer." }
}

/* ----------------------------------- OCR ---------------------------------- */

export async function ocrPdf(
  file: File,
  options: {
    languages?: string[]
    dpi?: number
    onProgress?: (report: { page: number; total: number; percent: number; status: string }) => void
  } = {},
): Promise<{ blob: Blob; text: string; confidence: number; pages: number }> {
  const languages = options.languages?.length ? options.languages.join('+') : 'eng'
  const result = await runTool(
    'ocr',
    [file],
    { languages, dpi: options.dpi },
    {
      onProgress: (percent, stage) =>
        options.onProgress?.({ page: 0, total: 0, percent, status: stage || 'Recognising text' }),
    },
  )
  const pdf = result.outputs[0]
  if (!pdf) throw new ProcessingError('OCR did not produce a searchable PDF')
  const textOutput = result.outputs[1]
  const text = textOutput ? await textOutput.blob.text() : ''
  return {
    blob: pdf.blob,
    text,
    confidence: metaNumber(result, 'confidence'),
    pages: metaNumber(result, 'pages'),
  }
}

/* --------------------------------- security -------------------------------- */

export interface EncryptOptions {
  userPassword: string
  ownerPassword?: string
  encryptMetadata?: boolean
  allowPrint?: boolean
  allowCopy?: boolean
  allowModify?: boolean
}

export async function encryptPdf(file: File | Blob, options: EncryptOptions): Promise<Blob> {
  const result = await runTool('encrypt', [file], { ...options })
  return firstOutput(result, 'a protected PDF')
}

export async function decryptPdf(
  file: File | Blob,
  password: string,
): Promise<{ blob: Blob; usedOwnerPassword: boolean }> {
  const result = await runTool('decrypt', [file], { password })
  const meta = result.meta as Record<string, unknown> | null
  return { blob: firstOutput(result, 'an unlocked PDF'), usedOwnerPassword: Boolean(meta?.usedOwnerPassword) }
}
