import { pageTextToPlain, readPdfText, rasterizePdf, type PdfTextDocument } from './pdf'
import { blocksToPdf, textToBlocks, type TextBlock, type TextPdfOptions } from './textPdf'
import { buildDocx, buildPptx, parseDocxFile, parseHtmlToBlocks, parseMarkdown, readHtmlText, readPptx, type DocxParagraph } from './ooxml'
import { renderDocxToPdf } from './docxRender'
import { buildXlsx, readXlsx, rowsToCsv, type CellValue } from './xlsx'
import { baseName, downloadBlob } from './utils'

export interface ConversionOptions {
  password?: string
  layout?: TextPdfOptions
}

export interface NamedBlob {
  name: string
  blob: Blob
}

/* ------------------------------------------------------------------ *
 * Table detection from positioned PDF text
 * ------------------------------------------------------------------ */

export interface DetectedTable {
  page: number
  rows: string[][]
}

interface PositionedLine {
  text: string
  x: number
  y: number
  fontSize: number
}

/**
 * Groups positioned text lines into rows (shared baseline) and columns
 * (x-position clusters). Requires at least two columns and three rows to
 * count as tabular data, which avoids false positives on prose.
 */
export function detectTables(document: PdfTextDocument): DetectedTable[] {
  const tables: DetectedTable[] = []

  for (const page of document.pages) {
    const lines = page.lines.filter((line) => line.text.trim().length > 0)
    if (lines.length < 3) continue

    const rows: PositionedLine[][] = []
    for (const line of lines.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
      const existing = rows.find((row) => Math.abs(row[0].y - line.y) <= Math.max(2, line.fontSize * 0.4))
      if (existing) existing.push(line)
      else rows.push([line])
    }

    const multiCellRows = rows
      .map((row) => row.slice().sort((a, b) => a.x - b.x))
      .filter((row) => row.length >= 2)

    if (multiCellRows.length < 3) continue

    const columnCounts = multiCellRows.map((row) => row.length)
    const mode = columnCounts
      .slice()
      .sort((a, b) => columnCounts.filter((c) => c === b).length - columnCounts.filter((c) => c === a).length)[0]
    const consistent = multiCellRows.filter((row) => Math.abs(row.length - mode) <= 1)
    if (consistent.length < 3) continue

    tables.push({
      page: page.pageNumber,
      rows: consistent.map((row) => row.map((cell) => cell.text.trim())),
    })
  }

  return tables
}

/* ------------------------------------------------------------------ *
 * PDF → Office / Markdown / images
 * ------------------------------------------------------------------ */

export async function pdfToDocx(file: File, options: ConversionOptions = {}): Promise<NamedBlob> {
  const text = await readPdfText(file, options.password)
  const paragraphs: DocxParagraph[] = []

  for (const page of text.pages) {
    const lines = page.text.split('\n').map((line) => line.trim()).filter(Boolean)
    for (const line of lines) {
      const isHeading = line.length < 80 && line.split(/\s+/).length <= 12 && /^[A-Z0-9]/.test(line) && !/[.;:]$/.test(line)
      paragraphs.push({ text: line, style: isHeading ? 'heading2' : 'body' })
    }
    paragraphs.push({ text: '' })
  }

  if (paragraphs.length === 0) {
    throw new Error('No selectable text found. This looks like a scanned document — run OCR first.')
  }

  const blob = await buildDocx({
    title: text.title || baseName(file.name),
    paragraphs,
  })
  return { name: `${baseName(file.name)}.docx`, blob }
}

export async function pdfToPptx(file: File, options: ConversionOptions = {}): Promise<NamedBlob> {
  const text = await readPdfText(file, options.password)
  const slides = text.pages.map((page, index) => {
    const lines = page.text.split('\n').map((line) => line.trim()).filter(Boolean)
    return {
      title: lines[0] || `Page ${index + 1}`,
      lines: lines.slice(1, 13),
    }
  })

  if (slides.every((slide) => slide.lines.length === 0)) {
    throw new Error('No selectable text found. Run OCR first to convert scanned pages.')
  }

  const blob = await buildPptx({ title: text.title || baseName(file.name), slides })
  return { name: `${baseName(file.name)}.pptx`, blob }
}

export async function pdfToXlsx(file: File, options: ConversionOptions = {}): Promise<NamedBlob> {
  const text = await readPdfText(file, options.password)
  const tables = detectTables(text)

  const sheets: { name: string; rows: CellValue[][] }[] = []

  if (tables.length) {
    tables.forEach((table, index) => {
      sheets.push({ name: `Table ${index + 1}`, rows: table.rows })
    })
  } else {
    // No tables detected: emit the document text line-by-line so nothing is lost.
    const rows: CellValue[][] = [['Page', 'Line', 'Text']]
    for (const page of text.pages) {
      page.text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line, lineIndex) => rows.push([page.pageNumber, lineIndex + 1, line]))
    }
    if (rows.length <= 1) {
      throw new Error('No extractable content found. Run OCR first for scanned documents.')
    }
    sheets.push({ name: 'Document text', rows })
  }

  const blob = await buildXlsx(sheets)
  return { name: `${baseName(file.name)}.xlsx`, blob }
}

export async function pdfToCsv(file: File, options: ConversionOptions = {}): Promise<NamedBlob> {
  const text = await readPdfText(file, options.password)
  const tables = detectTables(text)
  const rows: string[][] = tables.length
    ? tables.flatMap((table) => table.rows)
    : text.pages.flatMap((page) =>
        page.text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => [line]),
      )
  if (!rows.length) throw new Error('No extractable rows found in this document.')
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
  return { name: `${baseName(file.name)}.csv`, blob }
}

export async function pdfToMarkdown(file: File, options: ConversionOptions = {}): Promise<NamedBlob> {
  const text = await readPdfText(file, options.password)
  const blocks: TextBlock[] = []
  for (const page of text.pages) {
    blocks.push({ style: 'h3', text: `Page ${page.pageNumber}` })
    blocks.push(...textToBlocks(page.text))
  }
  const markdown = blocks
    .map((block) => {
      switch (block.style) {
        case 'h1':
          return `# ${block.text}`
        case 'h2':
          return `## ${block.text}`
        case 'h3':
          return `### ${block.text}`
        case 'bullet':
          return `- ${block.text}`
        default:
          return block.text
      }
    })
    .join('\n\n')

  const title = text.title || baseName(file.name)
  const blob = new Blob([`# ${title}\n\n${markdown}\n`], { type: 'text/markdown;charset=utf-8' })
  return { name: `${baseName(file.name)}.md`, blob }
}

export async function pdfToImages(
  file: File,
  options: { format?: 'png' | 'jpeg'; dpi?: number; password?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<NamedBlob[]> {
  const { format = 'png', dpi = 150 } = options
  const base = baseName(file.name)

  if (format === 'jpeg') {
    const pages = await rasterizePdf(file, {
      dpi,
      quality: 0.9,
      password: options.password,
      onProgress: options.onProgress,
    })
    return pages.map((page, index) => ({
      name: `${base}-page-${index + 1}.jpg`,
      blob: new Blob([page.bytes as unknown as BlobPart], { type: 'image/jpeg' }),
    }))
  }

  const buffer = await file.arrayBuffer()
  const { loadPdf, renderPageToDataUrl } = await import('./pdfjs')
  const doc = await loadPdf(buffer, { password: options.password })

  const results: NamedBlob[] = []
  try {
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index)
      const rendered = await renderPageToDataUrl(page, { scale: Math.min(4, dpi / 72), format: 'png', pixelRatio: 1 })
      results.push({ name: `${base}-page-${index + 1}.png`, blob: rendered.blob })
      page.cleanup()
      options.onProgress?.(index, doc.numPages)
    }
  } finally {
    await closePdf(doc)
  }
  return results
}

export async function pdfToTextFile(file: File, options: ConversionOptions = {}): Promise<NamedBlob> {
  const text = await readPdfText(file, options.password)
  const blob = new Blob([pageTextToPlain(text)], { type: 'text/plain;charset=utf-8' })
  return { name: `${baseName(file.name)}.txt`, blob }
}

/* ------------------------------------------------------------------ *
 * Office / Markdown / HTML → PDF
 * ------------------------------------------------------------------ */

function docxParagraphsToBlocks(paragraphs: DocxParagraph[]): TextBlock[] {
  return paragraphs.map((paragraph) => ({
    text: paragraph.text,
    style:
      paragraph.style === 'title'
        ? 'title'
        : paragraph.style === 'heading1'
          ? 'h1'
          : paragraph.style === 'heading2'
            ? 'h2'
            : paragraph.style === 'heading3'
              ? 'h3'
              : paragraph.style === 'bullet'
                ? 'bullet'
                : 'body',
  }))
}

export async function docxToPdf(file: File, layout: TextPdfOptions = {}): Promise<NamedBlob> {
  // Structured parse first: this walks word/document.xml with a real XML DOM
  // (namespaces honoured) instead of scraping markup with regular expressions,
  // which is what previously leaked `<w:t>` / `<w:tab>` into the PDF text.
  const parsed = await parseDocxFile(file)
  if (!parsed.blocks.length) {
    throw new Error('This Word document appears to be empty.')
  }
  const blob = await renderDocxToPdf(parsed, {
    title: layout.title || baseName(file.name),
    baseFontSize: layout.baseFontSize,
    margin: layout.margin,
  })
  return { name: `${baseName(file.name)}.pdf`, blob }
}

export async function xlsxToPdf(file: File, layout: TextPdfOptions = {}): Promise<NamedBlob> {
  const rows = (await readXlsx(file)).map((row) => row.map((cell) => (cell == null ? '' : String(cell))))
  if (!rows.length) throw new Error('This spreadsheet has no readable cells.')
  const blocks: TextBlock[] = [{ style: 'title', text: baseName(file.name) }, { style: 'table', text: '', rows }]
  const blob = await blocksToPdf(blocks, { ...layout, pageSize: layout.pageSize ?? 'a4', orientation: 'landscape' })
  return { name: `${baseName(file.name)}.pdf`, blob }
}

export async function pptxToPdf(file: File, layout: TextPdfOptions = {}): Promise<NamedBlob> {
  const { slides } = await readPptx(file)
  const blocks: TextBlock[] = []
  slides.forEach((slide, index) => {
    if (index > 0) blocks.push({ style: 'body', text: '' })
    blocks.push({ style: 'h1', text: slide.title })
    slide.lines.forEach((line) => blocks.push({ style: 'bullet', text: line }))
  })
  const blob = await blocksToPdf(blocks, { ...layout, orientation: 'landscape' })
  return { name: `${baseName(file.name)}.pdf`, blob }
}

export async function markdownToPdf(file: File, layout: TextPdfOptions = {}): Promise<NamedBlob> {
  const markdown = await file.text()
  const blocks: TextBlock[] = parseMarkdown(markdown).map((block) => {
    if (block.type === 'table' && block.rows) return { style: 'table', text: '', rows: block.rows }
    const style =
      block.type === 'heading'
        ? block.level === 1
          ? 'h1'
          : block.level === 2
            ? 'h2'
            : 'h3'
        : block.type === 'bullet'
          ? 'bullet'
          : block.type === 'code'
            ? 'code'
            : 'body'
    return { style, text: block.text }
  })
  if (!blocks.length) throw new Error('No Markdown content found in this file.')
  const blob = await blocksToPdf(blocks, { ...layout, title: layout.title || baseName(file.name) })
  return { name: `${baseName(file.name)}.pdf`, blob }
}

export async function htmlToPdf(file: File, layout: TextPdfOptions = {}): Promise<NamedBlob> {
  const { title, blocks } = await readHtmlText(file)
  if (!blocks.length) throw new Error('No readable content found in this HTML file.')
  const blob = await blocksToPdf(
    docxParagraphsToBlocks(blocks),
    { ...layout, title: layout.title || title || baseName(file.name) },
  )
  return { name: `${baseName(file.name)}.pdf`, blob }
}

export async function textToPdfFile(file: File, layout: TextPdfOptions = {}): Promise<NamedBlob> {
  const text = await file.text()
  const blob = await blocksToPdf(textToBlocks(text), { ...layout, title: baseName(file.name) })
  return { name: `${baseName(file.name)}.pdf`, blob }
}

export interface UrlPdfResult {
  file: NamedBlob
  note: string
}

/**
 * Fetch a page and lay it out as PDF. Direct fetch works for CORS-friendly
 * origins; otherwise the reader-text proxy is used (disabled in strict local mode).
 */
export async function urlToPdf(
  url: string,
  options: { strictLocal?: boolean; layout?: TextPdfOptions } = {},
): Promise<UrlPdfResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Enter a complete URL including https://')
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http and https URLs are supported.')

  let html = ''
  let note = 'Fetched directly from the source page.'
  try {
    const response = await fetch(parsed.toString(), { mode: 'cors' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    html = await response.text()
  } catch {
    if (options.strictLocal) {
      throw new Error(
        'This site blocks direct browser requests. Strict Local Mode is on, so no proxy request was made — download the page and convert the HTML file instead.',
      )
    }
    const proxy = await fetch(`https://r.jina.ai/${parsed.toString()}`)
    if (!proxy.ok) throw new Error('Could not fetch this page. Check the URL or convert a saved HTML file.')
    html = await proxy.text()
    note = 'Direct fetch was blocked by CORS, so Folio used a reader proxy for the page text.'
  }

  const isHtml = /<html|<body|<div|<p[\s>]/i.test(html)
  const blocks: TextBlock[] = isHtml
    ? docxParagraphsToBlocks(parseHtmlToBlocks(html).blocks)
    : parseMarkdown(html).map((block) => ({ text: block.text, style: block.type === 'heading' ? 'h2' : 'body' }))

  if (!blocks.length) throw new Error('That page returned no readable text.')

  const blob = await blocksToPdf(
    [{ style: 'title', text: parsed.hostname + parsed.pathname }, ...blocks],
    { ...options.layout, title: parsed.hostname },
  )
  return { file: { name: `${parsed.hostname.replace(/[^a-z0-9.-]/gi, '_')}.pdf`, blob }, note }
}

export function saveNamed(blob: Blob, name: string) {
  downloadBlob(blob, name)
}
