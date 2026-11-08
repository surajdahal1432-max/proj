import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import { sanitizeWinAnsi } from './pdf'

export type TextBlockStyle =
  | 'title'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bullet'
  | 'numbered'
  | 'code'
  | 'table'

export interface TextBlock {
  text: string
  style?: TextBlockStyle
  rows?: string[][]
}

export type PageSizeName = 'a4' | 'letter' | 'legal' | 'a3' | 'a5'

export interface TextPdfOptions {
  pageSize?: PageSizeName
  orientation?: 'portrait' | 'landscape'
  margin?: number
  baseFontSize?: number
  fontFamily?: 'helvetica' | 'times' | 'courier'
  title?: string
  headerText?: string
  footerText?: string
  showPageNumbers?: boolean
  lineHeight?: number
  accentColor?: { r: number; g: number; b: number }
}

const PAGE_SIZES: Record<PageSizeName, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
}

interface Cursor {
  page: PDFPage
  y: number
}

export async function blocksToPdf(blocks: TextBlock[], options: TextPdfOptions = {}): Promise<Blob> {
  const {
    pageSize = 'a4',
    orientation = 'portrait',
    margin = 56,
    baseFontSize = 11,
    fontFamily = 'helvetica',
    headerText,
    footerText,
    showPageNumbers = true,
    lineHeight = 1.45,
  } = options

  const doc = await PDFDocument.create()
  doc.setProducer('Folio')
  doc.setCreator('Folio — local document engine')
  if (options.title) doc.setTitle(options.title)
  doc.setCreationDate(new Date())

  const fontMap = {
    helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold, italic: StandardFonts.HelveticaOblique },
    times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold, italic: StandardFonts.TimesRomanItalic },
    courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold, italic: StandardFonts.CourierOblique },
  }[fontFamily]

  const font = await doc.embedFont(fontMap.regular)
  const boldFont = await doc.embedFont(fontMap.bold)
  const monoFont = await doc.embedFont(StandardFonts.Courier)

  const [rawWidth, rawHeight] = PAGE_SIZES[pageSize]
  const [pageWidth, pageHeight] = orientation === 'landscape' ? [rawHeight, rawWidth] : [rawWidth, rawHeight]
  const contentWidth = pageWidth - margin * 2
  const top = pageHeight - margin
  const bottom = margin + (footerText || showPageNumbers ? 16 : 0)

  let cursor: Cursor | null = null

  const newPage = (): Cursor => {
    const page = doc.addPage([pageWidth, pageHeight])
    if (headerText) {
      page.drawText(sanitizeWinAnsi(headerText), {
        x: margin,
        y: pageHeight - margin + 18,
        size: 8.5,
        font,
        color: rgb(0.45, 0.48, 0.56),
      })
      page.drawLine({
        start: { x: margin, y: pageHeight - margin + 12 },
        end: { x: pageWidth - margin, y: pageHeight - margin + 12 },
        thickness: 0.5,
        color: rgb(0.82, 0.84, 0.9),
      })
    }
    return { page, y: top }
  }

  const ensure = (needed: number): Cursor => {
    if (!cursor || cursor.y - needed < bottom) {
      cursor = newPage()
    }
    return cursor
  }

  const writeParagraph = (
    text: string,
    size: number,
    activeFont: PDFFont,
    opts: { indent?: number; color?: ReturnType<typeof rgb>; spacingAfter?: number; justifyWidth?: number } = {},
  ) => {
    const indent = opts.indent ?? 0
    const available = contentWidth - indent
    const words = text.split(/\s+/).filter(Boolean)
    if (!words.length) return

    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (activeFont.widthOfTextAtSize(candidate, size) <= available) {
        current = candidate
      } else {
        if (current) lines.push(current)
        if (activeFont.widthOfTextAtSize(word, size) > available) {
          // hard-break an over-long token (e.g. a URL)
          let chunk = ''
          for (const char of word) {
            if (activeFont.widthOfTextAtSize(chunk + char, size) > available) {
              lines.push(chunk)
              chunk = char
            } else {
              chunk += char
            }
          }
          current = chunk
        } else {
          current = word
        }
      }
    }
    if (current) lines.push(current)

    const lineGap = size * lineHeight
    for (const line of lines) {
      const c = ensure(lineGap)
      c.page.drawText(sanitizeWinAnsi(line), {
        x: margin + indent,
        y: c.y - size,
        size,
        font: activeFont,
        color: opts.color ?? rgb(0.12, 0.14, 0.2),
      })
      c.y -= lineGap
    }
    c_after(opts.spacingAfter ?? 0)
  }

  const c_after = (amount: number) => {
    if (cursor) cursor.y -= amount
  }

  for (const block of blocks) {
    const style = block.style ?? 'body'
    const text = block.text ?? ''

    if (style === 'table' && block.rows?.length) {
      const rows = block.rows.slice(0, 400)
      const cols = Math.max(...rows.map((row) => row.length))
      const colWidth = contentWidth / Math.max(1, cols)
      const cellSize = Math.min(9, Math.max(7, baseFontSize - 2.5))

      for (const [rowIndex, row] of rows.entries()) {
        const cellLines = row.map((cell) => wrapCell(sanitizeWinAnsi(cell ?? ''), monoFont, cellSize, colWidth - 8))
        const rowHeight = Math.max(...cellLines.map((lines) => lines.length)) * (cellSize * 1.3) + 8
        const c = ensure(rowHeight + 4)
        if (rowIndex === 0) {
          c.page.drawRectangle({
            x: margin,
            y: c.y - rowHeight,
            width: contentWidth,
            height: rowHeight,
            color: rgb(0.94, 0.95, 0.99),
          })
        }
        let x = margin + 4
        for (const lines of cellLines) {
          lines.forEach((line, lineIndex) => {
            c.page.drawText(line, {
              x,
              y: c.y - 10 - lineIndex * (cellSize * 1.3),
              size: cellSize,
              font: rowIndex === 0 ? boldFont : monoFont,
              color: rgb(0.15, 0.17, 0.24),
            })
          })
          x += colWidth
        }
        c.page.drawLine({
          start: { x: margin, y: c.y - rowHeight },
          end: { x: margin + contentWidth, y: c.y - rowHeight },
          thickness: 0.4,
          color: rgb(0.85, 0.87, 0.92),
        })
        c.y -= rowHeight + 6
      }
      c_after(8)
      continue
    }

    if (!text.trim()) {
      c_after(baseFontSize * 0.8)
      continue
    }

    switch (style) {
      case 'title':
        c_after(4)
        writeParagraph(text, baseFontSize + 14, boldFont, { spacingAfter: baseFontSize * 0.9 })
        break
      case 'h1':
        c_after(6)
        writeParagraph(text, baseFontSize + 8, boldFont, { spacingAfter: baseFontSize * 0.6 })
        break
      case 'h2':
        c_after(4)
        writeParagraph(text, baseFontSize + 4, boldFont, { spacingAfter: baseFontSize * 0.45 })
        break
      case 'h3':
        writeParagraph(text, baseFontSize + 1.5, boldFont, { spacingAfter: baseFontSize * 0.35 })
        break
      case 'bullet':
        writeParagraph(`•  ${text}`, baseFontSize, font, { indent: 12, spacingAfter: baseFontSize * 0.3 })
        break
      case 'numbered':
        writeParagraph(text, baseFontSize, font, { indent: 12, spacingAfter: baseFontSize * 0.3 })
        break
      case 'code':
        writeParagraph(text, baseFontSize - 1, monoFont, {
          indent: 8,
          spacingAfter: baseFontSize * 0.6,
          color: rgb(0.2, 0.24, 0.33),
        })
        break
      default:
        writeParagraph(text, baseFontSize, font, { spacingAfter: baseFontSize * 0.55 })
    }
  }

  const pages = doc.getPages()
  pages.forEach((page, index) => {
    if (footerText) {
      page.drawText(sanitizeWinAnsi(footerText), {
        x: margin,
        y: margin - 12,
        size: 8.5,
        font,
        color: rgb(0.5, 0.53, 0.6),
      })
    }
    if (showPageNumbers) {
      const label = `${index + 1} / ${pages.length}`
      const width = font.widthOfTextAtSize(label, 8.5)
      page.drawText(label, {
        x: pageWidth - margin - width,
        y: margin - 12,
        size: 8.5,
        font,
        color: rgb(0.5, 0.53, 0.6),
      })
    }
  })

  const bytes = await doc.save({ useObjectStreams: true })
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

function wrapCell(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return ['']
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word.length > 40 ? `${word.slice(0, 38)}…` : word
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 6)
}

/** Split plain text into readable blocks, promoting short lines to headings. */
export function textToBlocks(text: string): TextBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: TextBlock[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^[•·▪‣*-]\s+/.test(line)) {
      blocks.push({ style: 'bullet', text: line.replace(/^[•·▪‣*-]\s+/, '') })
    } else if (line.length < 90 && line.split(/\s+/).length <= 10 && /^[A-Z0-9“"(]/.test(line) && !/[.;]$/.test(line)) {
      blocks.push({ style: 'h3', text: line })
    } else {
      blocks.push({ style: 'body', text: line })
    }
  }
  return blocks
}
