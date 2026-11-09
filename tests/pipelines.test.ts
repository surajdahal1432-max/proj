/**
 * Real-file pipeline tests for Folio.
 *
 * These call the same library functions the tool components call, with files
 * produced by independent generators (pdf-lib, docx, pptxgenjs, JSZip,
 * ImageMagick), then reopen every output with an independent PDF reader
 * (pdfjs-dist legacy) to prove the download actually contains what was asked.
 *
 * Run: npx tsx --test tests/pipelines.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { makeFixtures } from './fixtures.mjs'

/* ---------------------------------------------------------------- *
 * DOM shims: the OOXML/HTML parsers use DOMParser (browser API)
 * ---------------------------------------------------------------- */
const dom = new JSDOM('<!doctype html><html><body></body></html>')
const g = globalThis as unknown as Record<string, unknown>
g.DOMParser = dom.window.DOMParser
g.XMLSerializer = dom.window.XMLSerializer
g.document = dom.window.document

const { dir, hasImages } = await makeFixtures()

const pdfLib = await import('../src/lib/pdf')
const convert = await import('../src/lib/convert')
const encrypt = await import('../src/lib/encrypt')
const signature = await import('../src/lib/signature')
const xlsx = await import('../src/lib/xlsx')
const ooxml = await import('../src/lib/ooxml')
const utils = await import('../src/lib/utils')
const { PDFDocument } = await import('pdf-lib')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const fixture = (name: string) => {
  const bytes = readFileSync(join(dir, name))
  return new File([bytes], name, { type: 'application/octet-stream' })
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

/* ---------------------------------------------------------------- *
 * Independent reader
 * ---------------------------------------------------------------- */
async function openPdf(blob: Blob | Uint8Array) {
  const data = blob instanceof Blob ? await bytesOf(blob) : blob
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
  }).promise
  return doc
}

async function pdfPages(blob: Blob | Uint8Array): Promise<string[]> {
  const doc = await openPdf(blob)
  const pages: string[] = []
  for (let index = 1; index <= doc.numPages; index++) {
    const page = await doc.getPage(index)
    const content = await page.getTextContent()
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    page.cleanup()
  }
  await doc.destroy()
  return pages
}

/** Font size of the first text item containing `needle`. */
async function fontSizeOf(blob: Blob, needle: string): Promise<number> {
  const doc = await openPdf(blob)
  try {
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if ('str' in item && item.str.includes(needle)) return item.height
      }
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return 0
}

/** Image placement matrices (a,b,c,d,e,f) from the page content stream. */
async function imageTransforms(blob: Blob): Promise<number[][]> {
  const doc = await openPdf(blob)
  try {
    const page = await doc.getPage(1)
    const ops = await page.getOperatorList()
    const found: number[][] = []
    ops.fnArray.forEach((fn, index) => {
      if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
        const args = ops.argsArray[index] as unknown[]
        const matrix = args.find((arg) => Array.isArray(arg) && arg.length === 6)
        if (Array.isArray(matrix)) found.push(matrix as number[])
      }
    })
    return found
  } finally {
    await doc.destroy()
  }
}

const near = (actual: number, expected: number, tolerance = 1.5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`)

/* ---------------------------------------------------------------- *
 * Organize: page order and selection
 * ---------------------------------------------------------------- */
test('merge keeps input order and every page', async () => {
  const merged = await pdfLib.mergePdfs([fixture('simple.pdf'), fixture('ten.pdf')])
  const pages = await pdfPages(merged)
  assert.equal(pages.length, 13)
  assert.match(pages[0], /ALPHA PAGE ONE/)
  assert.match(pages[2], /GAMMA PAGE THREE/)
  assert.match(pages[3], /Page 1 unique/)
  assert.match(pages[12], /Page 10 unique/)
})

test('extract exports exactly the selected pages in the selected order', async () => {
  const picked = await pdfLib.extractPagesToPdf(fixture('ten.pdf'), [0, 2, 4])
  const pages = await pdfPages(picked)
  assert.deepEqual(pages.map((text) => text.match(/Page (\d+)/)?.[1]), ['1', '3', '5'])

  const reversed = await pdfLib.extractPagesToPdf(fixture('ten.pdf'), [4, 0])
  const reversedPages = await pdfPages(reversed)
  assert.deepEqual(reversedPages.map((text) => text.match(/Page (\d+)/)?.[1]), ['5', '1'])
})

test('page-range text maps to the pages a user expects', async () => {
  assert.deepEqual(utils.parsePageRanges('1, 3, 5', 10), [0, 2, 4])
  assert.deepEqual(utils.parsePageRanges('1-3', 10), [0, 1, 2])
  assert.deepEqual(utils.parsePageRanges('8-99', 10), [7, 8, 9])
  assert.deepEqual(utils.formatPageRanges([0, 2, 4]), '1, 3, 5')
})

test('large documents keep page identity', async () => {
  const last = await pdfLib.extractPagesToPdf(fixture('large.pdf'), [119])
  const pages = await pdfPages(last)
  assert.equal(pages.length, 1)
  assert.match(pages[0], /Large document page 120/)
})

test('delete, reorder and rotate change only what they claim', async () => {
  const deleted = await pdfLib.deletePages(fixture('simple.pdf'), [1])
  const kept = await pdfPages(deleted)
  assert.deepEqual(kept.map((t) => t.split(' ')[0]), ['ALPHA', 'GAMMA'])

  const reordered = await pdfLib.reorderPages(fixture('simple.pdf'), [2, 0, 1])
  const order = await pdfPages(reordered)
  assert.deepEqual(order.map((t) => t.split(' ')[0]), ['GAMMA', 'ALPHA', 'BETA'])

  const rotated = await pdfLib.rotatePdf(fixture('simple.pdf'), { angle: 90 })
  const doc = await PDFDocument.load(await bytesOf(rotated))
  assert.deepEqual(doc.getPages().map((page) => page.getRotation().angle), [90, 90, 90])
  assert.equal((await pdfPages(rotated)).length, 3)
})

test('split produces one valid PDF per requested group', async () => {
  const groups = await pdfLib.splitPdfGroups(fixture('ten.pdf'), [[0, 1, 2], [9]], 'ten')
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map((group) => group.pages.length), [3, 1])
  const first = await pdfPages(groups[0].blob)
  assert.deepEqual(first.map((t) => t.match(/Page (\d+)/)?.[1]), ['1', '2', '3'])
  assert.match(groups[1].label, /p10/)
})

/* ---------------------------------------------------------------- *
 * Annotate
 * ---------------------------------------------------------------- */
test('watermark and page numbers are embedded in the PDF text layer', async () => {
  const watermarked = await pdfLib.watermarkPdf(fixture('simple.pdf'), {
    text: 'CONFIDENTIAL',
    fontSize: 40,
    opacity: 0.25,
    color: '#ff0000',
    rotation: 45,
    position: 'center',
  })
  const pages = await pdfPages(watermarked)
  assert.equal(pages.length, 3)
  assert.ok(pages.every((page) => /CONFIDENTIAL/.test(page)), 'watermark missing on a page')
  assert.match(pages[0], /ALPHA PAGE ONE/)

  const numbered = await pdfLib.addPageNumbers(fixture('simple.pdf'), {
    position: 'bottom-center',
    format: '{n} / {total}',
    fontSize: 10,
    color: '#000000',
    startAt: 1,
    margin: 24,
  })
  const numberedPages = await pdfPages(numbered)
  assert.match(numberedPages[0], /1 \/ 3/)
  assert.match(numberedPages[2], /3 \/ 3/)
})

test('images to PDF uses real page geometry', async () => {
  if (!hasImages) return
  const png = new Uint8Array(readFileSync(join(dir, 'stamp.png')))
  const jpg = new Uint8Array(readFileSync(join(dir, 'photo.jpg')))
  const pdf = await pdfLib.imagesToPdf(
    [
      { bytes: png, type: 'png' },
      { bytes: jpg, type: 'jpg' },
    ],
    { pageSize: 'a4', orientation: 'portrait', margin: 20, fitMode: 'contain' },
  )
  const doc = await PDFDocument.load(await bytesOf(pdf))
  assert.equal(doc.getPageCount(), 2)
  for (const page of doc.getPages()) {
    near(page.getWidth(), 595.28, 0.5)
    near(page.getHeight(), 841.89, 0.5)
  }
  assert.equal((await imageTransforms(pdf)).length, 1)
})

test('signature is embedded at the placement the user chose', async () => {
  if (!hasImages) return
  const pngBytes = new Uint8Array(readFileSync(join(dir, 'stamp.png')))
  const page = { width: 595.28, height: 841.89 }
  const placement = { page: 0, x: 0.25, y: 0.5, width: 0.3 }
  const signed = await signature.signPdfWithPlacement(fixture('simple.pdf'), placement, pngBytes, page, 1.5)

  const transforms = await imageTransforms(signed)
  assert.ok(transforms.length >= 1, 'signature image was not embedded')
  const [a, , , d, e, f] = transforms[transforms.length - 1]
  const expectedWidth = 0.3 * page.width
  const expectedHeight = expectedWidth / 1.5
  near(a, expectedWidth)
  near(d, expectedHeight)
  near(e, 0.25 * page.width)
  near(f, (1 - 0.5 - expectedHeight / page.height) * page.height, 2)

  // The rest of the document survives, and the signature is still there after a reload.
  const pages = await pdfPages(signed)
  assert.match(pages[0], /ALPHA PAGE ONE/)
  assert.equal(pages.length, 3)
  assert.equal((await imageTransforms(signed)).length, transforms.length)
})

/* ---------------------------------------------------------------- *
 * Convert into PDF
 * ---------------------------------------------------------------- */
test('DOCX to PDF never leaks OOXML markup and keeps structure', async () => {
  const result = await convert.docxToPdf(fixture('study.docx'))
  const pages = await pdfPages(result.blob)
  const text = pages.join('\n')

  assert.doesNotMatch(text, /<w:|<\/w:|w:t>|w:pPr|w:val|w:tab/)
  assert.doesNotMatch(text, /pPr|rPr|sectPr/)
  assert.match(text, /Guided Study: The Story of Rome/)
  assert.match(text, /Chapter One/)
  assert.match(text, /This sentence is bold/)
  assert.match(text, /Augustus/)
  assert.match(text, /Trajan/)
  assert.match(text, /SPQR/)
  assert.ok(pages.length >= 2, `expected a page break, got ${pages.length} page(s)`)

  const headingSize = await fontSizeOf(result.blob, 'Chapter One')
  const bodySize = await fontSizeOf(result.blob, 'SPQR')
  assert.ok(headingSize > bodySize, `heading ${headingSize} should be larger than body ${bodySize}`)
})

test('XLSX, PPTX, Markdown, HTML and text convert to readable PDFs', async () => {
  const rows = await xlsx.readXlsx(fixture('sheet.xlsx'))
  assert.deepEqual(rows[0], ['Region', 'Units'])
  assert.deepEqual(rows[1], ['North', 120])
  assert.match(xlsx.rowsToCsv(rows), /Total & notes,205/)

  const sheetPdf = await convert.xlsxToPdf(fixture('sheet.xlsx'))
  const sheetText = (await pdfPages(sheetPdf.blob)).join(' ')
  assert.match(sheetText, /North/)
  assert.match(sheetText, /120/)
  const sheetDoc = await PDFDocument.load(await bytesOf(sheetPdf.blob))
  assert.ok(sheetDoc.getPage(0).getWidth() > sheetDoc.getPage(0).getHeight(), 'spreadsheet should be landscape')

  const { slides } = await ooxml.readPptx(fixture('deck.pptx'))
  assert.ok(slides.length >= 2)
  const deckPdf = await convert.pptxToPdf(fixture('deck.pptx'))
  const deckText = (await pdfPages(deckPdf.blob)).join(' ')
  assert.match(deckText, /Folio Presentation/)
  assert.match(deckText, /Closing remarks/)

  const mdPdf = await convert.markdownToPdf(fixture('notes.md'))
  const mdText = (await pdfPages(mdPdf.blob)).join(' ')
  assert.match(mdText, /Folio Notes/)
  assert.match(mdText, /First bullet/)

  const htmlPdf = await convert.htmlToPdf(fixture('page.html'))
  const htmlText = (await pdfPages(htmlPdf.blob)).join(' ')
  assert.match(htmlText, /HTML to PDF/)
  assert.match(htmlText, /Item A/)
})

test('forms can be inspected, filled and flattened', async () => {
  const inspected = await pdfLib.inspectFormFields(fixture('form.pdf'))
  assert.equal(inspected.hasForm, true)
  const types = inspected.fields.map((field) => field.type).sort()
  assert.deepEqual(types, ['checkbox', 'dropdown', 'text'])

  const filled = await pdfLib.fillFormFields(
    fixture('form.pdf'),
    { 'applicant.name': 'Ada Lovelace', 'applicant.agree': true, 'applicant.plan': 'pro' },
    true,
  )
  const text = (await pdfPages(filled)).join(' ')
  assert.match(text, /Ada Lovelace/)
  assert.match(text, /Application form/)
  const after = await pdfLib.inspectFormFields(filled)
  assert.ok(!after.hasForm || after.fields.length === 0, 'flatten should remove interactive fields')
})

/* ---------------------------------------------------------------- *
 * Security
 * ---------------------------------------------------------------- */
test('encryption round-trips and rejects a wrong password', async () => {
  const encrypted = await encrypt.encryptPdf(fixture('simple.pdf'), { password: 'secret-pass', ownerPassword: 'owner-pass' })
  assert.equal(await encrypt.isEncrypted(encrypted), true)

  const encryptedBytes = await bytesOf(encrypted)
  await assert.rejects(() => PDFDocument.load(encryptedBytes))

  const decrypted = await encrypt.decryptPdf(encrypted, 'secret-pass')
  const pages = await pdfPages(decrypted.blob)
  assert.equal(pages.length, 3)
  assert.match(pages[0], /ALPHA PAGE ONE/)

  await assert.rejects(() => encrypt.decryptPdf(encrypted, 'wrong-password'))
})

test('corrupted PDFs fail loudly or repair into a readable file', async () => {
  await assert.rejects(() => PDFDocument.load(readFileSync(join(dir, 'corrupt.pdf'))))
  const repaired = (await pdfLib.repairPdf(fixture('corrupt.pdf'))) as unknown as {
    blob: Blob
    warnings?: string[]
    pagesRecovered?: number
  }
  const pages = await pdfPages(repaired.blob)
  assert.ok(pages.length >= 1, 'repair produced no pages')
  assert.ok(Array.isArray(repaired.warnings), 'repair should report warnings')
})

test('low-level compression preserves content', async () => {
  const original = fixture('simple.pdf')
  const outcome = await pdfLib.compressPdf(original, { level: 'low' })
  assert.equal((await pdfPages(outcome.blob)).length, 3)
  assert.ok(outcome.blob.size <= original.size * 1.05, 'structural compression grew the file')
})
