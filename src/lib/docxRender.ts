import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import { sanitizeWinAnsi } from './pdf'
import type { DocxBlock, DocxParagraphBlock, DocxRun, DocxSection, ParsedDocx, RGB } from './docxParse'

/**
 * Renders parsed WordprocessingML blocks into a real PDF, preserving the
 * formatting that the parser extracted: page size/orientation, margins,
 * alignment, indents, spacing, font family, size, colour, bold, italic,
 * underline, strike, super/subscript, list markers and tables.
 *
 * Kept separate from `textPdf.ts` on purpose: that renderer serves the plain
 * text/markdown/HTML/XLSX converters and must not change behaviour.
 */

const A4: [number, number] = [595.28, 841.89]

type FontKey = 'helvetica' | 'times' | 'courier'

interface FontSet {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
  boldItalic: PDFFont
}

const FONT_CANDIDATES: Record<FontKey, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  helvetica: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
}

function fontKeyFor(family: string | undefined): FontKey {
  const value = (family ?? '').toLowerCase()
  if (/courier|consolas|mono|menlo/.test(value)) return 'courier'
  if (/times|georgia|garamond|cambria|serif|book/.test(value)) return 'times'
  return 'helvetica'
}

/** Accepts either 0-1 floats or 0-255 ints and normalises to pdf-lib's 0-1 scale. */
function toRgb(color: RGB | undefined, fallback: { r: number; g: number; b: number }) {
  if (!color) return rgb(fallback.r, fallback.g, fallback.b)
  const scale = (value: number) => (value > 1 ? value / 255 : value)
  return rgb(scale(color.r), scale(color.g), scale(color.b))
}

const HEADING_SIZE: Record<string, number> = { title: 22, heading1: 17, heading2: 14, heading3: 12.5 }

export interface DocxRenderOptions {
  title?: string
  /** Fallback body size in points when the document does not specify one. */
  baseFontSize?: number
  /** Overrides the document's own margins (points). */
  margin?: number
}

class DocxRenderer {
  private doc!: PDFDocument
  private fonts = new Map<FontKey, FontSet>()
  private page!: PDFPage
  private y = 0
  private pageWidth = A4[0]
  private pageHeight = A4[1]
  private marginTop = 56
  private marginRight = 56
  private marginBottom = 56
  private marginLeft = 56
  private section: DocxSection = {}
  private baseFontSize: number
  private title?: string

  constructor(options: DocxRenderOptions) {
    this.baseFontSize = options.baseFontSize ?? 11
    this.title = options.title
  }

  private get contentWidth(): number {
    return Math.max(72, this.pageWidth - this.marginLeft - this.marginRight)
  }

  async render(parsed: ParsedDocx): Promise<Blob> {
    this.doc = await PDFDocument.create()
    this.section = parsed.section ?? {}

    const width = this.section.pageWidth
    const height = this.section.pageHeight
    if (width && height && width > 100 && height > 100) {
      this.pageWidth = width
      this.pageHeight = height
    } else if (this.section.orientation === 'landscape') {
      this.pageWidth = A4[1]
      this.pageHeight = A4[0]
    }

    const m = this.section
    this.marginTop = m.marginTop ?? 56
    this.marginRight = m.marginRight ?? 56
    this.marginBottom = m.marginBottom ?? 56
    this.marginLeft = m.marginLeft ?? 56

    if (this.title) {
      this.doc.setTitle(this.title)
      this.doc.setProducer('Folio')
      this.doc.setCreator('Folio')
    }

    await this.loadFonts()
    this.newPage()

    for (const block of parsed.blocks) {
      if (block.type === 'table') {
        this.drawTable(block.rows, block.headerRow)
      } else {
        this.drawParagraph(block)
      }
    }

    return new Blob([await this.doc.save()], { type: 'application/pdf' })
  }

  private async loadFonts() {
    const keys: FontKey[] = ['helvetica', 'times', 'courier']
    for (const key of keys) {
      const [regular, bold, italic, boldItalic] = FONT_CANDIDATES[key]
      this.fonts.set(key, {
        regular: await this.doc.embedFont(regular),
        bold: await this.doc.embedFont(bold),
        italic: await this.doc.embedFont(italic),
        boldItalic: await this.doc.embedFont(boldItalic),
      })
    }
  }

  private newPage() {
    this.page = this.doc.addPage([this.pageWidth, this.pageHeight])
    this.y = this.pageHeight - this.marginTop
  }

  private ensureSpace(needed: number) {
    if (this.y - needed < this.marginBottom) this.newPage()
  }

  private fontFor(family: string | undefined, bold?: boolean, italic?: boolean): PDFFont {
    const set = this.fonts.get(fontKeyFor(family))!
    if (bold && italic) return set.boldItalic
    if (bold) return set.bold
    if (italic) return set.italic
    return set.regular
  }

  /** Splits text into lines that fit the available width. */
  private wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const clean = sanitizeWinAnsi(text).replace(/\t/g, '    ')
    if (!clean.trim()) return ['']
    const words = clean.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      // A single word longer than the line: hard-break it by characters.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = ''
        for (const char of word) {
          if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk) {
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
    if (current) lines.push(current)
    return lines.length ? lines : ['']
  }

  private drawParagraph(block: DocxParagraphBlock) {
    const style = block.style ?? 'body'
    const isHeading = style === 'title' || style === 'heading1' || style === 'heading2' || style === 'heading3'
    const baseSize = block.fontSize ?? HEADING_SIZE[style] ?? this.baseFontSize
    const align = block.align ?? (style === 'title' ? 'center' : 'left')
    const indentLeft = block.indentLeft ?? 0
    const firstLine = block.firstLineIndent ?? 0
    const marker = block.listMarker
    const markerIndent = style === 'bullet' || style === 'numbered' ? 14 + (block.listLevel ?? 0) * 14 : 0
    const leftPad = indentLeft + markerIndent

    const runs: DocxRun[] = block.runs?.length
      ? block.runs
      : [{ text: block.text, bold: isHeading, fontSize: baseSize, fontFamily: block.fontFamily, color: block.color }]

    const spacingBefore = block.spacingBefore ?? (isHeading ? 10 : 0)
    const spacingAfter = block.spacingAfter ?? (isHeading ? 6 : 4)
    const lineHeightMultiplier = block.lineHeight && block.lineHeight > 0.6 ? block.lineHeight : 1.35

    this.y -= spacingBefore

    // Lay the runs out into styled segments, then wrap across the full width.
    const segments = runs
      .filter((run) => run.text !== '')
      .map((run) => {
        const size = run.fontSize ?? baseSize
        return {
          text: run.text,
          size,
          font: this.fontFor(run.fontFamily ?? block.fontFamily, run.bold, run.italic),
          color: toRgb(run.color ?? block.color, { r: 0.09, g: 0.11, b: 0.16 }),
          underline: run.underline,
          strike: run.strike,
          superscript: run.superscript,
          subscript: run.subscript,
        }
      })

    if (!segments.length) {
      this.y -= baseSize * 0.6
      return
    }

    interface Piece {
      text: string
      size: number
      font: PDFFont
      color: ReturnType<typeof toRgb>
      underline?: boolean
      strike?: boolean
      superscript?: boolean
      subscript?: boolean
    }

    // Tokenise into words while remembering the originating run's styling.
    const words: Piece[] = []
    segments.forEach((segment, segmentIndex) => {
      const parts = sanitizeWinAnsi(segment.text).replace(/\t/g, '    ').split(/(\s+)/)
      for (const part of parts) {
        if (!part) continue
        if (/^\s+$/.test(part)) {
          if (words.length && !words[words.length - 1].text.endsWith(' ')) {
            words[words.length - 1] = { ...words[words.length - 1], text: `${words[words.length - 1].text} ` }
          }
          continue
        }
        words.push({ ...segment, text: part })
      }
      if (segmentIndex < segments.length - 1 && words.length) {
        const last = words[words.length - 1]
        if (!last.text.endsWith(' ')) words[words.length - 1] = { ...last, text: `${last.text} ` }
      }
    })

    const maxWidth = this.contentWidth - leftPad
    const lines: Piece[][] = []
    let line: Piece[] = []
    let lineWidth = 0

    for (const word of words) {
      const width = word.font.widthOfTextAtSize(word.text, word.size)
      const trailingSpace = word.text.endsWith(' ')
      if (line.length && lineWidth + width > maxWidth) {
        lines.push(line)
        line = [{ ...word, text: trailingSpace ? word.text.trimEnd() : word.text }]
        lineWidth = word.font.widthOfTextAtSize(line[0].text, word.size)
        continue
      }
      if (!line.length && width > maxWidth) {
        // Hard-break an over-long single word.
        const chunks = this.wrap(word.text.trim(), word.font, word.size, maxWidth)
        chunks.forEach((chunk, index) => {
          if (index === chunks.length - 1) {
            line = [{ ...word, text: chunk }]
            lineWidth = word.font.widthOfTextAtSize(chunk, word.size)
          } else {
            lines.push([{ ...word, text: chunk }])
          }
        })
        continue
      }
      line.push(word)
      lineWidth += width
    }
    if (line.length) lines.push(line)

    lines.forEach((pieces, index) => {
      const maxSize = Math.max(...pieces.map((piece) => piece.size))
      const lineHeight = maxSize * lineHeightMultiplier
      this.ensureSpace(lineHeight)

      const totalWidth = pieces.reduce((sum, piece) => sum + piece.font.widthOfTextAtSize(piece.text, piece.size), 0)
      const availableWidth = this.contentWidth - leftPad
      let x = this.marginLeft + leftPad
      if (align === 'center') x += Math.max(0, (availableWidth - totalWidth) / 2)
      else if (align === 'right') x += Math.max(0, availableWidth - totalWidth)

      if (index === 0 && marker) {
        const markerFont = this.fonts.get('helvetica')!.regular
        this.page.drawText(sanitizeWinAnsi(marker), {
          x: this.marginLeft + indentLeft + (block.listLevel ?? 0) * 14,
          y: this.y - maxSize * 0.92,
          size: maxSize,
          font: markerFont,
          color: rgb(0.25, 0.28, 0.35),
        })
      }

      let cursor = x
      for (const piece of pieces) {
        const offset = piece.superscript ? piece.size * 0.35 : piece.subscript ? -piece.size * 0.2 : 0
        const drawY = this.y - maxSize * 0.92 + offset
        const text = piece.text
        if (text.trim()) {
          this.page.drawText(text, {
            x: cursor,
            y: drawY,
            size: piece.size,
            font: piece.font,
            color: piece.color,
          })
          const width = piece.font.widthOfTextAtSize(text, piece.size)
          if (piece.underline) {
            this.page.drawLine({
              start: { x: cursor, y: drawY - piece.size * 0.14 },
              end: { x: cursor + width, y: drawY - piece.size * 0.14 },
              thickness: Math.max(0.5, piece.size * 0.055),
              color: piece.color,
            })
          }
          if (piece.strike) {
            this.page.drawLine({
              start: { x: cursor, y: drawY + piece.size * 0.3 },
              end: { x: cursor + width, y: drawY + piece.size * 0.3 },
              thickness: Math.max(0.5, piece.size * 0.055),
              color: piece.color,
            })
          }
          cursor += width
        }
      }

      this.y -= lineHeight
    })

    this.y -= spacingAfter
  }

  private drawTable(rows: string[][], headerRow: boolean) {
    const columnCount = Math.max(...rows.map((row) => row.length))
    if (!columnCount) return
    const gap = 6
    const cellWidth = (this.contentWidth - gap * (columnCount - 1)) / columnCount
    const fontSize = Math.min(this.baseFontSize, 10)
    const regular = this.fonts.get('helvetica')!.regular
    const bold = this.fonts.get('helvetica')!.bold
    const padding = 4

    this.y -= 4

    rows.forEach((row, rowIndex) => {
      const isHeader = headerRow && rowIndex === 0
      const font = isHeader ? bold : regular
      const cells = Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
      const wrapped = cells.map((cell) => this.wrap(cell, font, fontSize, cellWidth - padding * 2))
      const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length))
      const rowHeight = lineCount * fontSize * 1.3 + padding * 2

      this.ensureSpace(rowHeight)

      let x = this.marginLeft
      wrapped.forEach((lines) => {
        if (isHeader) {
          this.page.drawRectangle({
            x,
            y: this.y - rowHeight,
            width: cellWidth,
            height: rowHeight,
            color: rgb(0.94, 0.95, 0.97),
          })
        }
        this.page.drawRectangle({
          x,
          y: this.y - rowHeight,
          width: cellWidth,
          height: rowHeight,
          borderColor: rgb(0.78, 0.8, 0.85),
          borderWidth: 0.6,
        })
        lines.forEach((line, lineIndex) => {
          if (!line.trim()) return
          this.page.drawText(line, {
            x: x + padding,
            y: this.y - padding - fontSize * (lineIndex + 1) * 1.3 + fontSize * 0.3,
            size: fontSize,
            font,
            color: rgb(0.09, 0.11, 0.16),
          })
        })
        x += cellWidth + gap
      })

      this.y -= rowHeight
    })

    this.y -= 8
  }
}

export async function renderDocxToPdf(parsed: ParsedDocx, options: DocxRenderOptions = {}): Promise<Blob> {
  return new DocxRenderer(options).render(parsed)
}

/** Convenience helper used by tests: true when any block would print markup. */
export function blocksContainMarkup(blocks: DocxBlock[]): boolean {
  return blocks.some((block) =>
    block.type === 'table'
      ? block.rows.some((row) => row.some((cell) => /<\/?[A-Za-z][\w.-]*:/.test(cell)))
      : /<\/?[A-Za-z][\w.-]*:/.test(block.text),
  )
}
