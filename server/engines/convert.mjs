import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { pdfToText } from './native.mjs'

/* --------------------------- text extraction --------------------------- */

/** Group layout-preserved text into logical blocks per page. */
export function pagesFromText(text) {
  return String(text || '')
    .split('\f')
    .map((page) => page.replace(/\r/g, '').split('\n'))
    .filter((lines) => lines.some((line) => line.trim()))
}

const HEADING = /^(?:[A-Z][A-Z0-9 \-&.,'()]{3,80}|(?:\d+\.)+\s+[A-Z].{0,80})$/

export function looksLikeHeading(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 90) return false
  if (HEADING.test(trimmed)) return true
  return trimmed.length < 60 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)
}

/* ------------------------------ PDF → DOCX ------------------------------ */

export async function pdfToDocx(input, output, { title = 'Document' } = {}, ctx = {}) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
  const text = await pdfToText(input, ctx)
  const pages = pagesFromText(text)
  if (!pages.length) throw new Error('No selectable text was found. Run OCR PDF first for scanned documents.')
  const children = []
  pages.forEach((lines, pageIndex) => {
    if (pageIndex > 0) children.push(new Paragraph({ text: '', pageBreakBefore: true }))
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        children.push(new Paragraph({ text: '' }))
        continue
      }
      if (looksLikeHeading(trimmed)) {
        children.push(new Paragraph({ text: trimmed, heading: HeadingLevel.HEADING_2, spacing: { after: 120 } }))
      } else {
        children.push(new Paragraph({ children: [new TextRun({ text: trimmed, size: 22 })], spacing: { after: 60 } }))
      }
    }
  })
  const doc = new Document({
    creator: 'Folio',
    title,
    sections: [{ properties: {}, children: children.length ? children : [new Paragraph({ text: '' })] }],
  })
  await writeFile(output, await Packer.toBuffer(doc))
  return { pages: pages.length, paragraphs: children.length }
}

/* ------------------------------ PDF → XLSX ------------------------------ */

/** Detect tables by splitting layout text on runs of two or more spaces. */
export function detectTablesFromText(text) {
  const pages = pagesFromText(text)
  const tables = []
  for (const lines of pages) {
    let current = []
    for (const line of lines) {
      const cells = line.trim().split(/\s{2,}/).filter((cell) => cell.length > 0)
      if (cells.length >= 2) current.push(cells)
      else if (current.length) {
        if (current.length >= 2) tables.push(current)
        current = []
      }
    }
    if (current.length >= 2) tables.push(current)
  }
  return tables
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

function columnName(index) {
  let name = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

export async function writeXlsx(sheets, output) {
  const zip = new JSZip()
  const sheetEntries = sheets.map((sheet, index) => ({ name: (sheet.name || `Sheet${index + 1}`).slice(0, 31), rows: sheet.rows }))
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetEntries
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries
      .map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('')}</Relationships>`,
  )
  sheetEntries.forEach((sheet, index) => {
    const rows = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, columnIndex) => {
            const ref = `${columnName(columnIndex)}${rowIndex + 1}`
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
          })
          .join('')
        return `<row r="${rowIndex + 1}">${cells}</row>`
      })
      .join('')
    zip.file(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    )
  })
  await writeFile(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

export async function pdfToXlsx(input, output, ctx = {}) {
  const text = await pdfToText(input, ctx)
  const tables = detectTablesFromText(text)
  if (!tables.length) throw new Error('No tabular structure was detected in this PDF.')
  const sheets = tables.map((rows, index) => ({ name: `Table ${index + 1}`, rows }))
  await writeXlsx(sheets, output)
  return { tables: tables.length, rows: tables.reduce((sum, table) => sum + table.length, 0) }
}

/* --------------------------- PDF → PowerPoint --------------------------- */

export async function pdfToPptx(input, output, { title = 'Converted document' } = {}, ctx = {}) {
  const pptxgen = (await import('pptxgenjs')).default
  const text = await pdfToText(input, ctx)
  const pages = pagesFromText(text)
  if (!pages.length) throw new Error('No selectable text was found. Run OCR PDF first for scanned documents.')
  const deck = new pptxgen()
  deck.layout = 'LAYOUT_16x9'
  deck.title = title
  pages.forEach((lines, index) => {
    const slide = deck.addSlide()
    const meaningful = lines.map((line) => line.trim()).filter(Boolean)
    const heading = meaningful.find((line) => looksLikeHeading(line)) ?? `Page ${index + 1}`
    slide.addText(heading.slice(0, 120), { x: 0.4, y: 0.3, w: 9.2, h: 0.8, fontSize: 24, bold: true, color: '1F2937' })
    const body = meaningful.filter((line) => line !== heading).slice(0, 14)
    if (body.length) {
      slide.addText(
        body.map((line) => ({ text: line, options: { bullet: false, fontSize: 12, color: '374151' } })),
        { x: 0.5, y: 1.2, w: 9, h: 4.3, valign: 'top' },
      )
    }
    ctx.onProgress?.(((index + 1) / pages.length) * 85)
  })
  const buffer = await deck.write({ outputType: 'nodebuffer' })
  await writeFile(output, Buffer.from(buffer))
  return { slides: pages.length }
}

/* ----------------------------- PDF → text ----------------------------- */

export async function pdfToTxt(input, output, ctx = {}) {
  const text = await pdfToText(input, ctx)
  if (!text.trim()) throw new Error('This PDF has no selectable text. Run OCR PDF first.')
  await writeFile(output, text, 'utf8')
  return { characters: text.length }
}

export async function pdfToMarkdown(input, output, ctx = {}) {
  const text = await pdfToText(input, ctx)
  const pages = pagesFromText(text)
  if (!pages.length) throw new Error('This PDF has no selectable text. Run OCR PDF first.')
  const parts = []
  pages.forEach((lines, index) => {
    parts.push(`## Page ${index + 1}`)
    let listOpen = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        listOpen = false
        parts.push('')
        continue
      }
      if (looksLikeHeading(trimmed)) {
        listOpen = false
        parts.push(`### ${trimmed}`)
      } else if (/^[•\-*]\s+/.test(trimmed)) {
        listOpen = true
        parts.push(`- ${trimmed.replace(/^[•\-*]\s+/, '')}`)
      } else if (/^\d+[.)]\s+/.test(trimmed)) {
        listOpen = true
        parts.push(trimmed.replace(/^(\d+)[.)]\s+/, '$1. '))
      } else {
        parts.push(listOpen ? `  ${trimmed}` : trimmed)
      }
    }
    parts.push('')
  })
  const markdown = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  await writeFile(output, `${markdown}\n`, 'utf8')
  return { characters: markdown.length }
}

/* ----------------------------- text → PDF ----------------------------- */

/** Minimal, dependency-free Markdown → HTML used for LibreOffice rendering. */
export function markdownToHtml(markdown) {
  const escape = (value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = String(markdown || '').replace(/\r/g, '').split('\n')
  const html = []
  let inList = false
  let inCode = false
  for (const line of lines) {
    if (/^```/.test(line)) {
      html.push(inCode ? '</pre>' : '<pre>')
      inCode = !inCode
      continue
    }
    if (inCode) {
      html.push(escape(line))
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      if (inList) {
        html.push('</ul>')
        inList = false
      }
      const level = heading[1].length
      html.push(`<h${level}>${escape(heading[2])}</h${level}>`)
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${escape(line.replace(/^\s*[-*+]\s+/, ''))}</li>`)
      continue
    }
    if (inList) {
      html.push('</ul>')
      inList = false
    }
    if (!line.trim()) {
      html.push('<p></p>')
      continue
    }
    const inline = escape(line)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|\s)\*([^*]+)\*/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
    html.push(`<p>${inline}</p>`)
  }
  if (inList) html.push('</ul>')
  if (inCode) html.push('</pre>')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Folio</title><style>body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.5;margin:2cm}h1,h2,h3{color:#111}code,pre{font-family:Courier,monospace;background:#f4f4f5;padding:2px 4px}ul{margin-left:1.2em}</style></head><body>${html.join('\n')}</body></html>`
}

export async function textToHtmlFile(markdown, output) {
  await writeFile(output, markdownToHtml(markdown), 'utf8')
  return output
}

/* ----------------------------- comparison ----------------------------- */

function tokenize(text) {
  return String(text || '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

/** Longest-common-subsequence diff, bounded so huge documents stay responsive. */
export function diffTokens(before, after, limit = 4000) {
  const a = tokenize(before).slice(0, limit)
  const b = tokenize(after).slice(0, limit)
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', value: a[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'removed', value: a[i] })
      i += 1
    } else {
      ops.push({ type: 'added', value: b[j] })
      j += 1
    }
  }
  while (i < a.length) {
    ops.push({ type: 'removed', value: a[i] })
    i += 1
  }
  while (j < b.length) {
    ops.push({ type: 'added', value: b[j] })
    j += 1
  }
  return ops
}

export async function comparePdfs(beforePath, afterPath, outputPath, ctx = {}) {
  const before = await pdfToText(beforePath, ctx)
  const after = await pdfToText(afterPath, ctx)
  const ops = diffTokens(before, after)
  const added = ops.filter((op) => op.type === 'added')
  const removed = ops.filter((op) => op.type === 'removed')

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pageWidth = 595.28
  const pageHeight = 841.89
  const margin = 48
  let page = doc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const write = (text, { size = 10, font: face = font, color = { r: 0.1, g: 0.1, b: 0.1 } } = {}) => {
    const clean = String(text).replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
    const maxWidth = pageWidth - margin * 2
    const words = clean.split(/\s+/)
    let line = ''
    const lines = []
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (face.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
    for (const entry of lines) {
      if (y < margin + size * 2) {
        page = doc.addPage([pageWidth, pageHeight])
        y = pageHeight - margin
      }
      page.drawText(entry, { x: margin, y, size, font: face, color: rgb(color.r, color.g, color.b) })
      y -= size * 1.45
    }
  }

  write('Document comparison report', { size: 18, font: bold })
  y -= 6
  write(`Additions: ${added.length} words   Removals: ${removed.length} words`, { size: 10 })
  y -= 8
  write('Removed text', { size: 13, font: bold, color: { r: 0.7, g: 0.1, b: 0.1 } })
  write(removed.length ? removed.map((op) => op.value).join(' ') : 'None', { color: { r: 0.55, g: 0.1, b: 0.1 } })
  y -= 8
  write('Added text', { size: 13, font: bold, color: { r: 0.05, g: 0.45, b: 0.15 } })
  write(added.length ? added.map((op) => op.value).join(' ') : 'None', { color: { r: 0.05, g: 0.4, b: 0.15 } })
  y -= 8
  write('Full comparison', { size: 13, font: bold })
  write(ops.map((op) => (op.type === 'added' ? `[+${op.value}]` : op.type === 'removed' ? `[-${op.value}]` : op.value)).join(' '))

  await writeFile(outputPath, await doc.save())
  return { added: added.length, removed: removed.length, pages: doc.getPageCount() }
}

export { readFile, writeFile, join }
