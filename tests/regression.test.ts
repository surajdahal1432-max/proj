/**
 * Folio regression suite.
 *
 * Covers the three confirmed user-facing bugs plus the shared PDF engine:
 *  - page selection/extraction order and validity
 *  - signature embedding into the exported PDF (not just an overlay)
 *  - DOCX parsing must never leak OOXML markup as document text
 *
 * Run with: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import JSZip from 'jszip'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'

// The DOCX parser uses the browser DOMParser; provide it before importing.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
const jsdomWindow = dom.window as unknown as Record<string, unknown>
for (const key of [
  'DOMParser',
  'XMLSerializer',
  'document',
  'window',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'DOMMatrix',
  'ImageData',
  'Path2D',
]) {
  if (jsdomWindow[key] !== undefined) {
    // Node 22 exposes some of these (notably `navigator`) as getter-only globals, so a plain
    // assignment throws. defineProperty works for both cases; if a property is non-configurable
    // we keep the runtime's own implementation rather than failing the whole suite.
    try {
      Object.defineProperty(globalThis, key, {
        value: jsdomWindow[key],
        configurable: true,
        writable: true,
      })
    } catch {
      /* keep the existing global */
    }
  }
}

const pdfLib = await import('../src/lib/pdf')
const ooxml = await import('../src/lib/ooxml')
const docxRender = await import('../src/lib/docxRender')
const docxParse = await import('../src/lib/docxParse')
const signature = await import('../src/lib/signature')
const utils = await import('../src/lib/utils')

/** 1x1 transparent PNG used as a signature stamp. */
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/**
 * Builds a PDF whose page widths encode their page number, so extraction
 * order can be verified from the output alone.
 */
async function makeFixturePdf(pageCount = 5): Promise<File> {
  const doc = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([400 + index * 20, 600])
    page.drawText(`PAGE ${index + 1}`, { x: 40, y: 500, size: 18 })
  }
  const bytes = await doc.save()
  return new File([bytes as BlobPart], 'fixture.pdf', { type: 'application/pdf' })
}

const widthsOf = (doc: PDFDocument) => doc.getPages().map((page) => Math.round(page.getWidth()))

/* ---------------------------------------------------------------- *
 * Page selection and extraction
 * ---------------------------------------------------------------- */

test('extract: only the selected pages survive, in the selected order', async () => {
  const source = await makeFixturePdf(5)
  const blob = await pdfLib.extractPagesToPdf(source, [0, 2, 4])
  const out = await PDFDocument.load(await blob.arrayBuffer())
  assert.equal(out.getPageCount(), 3, 'exactly three pages exported')
  assert.deepEqual(widthsOf(out), [400, 440, 480], 'pages 1, 3, 5 in order')
})

test('extract: non-consecutive and reversed selections keep their order', async () => {
  const source = await makeFixturePdf(5)
  const blob = await pdfLib.extractPagesToPdf(source, [4, 0])
  const out = await PDFDocument.load(await blob.arrayBuffer())
  assert.equal(out.getPageCount(), 2)
  assert.deepEqual(widthsOf(out), [480, 400], 'requested order preserved')
})

test('extract: single page selection yields exactly one page', async () => {
  const source = await makeFixturePdf(5)
  const blob = await pdfLib.extractPagesToPdf(source, [3])
  const out = await PDFDocument.load(await blob.arrayBuffer())
  assert.equal(out.getPageCount(), 1)
  assert.deepEqual(widthsOf(out), [460])
})

test('extract: out-of-range indices are dropped, empty selection fails loudly', async () => {
  const source = await makeFixturePdf(3)
  const blob = await pdfLib.extractPagesToPdf(source, [0, 99])
  assert.equal((await PDFDocument.load(await blob.arrayBuffer())).getPageCount(), 1)
  await assert.rejects(() => pdfLib.extractPagesToPdf(source, [99]), /at least one page/i)
})

test('extract: every page selected reproduces the whole document', async () => {
  const source = await makeFixturePdf(6)
  const blob = await pdfLib.extractPagesToPdf(source, [0, 1, 2, 3, 4, 5])
  const out = await PDFDocument.load(await blob.arrayBuffer())
  assert.deepEqual(widthsOf(out), [400, 420, 440, 460, 480, 500])
})

/* ---------------------------------------------------------------- *
 * Reorder / delete / merge
 * ---------------------------------------------------------------- */

test('reorder and delete rebuild the document correctly', async () => {
  const source = await makeFixturePdf(4)
  const reordered = await PDFDocument.load(await (await pdfLib.reorderPages(source, [3, 1, 0, 2])).arrayBuffer())
  assert.deepEqual(widthsOf(reordered), [460, 420, 400, 440])

  const trimmed = await PDFDocument.load(await (await pdfLib.deletePages(source, [1])).arrayBuffer())
  assert.deepEqual(widthsOf(trimmed), [400, 440, 460])
})

test('merge concatenates documents in queue order', async () => {
  const first = await makeFixturePdf(2)
  const second = await makeFixturePdf(3)
  const merged = await PDFDocument.load(await (await pdfLib.mergePdfs([first, second])).arrayBuffer())
  assert.equal(merged.getPageCount(), 5)
})

/* ---------------------------------------------------------------- *
 * Signature embedding
 * ---------------------------------------------------------------- */

test('signature: image is embedded in the exported PDF at the placed page', async () => {
  const source = await makeFixturePdf(3)
  const placement = { page: 1, x: 0.5, y: 0.6, width: 0.3 }
  const pageSize = { width: 420, height: 600 }
  const blob = await signature.signPdfWithPlacement(source, placement, PNG_1X1, pageSize, 1)

  const out = await PDFDocument.load(await blob.arrayBuffer())
  assert.equal(out.getPageCount(), 3, 'original pages preserved')

  const resources = out.getPage(1).node.Resources()
  const xobjects = resources?.lookup(PDFName.of('XObject'), PDFDict)
  assert.ok(xobjects && xobjects.keys().length > 0, 'signature image is a real page resource')

  const untouched = out.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
  assert.ok(!untouched || untouched.keys().length === 0, 'other pages are not stamped')
})

test('signature geometry stays on the page and keeps aspect ratio', () => {
  const height = signature.heightRatioFor({ page: 0, x: 0, y: 0, width: 0.3 }, 2, { width: 400, height: 800 })
  assert.equal(height, 0.075, 'aspect ratio honoured')

  const clamped = signature.clampPlacement({ page: 0, x: 0.95, y: 0.98, width: 0.3 }, 0.1)
  assert.ok(clamped.x <= 0.7 + 1e-9, 'x clamped inside the page')
  assert.ok(clamped.y <= 0.9 + 1e-9, 'y clamped inside the page')
})

test('signature: normalizes every placement into a valid rect', () => {
  const cases = [
    { page: 0, x: -1, y: -1, width: 0.3 },
    { page: 2, x: 2, y: 2, width: 0.3 },
    { page: 1, x: 0.5, y: 0.5, width: 5 },
  ]
  for (const placement of cases) {
    const width = Math.min(0.98, Math.max(0.04, placement.width))
    const height = Math.min(1, signature.heightRatioFor({ ...placement, width }, 3.4, { width: 595, height: 842 }))
    const safe = signature.clampPlacement({ ...placement, width }, height)
    assert.ok(safe.x >= 0 && safe.x + safe.width <= 1.0000001, `x range for ${JSON.stringify(placement)}`)
    assert.ok(safe.y >= 0 && safe.y + height <= 1.0000001, `y range for ${JSON.stringify(placement)}`)
  }
})

/* ---------------------------------------------------------------- *
 * DOCX parsing — the reported raw-XML leak
 * ---------------------------------------------------------------- */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Guided Study</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">The story of Rome </w:t></w:r>
      <w:r><w:tab/><w:t>Chapter 1</w:t></w:r>
      <w:r><w:br/><w:t>Second line</w:t></w:r>
    </w:p>
    <w:p>
      <w:hyperlink r:id="rId1"><w:r><w:t>Read more</w:t></w:r></w:hyperlink>
    </w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Empire</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Year</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Republic</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>509 BC</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="${W_NS}">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>`

const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`

async function makeDocx(documentXml = DOCUMENT_XML, options: { withStyles?: boolean } = {}): Promise<File> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  )
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/document.xml', documentXml)
  if (options.withStyles !== false) {
    zip.file('word/styles.xml', STYLES_XML)
    zip.file('word/numbering.xml', NUMBERING_XML)
    zip.file('word/_rels/document.xml.rels', RELS_XML)
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return new File([bytes as BlobPart], 'guided-study.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

const textOf = (parsed: { paragraphs: { text: string }[]; tables?: unknown[] }) =>
  parsed.paragraphs.map((paragraph) => paragraph.text).join('\n')

test('docx: real document parses to clean text with no OOXML markup', async () => {
  const parsed = await ooxml.parseDocxFile(await makeDocx())
  const text = textOf(parsed)

  assert.match(text, /Guided Study/, 'heading text preserved')
  assert.match(text, /The story of Rome/, 'body text preserved')
  assert.match(text, /Chapter 1/, 'text after a tab preserved')
  assert.match(text, /Second line/, 'text after a line break preserved')
  assert.match(text, /Read more/, 'hyperlink text preserved')

  for (const marker of ['<w:t', '</w:t>', '<w:tab', '<w:val', '<w:pPr', '<w:r>', '<w:ind', '<w:pos']) {
    assert.ok(!text.includes(marker), `leaked markup ${marker} in: ${JSON.stringify(text.slice(0, 200))}`)
  }
  assert.equal(docxRender.blocksContainMarkup(parsed.blocks), false, 'no block contains markup')
})

test('docx: document without styles/numbering parts still parses', async () => {
  const parsed = await ooxml.parseDocxFile(await makeDocx(DOCUMENT_XML, { withStyles: false }))
  assert.match(textOf(parsed), /Guided Study/)
  assert.equal(docxRender.blocksContainMarkup(parsed.blocks), false)
})

test('docx: renders a valid PDF and still contains no XML markup', async () => {
  const parsed = await ooxml.parseDocxFile(await makeDocx())
  const blob = await docxRender.renderDocxToPdf(parsed)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const out = await PDFDocument.load(bytes)

  assert.ok(out.getPageCount() >= 1, 'at least one page produced')
  const latin1 = Buffer.from(bytes).toString('latin1')
  for (const marker of ['<w:t', '<w:tab', '<w:val', '<w:pPr']) {
    assert.ok(!latin1.includes(marker), `markup ${marker} written into the PDF`)
  }
})

test('docx: malformed XML raises a conversion error instead of a broken PDF', async () => {
  const broken = `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>Broken`
  await assert.rejects(() => ooxml.parseDocxFile(makeDocx(broken)), (error: unknown) => {
    assert.ok(error instanceof Error, 'rejects with an Error')
    assert.ok(
      (error as { name?: string }).name === 'DocxParseError' || /convert|document|word/i.test(error.message),
      `meaningful error, got ${String(error)}`,
    )
    return true
  })
})

test('docx: hasRawMarkup distinguishes real text from leaked markup', () => {
  assert.equal(docxRender.blocksContainMarkup([]), false)
  assert.equal(docxParse.hasRawMarkup('<w:t>'), true)
  assert.equal(docxParse.hasRawMarkup('The story of Rome <w:tab> Chapter'), true)
  assert.equal(docxParse.hasRawMarkup('Normal prose with a < b and c > d'), false)
})

/* ---------------------------------------------------------------- *
 * Shared helpers
 * ---------------------------------------------------------------- */

test('page ranges: parses, clamps and deduplicates', () => {
  assert.deepEqual(utils.parsePageRanges('1-3, 5, 8-12', 12), [0, 1, 2, 4, 7, 8, 9, 10, 11])
  assert.deepEqual(utils.parsePageRanges('5', 5), [4])
  assert.deepEqual(utils.parsePageRanges('9', 5), [], 'out-of-range page ignored')
  assert.deepEqual(utils.parsePageRanges('3-1', 5), [0, 1, 2], 'reversed range normalised')
  assert.deepEqual(utils.parsePageRanges('1,1,1', 5), [0], 'duplicates removed')
  assert.deepEqual(utils.parsePageRanges('garbage', 5), [])
})

test('sanitizeWinAnsi keeps text encodable for standard PDF fonts', () => {
  const cleaned = pdfLib.sanitizeWinAnsi('Curly “quotes” and an em—dash ✓')
  assert.ok(!cleaned.includes('“') && !cleaned.includes('—'), 'unsupported glyphs replaced')
  assert.match(cleaned, /Curly/)
})
