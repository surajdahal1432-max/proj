import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import pptxgen from 'pptxgenjs'
import JSZip from 'jszip'
import { parseDocumentXml, type ParsedDocx } from './docxParse'

/* ------------------------------------------------------------------ *
 * Word (.docx)
 * ------------------------------------------------------------------ */

export interface DocxParagraph {
  text: string
  style?: 'title' | 'heading1' | 'heading2' | 'heading3' | 'body' | 'bullet'
  bold?: boolean
  italic?: boolean
  fontSize?: number
}

export interface DocxOptions {
  title?: string
  paragraphs: DocxParagraph[]
}

export async function buildDocx(options: DocxOptions): Promise<Blob> {
  const children: Paragraph[] = []

  if (options.title) {
    children.push(
      new Paragraph({
        text: options.title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 240 },
      }),
    )
  }

  for (const paragraph of options.paragraphs) {
    if (!paragraph.text.trim()) {
      children.push(new Paragraph({ text: '' }))
      continue
    }
    const heading =
      paragraph.style === 'heading1'
        ? HeadingLevel.HEADING_1
        : paragraph.style === 'heading2'
          ? HeadingLevel.HEADING_2
          : paragraph.style === 'heading3'
            ? HeadingLevel.HEADING_3
            : undefined

    if (heading) {
      children.push(
        new Paragraph({
          heading,
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: paragraph.text, bold: true })],
        }),
      )
      continue
    }

    children.push(
      new Paragraph({
        bullet: paragraph.style === 'bullet' ? { level: 0 } : undefined,
        spacing: { after: 120, line: 300 },
        children: [
          new TextRun({
            text: paragraph.text,
            bold: paragraph.bold,
            italics: paragraph.italic,
            size: paragraph.fontSize ? paragraph.fontSize * 2 : 22,
          }),
        ],
      }),
    )
  }

  const doc = new Document({
    creator: 'Folio',
    title: options.title || 'Folio export',
    description: 'Converted with Folio',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        children: children.length ? children : [new Paragraph({ text: '' })],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

export interface DocxReadResult {
  paragraphs: DocxParagraph[]
  characterCount: number
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Reads the OOXML parts of a .docx and parses `word/document.xml` with a real
 * XML DOM. Styles, numbering and relationships are passed through so heading
 * detection, list markers and hyperlinks resolve correctly.
 *
 * Deliberately does not use regular expressions: a `<w:t[^>]*>` pattern also
 * matches `<w:tab/>`, `<w:tbl>`, `<w:tc>` and `<w:tr>`, which is exactly how raw
 * markup used to leak into generated PDFs.
 */
export async function parseDocxFile(file: File | Blob): Promise<ParsedDocx> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('This file is not a valid .docx archive. It may be corrupted or password-protected.')
  }
  const read = async (path: string) => (await zip.file(path)?.async('string')) ?? null
  const documentXml = await read('word/document.xml')
  if (!documentXml) {
    throw new Error('This .docx file has no document body (word/document.xml is missing).')
  }
  const [stylesXml, numberingXml, relsXml] = await Promise.all([
    read('word/styles.xml'),
    read('word/numbering.xml'),
    read('word/_rels/document.xml.rels'),
  ])
  return parseDocumentXml(documentXml, { stylesXml, numberingXml, relsXml })
}

/** Plain-paragraph view of a .docx, kept for callers that only need text. */
export async function readDocx(file: File | Blob): Promise<DocxReadResult> {
  const parsed = await parseDocxFile(file)
  const paragraphs: DocxParagraph[] = parsed.paragraphs.map((block) => ({
    text: block.text,
    style: block.style,
    bold: block.runs.some((run) => run.bold),
    italic: block.runs.some((run) => run.italic),
  }))
  return {
    paragraphs,
    characterCount: paragraphs.reduce((sum, p) => sum + p.text.length, 0),
  }
}

/* ------------------------------------------------------------------ *
 * PowerPoint (.pptx)
 * ------------------------------------------------------------------ */

export interface SlideSpec {
  title: string
  lines: string[]
}

export interface PptxOptions {
  title: string
  slides: SlideSpec[]
  theme?: 'midnight' | 'paper'
}

export async function buildPptx(options: PptxOptions): Promise<Blob> {
  const pptx = new pptxgen()
  const dark = (options.theme ?? 'midnight') === 'midnight'
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'Folio'
  pptx.title = options.title

  const background = dark ? '0B1020' : 'FFFFFF'
  const titleColor = dark ? 'E9EDFF' : '111827'
  const bodyColor = dark ? 'B9C2E0' : '374151'
  const accent = '6366F1'

  const cover = pptx.addSlide()
  cover.background = { color: background }
  cover.addShape('rect', { x: 0.6, y: 2.2, w: 0.12, h: 1.2, fill: { color: accent } })
  cover.addText(options.title || 'Folio export', {
    x: 0.9,
    y: 2.1,
    w: 11.5,
    h: 1.2,
    fontSize: 34,
    bold: true,
    color: titleColor,
    fontFace: 'Segoe UI',
  })
  cover.addText(`${options.slides.length} slides · converted with Folio`, {
    x: 0.9,
    y: 3.35,
    w: 10,
    h: 0.5,
    fontSize: 14,
    color: bodyColor,
    fontFace: 'Segoe UI',
  })

  for (const slide of options.slides) {
    const page = pptx.addSlide()
    page.background = { color: background }
    page.addText(slide.title || 'Slide', {
      x: 0.7,
      y: 0.45,
      w: 11.9,
      h: 0.9,
      fontSize: 26,
      bold: true,
      color: titleColor,
      fontFace: 'Segoe UI',
    })
    page.addShape('line', { x: 0.7, y: 1.35, w: 11.9, h: 0, line: { color: accent, width: 1.5 } })
    if (slide.lines.length) {
      page.addText(
        slide.lines.slice(0, 12).map((line) => ({ text: line, options: { bullet: true, breakLine: true } })),
        {
          x: 0.85,
          y: 1.6,
          w: 11.5,
          h: 4.6,
          fontSize: 15,
          color: bodyColor,
          fontFace: 'Segoe UI',
          lineSpacingMultiple: 1.2,
        },
      )
    }
  }

  const result = (await pptx.write({ outputType: 'blob' })) as Blob
  return new Blob([result], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}

export interface PptxReadResult {
  slides: SlideSpec[]
}

export async function readPptx(file: File | Blob): Promise<PptxReadResult> {
  const zip = await JSZip.loadAsync(file)
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(/slide(\d+)/.exec(a)?.[1] ?? '0', 10)
      const nb = parseInt(/slide(\d+)/.exec(b)?.[1] ?? '0', 10)
      return na - nb
    })

  const slides: SlideSpec[] = []
  for (const path of slidePaths) {
    const xml = await zip.file(path)!.async('string')
    const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((match) =>
      [...match[1].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXmlEntities(t[1])).join(''),
    )
    const cleaned = paragraphs.map((p) => p.trim()).filter(Boolean)
    slides.push({ title: cleaned[0] ?? `Slide ${slides.length + 1}`, lines: cleaned.slice(1) })
  }

  if (slides.length === 0) throw new Error('No slides found in this presentation.')
  return { slides }
}

/* ------------------------------------------------------------------ *
 * HTML & Markdown
 * ------------------------------------------------------------------ */

export async function readHtmlText(file: File | Blob): Promise<{ title: string; blocks: DocxParagraph[] }> {
  const html = await file.text()
  return parseHtmlToBlocks(html)
}

export function parseHtmlToBlocks(html: string): { title: string; blocks: DocxParagraph[] } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, noscript, svg').forEach((node) => node.remove())
  const title = doc.querySelector('title')?.textContent?.trim() || doc.querySelector('h1')?.textContent?.trim() || ''

  const blocks: DocxParagraph[] = []
  const walk = (root: Element) => {
    for (const node of Array.from(root.children)) {
      const tag = node.tagName.toLowerCase()
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag) && text) {
        blocks.push({ text, style: tag === 'h1' ? 'heading1' : tag === 'h2' ? 'heading2' : 'heading3' })
        continue
      }
      if (tag === 'p' && text) {
        blocks.push({ text, style: 'body' })
        continue
      }
      if (tag === 'li' && text) {
        blocks.push({ text, style: 'bullet' })
        continue
      }
      if (tag === 'table') {
        for (const row of Array.from(node.querySelectorAll('tr'))) {
          const cells = Array.from(row.querySelectorAll('th,td')).map((cell) =>
            (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
          )
          if (cells.some(Boolean)) blocks.push({ text: cells.join(' | '), style: 'body' })
        }
        continue
      }
      if (tag === 'pre' && text) {
        blocks.push({ text, style: 'body' })
        continue
      }
      if (node.children.length > 0) {
        walk(node)
      } else if (text) {
        blocks.push({ text, style: 'body' })
      }
    }
  }

  if (doc.body) walk(doc.body)
  return { title, blocks }
}

export interface MarkdownBlock {
  type: 'heading' | 'paragraph' | 'bullet' | 'numbered' | 'code' | 'table'
  text: string
  level?: number
  rows?: string[][]
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let buffer: string[] = []
  let inCode = false

  const flush = () => {
    if (buffer.length) {
      const text = buffer.join(' ').trim()
      if (text) blocks.push({ type: 'paragraph', text })
      buffer = []
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*```/.test(line)) {
      if (inCode) {
        blocks.push({ type: 'code', text: buffer.join('\n') })
        buffer = []
        inCode = false
      } else {
        flush()
        inCode = true
      }
      continue
    }
    if (inCode) {
      buffer.push(line)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', text: heading[2].trim(), level: heading[1].length })
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      blocks.push({ type: 'bullet', text: bullet[1].trim() })
      continue
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      flush()
      blocks.push({ type: 'numbered', text: numbered[1].trim() })
      continue
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush()
      const tableLines: string[] = []
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        tableLines.push(lines[index])
        index++
      }
      index--
      const rows = tableLines
        .filter((row) => !/^\s*\|[\s:|-]+\|\s*$/.test(row))
        .map((row) =>
          row
            .replace(/^\s*\|/, '')
            .replace(/\|\s*$/, '')
            .split('|')
            .map((cell) => cell.trim().replace(/\*\*/g, '')),
        )
      if (rows.length) blocks.push({ type: 'table', text: '', rows })
      continue
    }

    if (!line.trim()) {
      flush()
      continue
    }
    buffer.push(line.trim())
  }

  flush()
  if (inCode && buffer.length) blocks.push({ type: 'code', text: buffer.join('\n') })
  return blocks
}

/** Convert a plain-text document into Markdown with heuristics for headings/lists. */
export function textToMarkdown(title: string, pages: { pageNumber: number; text: string }[]): string {
  const out: string[] = [`# ${title}`, '']
  for (const page of pages) {
    const lines = page.text.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!lines.length) continue
    out.push(`<!-- page ${page.pageNumber} -->`, '')
    for (const line of lines) {
      if (line.length < 80 && /^[A-Z0-9][^.!?]*$/.test(line) && line.split(' ').length <= 12) {
        out.push(`## ${line}`, '')
      } else if (/^[•·▪-]\s+/.test(line)) {
        out.push(`- ${line.replace(/^[•·▪-]\s+/, '')}`)
      } else {
        out.push(line, '')
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
