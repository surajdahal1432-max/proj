/**
 * Namespace-aware WordprocessingML (OOXML) parser.
 *
 * This module replaces the previous regular-expression scraping of
 * `word/document.xml`. Regular expressions cannot distinguish `<w:t>` from
 * `<w:tab/>`, `<w:tbl>`, `<w:tc>` or `<w:tr>` (prefix collision), cannot honour
 * XML namespaces, and silently turn markup into document text. Everything here
 * walks a real DOM built by DOMParser instead.
 *
 * Guarantees:
 *  - Elements are matched by local name + namespace URI, never by prefix, so
 *    documents using `w2:`, `word:` or a default namespace parse identically.
 *  - Entities are decoded by the XML parser, not by hand.
 *  - Only text inside `w:t` (plus `w:tab`, `w:br`, `w:cr`, `w:sym`) becomes
 *    content; `w:pPr`, `w:rPr`, `w:ind`, `w:val`, `w:pos` … never leak.
 *  - Documents whose text was itself escaped OOXML (the corrupted-intermediate
 *    case) are detected and repaired by re-parsing the escaped payload.
 *  - Unparseable XML raises DocxParseError instead of producing a corrupt PDF.
 */

export interface RGB {
  r: number
  g: number
  b: number
}

export type DocxAlign = 'left' | 'center' | 'right' | 'justify'

export type DocxParagraphStyle =
  | 'title'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'body'
  | 'bullet'
  | 'numbered'

export interface DocxRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  superscript?: boolean
  subscript?: boolean
  fontFamily?: string
  /** Points (OOXML stores half-points). */
  fontSize?: number
  color?: RGB
  highlight?: RGB
  link?: string
}

export interface DocxParagraphBlock {
  type: 'paragraph'
  text: string
  runs: DocxRun[]
  style: DocxParagraphStyle
  align?: DocxAlign
  /** Points. */
  indentLeft?: number
  indentRight?: number
  /** Points; negative values produce a hanging indent. */
  firstLineIndent?: number
  /** Points. */
  spacingBefore?: number
  spacingAfter?: number
  /** Multiplier of the font size (1 = single). */
  lineHeight?: number
  listLevel?: number
  listMarker?: string
  fontSize?: number
  fontFamily?: string
  color?: RGB
}

export interface DocxTableBlock {
  type: 'table'
  rows: string[][]
  headerRow: boolean
}

export type DocxBlock = DocxParagraphBlock | DocxTableBlock

export interface DocxSection {
  /** Points. */
  pageWidth?: number
  pageHeight?: number
  orientation?: 'portrait' | 'landscape'
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
}

export interface DocxStats {
  paragraphs: number
  tables: number
  runs: number
  /** Paragraphs whose escaped OOXML payload had to be repaired. */
  repaired: number
}

export interface ParsedDocx {
  blocks: DocxBlock[]
  paragraphs: DocxParagraphBlock[]
  section: DocxSection
  stats: DocxStats
}

export interface DocxParseOptions {
  stylesXml?: string | null
  numberingXml?: string | null
  relsXml?: string | null
}

export class DocxParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocxParseError'
  }
}

const WRAPPER_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const TWIPS_PER_POINT = 20
const MARKUP_HINT = /<\/?[A-Za-z][\w.-]*:[A-Za-z][\w.-]*/

/* ------------------------------------------------------------------ *
 * DOM helpers — matched by local name + namespace, never by prefix
 * ------------------------------------------------------------------ */

function localNameOf(node: Node): string {
  const local = (node as Element).localName
  if (local) return local.toLowerCase()
  const name = node.nodeName || ''
  const colon = name.indexOf(':')
  return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase()
}

/** True for WordprocessingML elements (any prefix, strict or transitional). */
function isWordElement(node: Node | null | undefined, name?: string): node is Element {
  if (!node || node.nodeType !== 1) return false
  const el = node as Element
  if (name && localNameOf(el) !== name.toLowerCase()) return false
  const ns = el.namespaceURI
  if (!ns) return true // unqualified element in a malformed document
  return ns.toLowerCase().includes('wordprocessingml')
}

function childElements(el: Element): Element[] {
  return Array.from(el.children) as Element[]
}

function firstChild(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null
  const target = name.toLowerCase()
  for (const child of childElements(el)) {
    if (localNameOf(child) === target) return child
  }
  return null
}

function findDescendant(el: Element, name: string): Element | null {
  const target = name.toLowerCase()
  for (const child of childElements(el)) {
    if (localNameOf(child) === target) return child
    const found = findDescendant(child, name)
    if (found) return found
  }
  return null
}

function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null
  const target = name.toLowerCase()
  for (const attribute of Array.from(el.attributes)) {
    if (localNameOf(attribute as unknown as Node) === target) return attribute.value
  }
  return null
}

function isOff(value: string | null): boolean {
  return value === '0' || value === 'false' || value === 'off'
}

/* ------------------------------------------------------------------ *
 * Value conversions
 * ------------------------------------------------------------------ */

function twipsToPoints(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return undefined
  return parsed / TWIPS_PER_POINT
}

function halfPointsToPoints(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed / 2
}

function hexToRgb(value: string | null): RGB | undefined {
  if (!value) return undefined
  const hex = value.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return {
    r: Number.parseInt(hex.slice(0, 2), 16) / 255,
    g: Number.parseInt(hex.slice(2, 4), 16) / 255,
    b: Number.parseInt(hex.slice(4, 6), 16) / 255,
  }
}

const HIGHLIGHTS: Record<string, RGB> = {
  yellow: { r: 1, g: 0.96, b: 0.55 },
  green: { r: 0.65, g: 0.95, b: 0.6 },
  cyan: { r: 0.6, g: 0.95, b: 0.95 },
  magenta: { r: 0.98, g: 0.6, b: 0.95 },
  blue: { r: 0.6, g: 0.75, b: 1 },
  red: { r: 1, g: 0.6, b: 0.6 },
  darkBlue: { r: 0.35, g: 0.45, b: 0.8 },
  darkCyan: { r: 0.3, g: 0.6, b: 0.6 },
  darkGreen: { r: 0.3, g: 0.6, b: 0.35 },
  darkMagenta: { r: 0.6, g: 0.3, b: 0.6 },
  darkRed: { r: 0.75, g: 0.3, b: 0.3 },
  darkYellow: { r: 0.75, g: 0.65, b: 0.3 },
  darkGray: { r: 0.6, g: 0.6, b: 0.6 },
  lightGray: { r: 0.9, g: 0.9, b: 0.9 },
  black: { r: 0, g: 0, b: 0 },
  white: { r: 1, g: 1, b: 1 },
}

function alignFrom(value: string | null): DocxAlign | undefined {
  switch ((value ?? '').toLowerCase()) {
    case 'center':
      return 'center'
    case 'right':
    case 'end':
      return 'right'
    case 'both':
    case 'distribute':
    case 'thaiDistribute':
    case 'justify':
      return 'justify'
    case 'left':
    case 'start':
      return 'left'
    default:
      return undefined
  }
}

/* ------------------------------------------------------------------ *
 * XML parsing entry point
 * ------------------------------------------------------------------ */

function parseXml(source: string, what: string): Document {
  const text = source.replace(/^\uFEFF/, '')
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml')
  } catch (error) {
    throw new DocxParseError(
      `This .docx file contains malformed Word XML (${what} could not be parsed): ${
        error instanceof Error ? error.message : 'unknown XML error'
      }. Re-save the document from Word, Google Docs or LibreOffice and try again.`,
    )
  }
  const root = doc.documentElement
  const parserError = doc.getElementsByTagName('parsererror')[0] ?? doc.getElementsByTagNameNS('*', 'parsererror')[0]
  if (!root || parserError || localNameOf(root) === 'parsererror') {
    throw new DocxParseError(
      `This .docx file contains malformed Word XML (${what} is not well-formed). The document is probably truncated or was produced by a broken converter — re-save it from Word and try again.`,
    )
  }
  return doc
}

function tryParseXml(source: string | null | undefined): Document | null {
  if (!source) return null
  try {
    return parseXml(source, 'an OOXML part')
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * styles.xml / numbering.xml / relationships
 * ------------------------------------------------------------------ */

interface StyleInfo {
  name?: string
  basedOn?: string
  bold?: boolean
  italic?: boolean
  fontSize?: number
  color?: RGB
  align?: DocxAlign
  outlineLevel?: number
}

interface NumberingLevel {
  format: string
  start: number
}

interface ParseContext {
  styles: Map<string, StyleInfo>
  numbering: Map<string, NumberingLevel>
  rels: Map<string, string>
  counters: Map<string, number>
  stats: DocxStats
}

function parseStyles(xml: string | null | undefined): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>()
  const doc = tryParseXml(xml)
  if (!doc) return styles

  for (const el of Array.from(doc.getElementsByTagName('*')) as Element[]) {
    if (!isWordElement(el, 'style')) continue
    const id = attr(el, 'styleId')
    if (!id) continue
    const pPr = firstChild(el, 'pPr')
    const rPr = firstChild(el, 'rPr')
    const info: StyleInfo = {
      name: attr(firstChild(el, 'name'), 'val') ?? undefined,
      basedOn: attr(firstChild(el, 'basedOn'), 'val') ?? undefined,
      bold: (() => {
        const b = firstChild(rPr, 'b')
        return b && !isOff(attr(b, 'val')) ? true : undefined
      })(),
      italic: (() => {
        const i = firstChild(rPr, 'i')
        return i && !isOff(attr(i, 'val')) ? true : undefined
      })(),
      fontSize: halfPointsToPoints(attr(firstChild(rPr, 'sz'), 'val')),
      color: hexToRgb(attr(firstChild(rPr, 'color'), 'val')),
      align: alignFrom(attr(firstChild(pPr, 'jc'), 'val')),
      outlineLevel: (() => {
        const raw = attr(firstChild(pPr, 'outlineLvl'), 'val')
        if (raw == null) return undefined
        const parsed = Number.parseInt(raw, 10)
        return Number.isFinite(parsed) ? parsed : undefined
      })(),
    }
    styles.set(id, info)
  }
  return styles
}

function resolveStyle(styles: Map<string, StyleInfo>, id: string | undefined): StyleInfo | undefined {
  if (!id) return undefined
  const chain: StyleInfo[] = []
  let current = styles.get(id)
  let depth = 0
  while (current && depth < 6) {
    chain.unshift(current)
    current = current.basedOn ? styles.get(current.basedOn) : undefined
    depth++
  }
  if (!chain.length) return undefined
  return chain.reduce<StyleInfo>((acc, item) => ({ ...acc, ...stripUndefined(item) }), {})
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as Partial<T>
}

function parseNumbering(xml: string | null | undefined): Map<string, NumberingLevel> {
  const levels = new Map<string, NumberingLevel>()
  const doc = tryParseXml(xml)
  if (!doc) return levels

  const abstracts = new Map<string, Map<string, NumberingLevel>>()
  for (const el of Array.from(doc.getElementsByTagName('*')) as Element[]) {
    if (!isWordElement(el, 'abstractNum')) continue
    const abstractId = attr(el, 'abstractNumId')
    if (!abstractId) continue
    const byLevel = new Map<string, NumberingLevel>()
    for (const lvl of childElements(el)) {
      if (localNameOf(lvl) !== 'lvl') continue
      const ilvl = attr(lvl, 'ilvl') ?? '0'
      const start = Number.parseInt(attr(firstChild(lvl, 'start'), 'val') ?? '1', 10)
      byLevel.set(ilvl, {
        format: (attr(firstChild(lvl, 'numFmt'), 'val') ?? 'bullet').toLowerCase(),
        start: Number.isFinite(start) ? start : 1,
      })
    }
    abstracts.set(abstractId, byLevel)
  }

  for (const el of Array.from(doc.getElementsByTagName('*')) as Element[]) {
    if (!isWordElement(el, 'num')) continue
    const numId = attr(el, 'numId')
    if (!numId) continue
    const abstractId = attr(firstChild(el, 'abstractNumId'), 'val')
    const byLevel = abstractId ? abstracts.get(abstractId) : undefined
    if (!byLevel) continue
    for (const [ilvl, level] of byLevel) levels.set(`${numId}:${ilvl}`, level)
  }
  return levels
}

function parseRels(xml: string | null | undefined): Map<string, string> {
  const rels = new Map<string, string>()
  const doc = tryParseXml(xml)
  if (!doc) return rels
  for (const el of Array.from(doc.getElementsByTagName('*')) as Element[]) {
    if (localNameOf(el) !== 'relationship') continue
    const id = attr(el, 'Id')
    const target = attr(el, 'Target')
    if (id && target) rels.set(id, target)
  }
  return rels
}

/* ------------------------------------------------------------------ *
 * Run formatting (w:rPr)
 * ------------------------------------------------------------------ */

interface RunFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  superscript?: boolean
  subscript?: boolean
  fontFamily?: string
  fontSize?: number
  color?: RGB
  highlight?: RGB
  link?: string
}

function styleRunFormat(styles: Map<string, StyleInfo>, id: string | undefined): RunFormat {
  const info = resolveStyle(styles, id)
  if (!info) return {}
  return {
    bold: info.bold,
    italic: info.italic,
    fontSize: info.fontSize,
    color: info.color,
  }
}

function runFormatting(rPr: Element | null, ctx: ParseContext, inherited: RunFormat = {}): RunFormat {
  const format: RunFormat = { ...inherited }
  if (!rPr) return format

  const styleId = attr(firstChild(rPr, 'rStyle'), 'val')
  if (styleId) Object.assign(format, stripUndefined(styleRunFormat(ctx.styles, styleId)))

  const bold = firstChild(rPr, 'b')
  if (bold && !isOff(attr(bold, 'val'))) format.bold = true
  const italic = firstChild(rPr, 'i')
  if (italic && !isOff(attr(italic, 'val'))) format.italic = true
  const underline = firstChild(rPr, 'u')
  if (underline && (attr(underline, 'val') ?? 'single') !== 'none') format.underline = true
  const strike = firstChild(rPr, 'strike') ?? firstChild(rPr, 'dstrike')
  if (strike && !isOff(attr(strike, 'val'))) format.strike = true

  const fonts = firstChild(rPr, 'rFonts')
  if (fonts) {
    const family = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? attr(fonts, 'cs')
    if (family) format.fontFamily = family
  }

  const size = halfPointsToPoints(attr(firstChild(rPr, 'sz'), 'val') ?? attr(firstChild(rPr, 'szCs'), 'val'))
  if (size) format.fontSize = size

  const color = hexToRgb(attr(firstChild(rPr, 'color'), 'val'))
  if (color) format.color = color

  const highlight = (attr(firstChild(rPr, 'highlight'), 'val') ?? '').toLowerCase()
  if (highlight && HIGHLIGHTS[highlight]) format.highlight = HIGHLIGHTS[highlight]

  const vertical = (attr(firstChild(rPr, 'vertAlign'), 'val') ?? '').toLowerCase()
  if (vertical === 'superscript') format.superscript = true
  if (vertical === 'subscript') format.subscript = true

  return format
}

/* ------------------------------------------------------------------ *
 * Escaped-markup repair
 *
 * Some converters write the OOXML source *as text* inside <w:t> (the
 * "corrupted intermediate" document). Decoding the entities would surface
 * `<w:p>`, `<w:ind>`, `<w:val>` … in the PDF. We detect that payload and
 * recover the real document text by parsing it properly instead.
 * ------------------------------------------------------------------ */

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function codePoint(value: number): string {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : ''
  } catch {
    return ''
  }
}

function containsRawMarkup(text: string): boolean {
  return MARKUP_HINT.test(text) || /&lt;\/?[A-Za-z][\w.-]*:[A-Za-z]/.test(text)
}

function extractTextFromTree(el: Element, out: string[]): void {
  for (const child of childElements(el)) {
    const local = localNameOf(child)
    if (local === 't' || local === 'deltext') {
      out.push(child.textContent ?? '')
      continue
    }
    if (local === 'tab') {
      out.push('\t')
      continue
    }
    if (local === 'br' || local === 'cr') {
      out.push('\n')
      continue
    }
    if (local === 'instrtext' || local === 'fldchar') continue
    const isBlock = local === 'p' || local === 'tr'
    if (isBlock) out.push('\n')
    if (child.children.length) extractTextFromTree(child, out)
    else out.push(child.textContent ?? '')
    if (isBlock) out.push('\n')
  }
}

function extractTextFromHtml(node: Element, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out.push(child.nodeValue ?? '')
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as Element
    const local = localNameOf(el)
    if (local === 'script' || local === 'style') continue
    const isBlock = ['p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(local)
    if (isBlock) out.push('\n')
    if (el.children.length) extractTextFromHtml(el, out)
    else if (local === 't') out.push(el.textContent ?? '')
    else if (!isBlock) out.push(el.textContent ?? '')
    if (isBlock) out.push('\n')
  }
}

/** Last-resort tokeniser: drops `<…>` sequences so markup can never be shown. */
function stripMarkupTokens(value: string): string {
  const parts: string[] = []
  let depth = 0
  let buffer = ''
  for (const char of value) {
    if (char === '<') {
      if (buffer.trim()) parts.push(buffer)
      buffer = ''
      depth++
      continue
    }
    if (char === '>') {
      if (depth > 0) {
        depth--
        continue
      }
    }
    if (depth === 0) buffer += char
  }
  if (buffer.trim()) parts.push(buffer)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function normalizeExtracted(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n+$/g, '')
    .replace(/^\n+/g, '')
}

/** Recovers readable text from a payload that is escaped OOXML. */
function recoverTextFromMarkup(payload: string): string {
  // 1) Proper XML parse inside a namespace-correct wrapper.
  try {
    const doc = new DOMParser().parseFromString(
      `<w:root xmlns:w="${WRAPPER_NS}">${payload}</w:root>`,
      'application/xml',
    )
    const root = doc.documentElement
    const failed = !root || localNameOf(root) === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0
    if (!failed) {
      const out: string[] = []
      extractTextFromTree(root, out)
      const text = normalizeExtracted(out.join(''))
      if (text.trim()) return text
    }
  } catch {
    /* fall through to the forgiving parser */
  }

  // 2) Forgiving HTML parse — never throws, unknown elements keep their text.
  try {
    const doc = new DOMParser().parseFromString(`<div>${payload}</div>`, 'text/html')
    if (doc.body) {
      const out: string[] = []
      extractTextFromHtml(doc.body, out)
      const text = normalizeExtracted(out.join(''))
      if (text.trim()) return text
    }
  } catch {
    /* fall through to the tokeniser */
  }

  // 3) Tokeniser that guarantees no markup survives.
  return stripMarkupTokens(payload)
}

/* ------------------------------------------------------------------ *
 * Paragraphs, runs, tables
 * ------------------------------------------------------------------ */

function pushRun(runs: DocxRun[], text: string, format: RunFormat): void {
  if (!text) return
  const previous = runs[runs.length - 1]
  if (
    previous &&
    previous.bold === format.bold &&
    previous.italic === format.italic &&
    previous.underline === format.underline &&
    previous.strike === format.strike &&
    previous.superscript === format.superscript &&
    previous.subscript === format.subscript &&
    previous.fontFamily === format.fontFamily &&
    previous.fontSize === format.fontSize &&
    previous.color === format.color &&
    previous.highlight === format.highlight &&
    previous.link === format.link
  ) {
    previous.text += text
    return
  }
  runs.push({ ...stripUndefined(format), text })
}

const SKIP_RUN_CHILDREN = new Set([
  'rpr',
  'instrtext',
  'fldchar',
  'deltext',
  'drawing',
  'pict',
  'object',
  'footnotereference',
  'endnotereference',
  'commentreference',
  'annotationref',
  'lastrenderedpagerbreak',
])

function collectRuns(node: Element, runs: DocxRun[], base: RunFormat, ctx: ParseContext): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const value = child.nodeValue ?? ''
      if (value.trim()) pushRun(runs, value, base)
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as Element
    const local = localNameOf(el)

    if (local === 'p') continue // nested paragraph — handled by the caller
    if (local === 'ppr' || local === 'sectpr') continue
    if (local === 'alternatecontent') continue // avoid duplicated fallback text

    if (local === 'r') {
      const format = runFormatting(firstChild(el, 'rPr'), ctx, base)
      for (const item of childElements(el)) {
        const kind = localNameOf(item)
        if (kind === 'rpr' || SKIP_RUN_CHILDREN.has(kind)) continue
        if (kind === 't') {
          pushRun(runs, item.textContent ?? '', format)
        } else if (kind === 'tab') {
          pushRun(runs, '\t', format)
        } else if (kind === 'br' || kind === 'cr') {
          pushRun(runs, '\n', format)
        } else if (kind === 'nobreakhyphen') {
          pushRun(runs, '-', format)
        } else if (kind === 'softhyphen') {
          pushRun(runs, '', format)
        } else if (kind === 'sym') {
          const raw = attr(item, 'char')
          if (raw) {
            const parsed = Number.parseInt(raw.replace(/^0x/i, ''), 16)
            const char = codePoint(parsed)
            if (char) pushRun(runs, char, format)
          }
        } else if (item.children.length) {
          collectRuns(item, runs, format, ctx)
        }
      }
      continue
    }

    if (local === 'hyperlink') {
      const relId = attr(el, 'id')
      const link = relId ? ctx.rels.get(relId) : undefined
      collectRuns(el, runs, { ...base, link }, ctx)
      continue
    }

    if (['ins', 'smarttag', 'sdt', 'sdtcontent', 'customxml', 'bdo', 'dir', 'fldsimple', 'ruby'].includes(local)) {
      collectRuns(el, runs, base, ctx)
      continue
    }

    if (['bookmarkstart', 'bookmarkend', 'proofErr'.toLowerCase(), 'commentrangestart', 'commentrangeend', 'movefrom', 'moveto'].includes(local)) {
      if (local === 'movefrom') continue
      continue
    }

    if (isWordElement(el) && el.children.length) collectRuns(el, runs, base, ctx)
  }
}

function classifyStyle(
  styleId: string | undefined,
  styleName: string | undefined,
  outlineLevel: number | undefined,
): DocxParagraphStyle | null {
  const key = `${styleId ?? ''} ${styleName ?? ''}`.toLowerCase().replace(/[\s_-]+/g, '')
  if (key.trim()) {
    if (key.includes('title') || key.includes('titel')) return 'title'
    const heading = /(?:heading|titre|überschrift|uberschrift|kop|encabezado|zaglavlje|título|titulo)([1-6])/.exec(key)
    if (heading) return `heading${heading[1]}` as DocxParagraphStyle
    const short = /^h([1-6])$/.exec(key)
    if (short) return `heading${short[1]}` as DocxParagraphStyle
  }
  if (outlineLevel != null) {
    if (outlineLevel <= 0) return 'heading1'
    if (outlineLevel === 1) return 'heading2'
    if (outlineLevel === 2) return 'heading3'
  }
  return null
}

const BULLET_GLYPHS = ['•', '◦', '▪', '‣']

function listStyle(ctx: ParseContext, numId: string | undefined, level: number): DocxParagraphStyle {
  const info = numId ? ctx.numbering.get(`${numId}:${level}`) : undefined
  if (!info) return 'bullet'
  return info.format === 'bullet' || info.format === 'none' ? 'bullet' : 'numbered'
}

function listMarker(ctx: ParseContext, numId: string | undefined, level: number, style: DocxParagraphStyle): string {
  if (style === 'bullet') return BULLET_GLYPHS[Math.min(level, BULLET_GLYPHS.length - 1)]
  const key = `${numId ?? '0'}:${level}`
  const info = numId ? ctx.numbering.get(key) : undefined
  const next = (ctx.counters.get(key) ?? (info?.start ?? 1) - 1) + 1
  ctx.counters.set(key, next)
  return `${next}.`
}

function parseParagraph(paragraph: Element, ctx: ParseContext): DocxParagraphBlock {
  const pPr = firstChild(paragraph, 'pPr')
  const styleId = attr(firstChild(pPr, 'pStyle'), 'val') ?? undefined
  const styleInfo = resolveStyle(ctx.styles, styleId)

  const numPr = firstChild(pPr, 'numPr')
  const listLevelRaw = attr(firstChild(numPr, 'ilvl'), 'val')
  const listLevel = numPr ? Math.max(0, Number.parseInt(listLevelRaw ?? '0', 10) || 0) : undefined
  const numId = numPr ? attr(firstChild(numPr, 'numId'), 'val') ?? undefined : undefined

  const baseFormat = runFormatting(
    firstChild(pPr, 'rPr'),
    ctx,
    stripUndefined(styleRunFormat(ctx.styles, styleId)),
  )

  const runs: DocxRun[] = []
  collectRuns(paragraph, runs, baseFormat, ctx)

  const style =
    classifyStyle(styleId, styleInfo?.name, styleInfo?.outlineLevel) ??
    (numPr ? listStyle(ctx, numId, listLevel ?? 0) : 'body')

  const ind = firstChild(pPr, 'ind')
  const hanging = twipsToPoints(attr(ind, 'hanging'))
  const firstLine = twipsToPoints(attr(ind, 'firstLine'))

  const spacing = firstChild(pPr, 'spacing')
  const lineRaw = attr(spacing, 'line')
  const lineRule = (attr(spacing, 'lineRule') ?? 'auto').toLowerCase()
  let lineHeight: number | undefined
  if (lineRaw) {
    const parsed = Number.parseFloat(lineRaw)
    if (Number.isFinite(parsed) && parsed > 0) {
      lineHeight = lineRule === 'auto' ? parsed / 240 : parsed / TWIPS_PER_POINT / (baseFormat.fontSize ?? 11)
    }
  }

  let text = runs.map((run) => run.text).join('')
  if (containsRawMarkup(text)) {
    // Escaped OOXML payload: recover the real content instead of printing markup.
    const recovered = recoverTextFromMarkup(decodeXmlEntities(text))
    const recoveredRuns: DocxRun[] = recovered ? [{ ...stripUndefined(baseFormat), text: recovered }] : []
    runs.length = 0
    runs.push(...recoveredRuns)
    ctx.stats.repaired++
    text = recovered
  }

  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')

  for (const run of runs) {
    run.text = run.text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    if (run.text) ctx.stats.runs++
  }

  return {
    type: 'paragraph',
    text: cleaned,
    runs: runs.filter((run) => run.text.length > 0),
    style,
    align: alignFrom(attr(firstChild(pPr, 'jc'), 'val')) ?? styleInfo?.align,
    indentLeft: twipsToPoints(attr(ind, 'left') ?? attr(ind, 'start')),
    indentRight: twipsToPoints(attr(ind, 'right') ?? attr(ind, 'end')),
    firstLineIndent: firstLine ?? (hanging ? -hanging : undefined),
    spacingBefore: twipsToPoints(attr(spacing, 'before')),
    spacingAfter: twipsToPoints(attr(spacing, 'after')),
    lineHeight,
    listLevel,
    listMarker: numPr ? listMarker(ctx, numId, listLevel ?? 0, style) : undefined,
    fontSize: baseFormat.fontSize,
    fontFamily: baseFormat.fontFamily,
    color: baseFormat.color,
  }
}

function parseTable(table: Element, ctx: ParseContext): DocxTableBlock {
  const rows: string[][] = []
  let headerRow = false

  for (const row of childElements(table)) {
    if (localNameOf(row) !== 'tr') continue
    const trPr = firstChild(row, 'trPr')
    const header = firstChild(trPr, 'tblHeader')
    if (header && !isOff(attr(header, 'val'))) headerRow = true

    const cells: string[] = []
    for (const cell of childElements(row)) {
      if (localNameOf(cell) !== 'tc') continue
      const parts: string[] = []
      for (const node of childElements(cell)) {
        const local = localNameOf(node)
        if (local === 'p') {
          const block = parseParagraph(node, ctx)
          if (block.text.trim()) parts.push(block.text.trim())
        } else if (local === 'tbl') {
          const nested = parseTable(node, ctx)
          for (const nestedRow of nested.rows) {
            const line = nestedRow.filter(Boolean).join(' ')
            if (line.trim()) parts.push(line)
          }
        }
      }
      cells.push(parts.join('\n'))
    }
    if (cells.length) rows.push(cells)
  }

  if (!headerRow && rows.length > 1) {
    const first = rows[0]
    const rest = rows.slice(1)
    // A bold first row is a strong header signal in Word documents.
    headerRow = false
    void first
    void rest
  }

  return { type: 'table', rows, headerRow }
}

function applySection(sectPr: Element, section: DocxSection): void {
  const size = firstChild(sectPr, 'pgSz')
  const width = twipsToPoints(attr(size, 'w'))
  const height = twipsToPoints(attr(size, 'h'))
  if (width) section.pageWidth = width
  if (height) section.pageHeight = height
  const orient = (attr(size, 'orient') ?? '').toLowerCase()
  if (orient === 'landscape' || orient === 'portrait') section.orientation = orient

  const margin = firstChild(sectPr, 'pgMar')
  const top = twipsToPoints(attr(margin, 'top'))
  const right = twipsToPoints(attr(margin, 'right'))
  const bottom = twipsToPoints(attr(margin, 'bottom'))
  const left = twipsToPoints(attr(margin, 'left'))
  if (top !== undefined) section.marginTop = top
  if (right !== undefined) section.marginRight = right
  if (bottom !== undefined) section.marginBottom = bottom
  if (left !== undefined) section.marginLeft = left
}

function walkContainer(
  container: Element,
  ctx: ParseContext,
  out: { blocks: DocxBlock[]; section: DocxSection },
): void {
  for (const child of childElements(container)) {
    const local = localNameOf(child)
    if (!isWordElement(child)) continue

    if (local === 'p') {
      const block = parseParagraph(child, ctx)
      ctx.stats.paragraphs++
      if (block.text.trim() || block.runs.length) out.blocks.push(block)
      const sectPr = firstChild(firstChild(child, 'pPr'), 'sectPr')
      if (sectPr) applySection(sectPr, out.section)
      continue
    }

    if (local === 'tbl') {
      const table = parseTable(child, ctx)
      if (table.rows.length) {
        out.blocks.push(table)
        ctx.stats.tables++
      }
      continue
    }

    if (local === 'sectpr') {
      applySection(child, out.section)
      continue
    }

    if (local === 'sdt') {
      const content = findDescendant(child, 'sdtContent')
      if (content) walkContainer(content, ctx, out)
      continue
    }

    if (local === 'customxml' || local === 'ins' || local === 'moveTo'.toLowerCase()) {
      walkContainer(child, ctx, out)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Parses the contents of `word/document.xml`.
 *
 * @throws DocxParseError when the XML is not well-formed or contains no body.
 */
export function parseDocumentXml(xml: string, options: DocxParseOptions = {}): ParsedDocx {
  if (!xml || !xml.trim()) {
    throw new DocxParseError('word/document.xml is empty — this .docx file has no document body.')
  }

  const doc = parseXml(xml, 'word/document.xml')
  const root = doc.documentElement
  if (!root) throw new DocxParseError('word/document.xml has no root element.')

  const ctx: ParseContext = {
    styles: parseStyles(options.stylesXml),
    numbering: parseNumbering(options.numberingXml),
    rels: parseRels(options.relsXml),
    counters: new Map(),
    stats: { paragraphs: 0, tables: 0, runs: 0, repaired: 0 },
  }

  const body = isWordElement(root, 'body') ? root : findDescendant(root, 'body') ?? root
  const out: { blocks: DocxBlock[]; section: DocxSection } = { blocks: [], section: {} }
  walkContainer(body, ctx, out)

  const paragraphs = out.blocks.filter((block): block is DocxParagraphBlock => block.type === 'paragraph')

  if (!out.blocks.length) {
    throw new DocxParseError(
      'This Word document has no readable content — word/document.xml contains no paragraphs or tables.',
    )
  }

  return {
    blocks: out.blocks,
    paragraphs,
    section: out.section,
    stats: ctx.stats,
  }
}

/** True when a string still contains raw OOXML markup (used by tests/guards). */
export function hasRawMarkup(value: string): boolean {
  return MARKUP_HINT.test(value)
}
