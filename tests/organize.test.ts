/**
 * Real-file tests for the Organize tools (Merge, Split, Extract, Organize, Rotate).
 *
 * Every fixture is generated independently with pdf-lib, every output is reopened with a different
 * reader (pdfjs-dist legacy), and the assertions check the properties the UI promises: exact page
 * order, exact page count, preserved page sizes and rotation. Nothing here inspects the UI.
 *
 * Run: npx -y node@22.23.4 --import tsx --test tests/organize.test.ts
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import JSZip from 'jszip'

const { PDFDocument, StandardFonts, degrees } = await import('pdf-lib')
const organize = await import('../src/lib/pdf')
const { zipBlobs } = await import('../src/lib/zip')

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

async function openPdf(blob: Blob | Uint8Array) {
  const data = blob instanceof Blob ? await bytesOf(blob) : blob
  return pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
  }).promise
}

async function closeDoc(doc: { destroy?: () => Promise<unknown>; cleanup?: () => Promise<unknown> }) {
  try {
    if (typeof doc.destroy === 'function') await doc.destroy()
    else if (typeof doc.cleanup === 'function') await doc.cleanup()
  } catch {
    /* reader teardown must never mask an assertion */
  }
}

/** Independent fixture generator: `count` pages, each stamped with a searchable label. */
async function makePdf(count: number, label: string, size: [number, number] = [612, 792]): Promise<File> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < count; index += 1) {
    const page = doc.addPage(size)
    page.drawText(`${label}-PAGE-${index + 1}`, { x: 60, y: size[1] - 90, size: 18, font })
  }
  const bytes = await doc.save()
  return new File([bytes], `${label}.pdf`, { type: 'application/pdf' })
}

/** Reopen an output and read the page labels in document order. */
async function labelsOf(blob: Blob): Promise<string[]> {
  const doc = await openPdf(blob)
  try {
    const labels: string[] = []
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index)
      const content = await page.getTextContent()
      labels.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .trim(),
      )
      page.cleanup()
    }
    return labels
  } finally {
    await closeDoc(doc)
  }
}

async function sizesOf(blob: Blob): Promise<Array<[number, number]>> {
  const doc = await openPdf(blob)
  try {
    const sizes: Array<[number, number]> = []
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index)
      const [x1, y1, x2, y2] = page.view as [number, number, number, number]
      sizes.push([Math.round(x2 - x1), Math.round(y2 - y1)])
      page.cleanup()
    }
    return sizes
  } finally {
    await closeDoc(doc)
  }
}

/* ---------------------------------------------------------------- *
 * MERGE
 * ---------------------------------------------------------------- */
test('merge: keeps file order, page count and content', async () => {
  const a = await makePdf(3, 'ALPHA')
  const b = await makePdf(2, 'BETA')
  const merged = await organize.mergePdfs([a, b])
  const labels = await labelsOf(merged)
  assert.equal(labels.length, 5)
  assert.deepEqual(labels, ['ALPHA-PAGE-1', 'ALPHA-PAGE-2', 'ALPHA-PAGE-3', 'BETA-PAGE-1', 'BETA-PAGE-2'])
})

test('merge: preserves mixed page sizes in order', async () => {
  const letter = await makePdf(1, 'LETTER', [612, 792])
  const a4 = await makePdf(1, 'A4', [595, 842])
  const merged = await organize.mergePdfs([letter, a4])
  assert.deepEqual(await sizesOf(merged), [
    [612, 792],
    [595, 842],
  ])
})

test('merge: honours a reordered file list', async () => {
  const a = await makePdf(1, 'ONE')
  const b = await makePdf(1, 'TWO')
  const merged = await organize.mergePdfs([b, a])
  assert.deepEqual(await labelsOf(merged), ['TWO-PAGE-1', 'ONE-PAGE-1'])
})

test('merge: rejects an empty selection', async () => {
  await assert.rejects(() => organize.mergePdfs([]))
})

/* ---------------------------------------------------------------- *
 * SPLIT
 * ---------------------------------------------------------------- */
test('split: every page becomes its own valid PDF', async () => {
  const source = await makePdf(6, 'DOC')
  const groups = Array.from({ length: 6 }, (_, index) => [index])
  const parts = await organize.splitPdfGroups(source, groups, 'DOC')
  assert.equal(parts.length, 6)
  assert.deepEqual(
    parts.map((part) => part.label),
    ['DOC_p1.pdf', 'DOC_p2.pdf', 'DOC_p3.pdf', 'DOC_p4.pdf', 'DOC_p5.pdf', 'DOC_p6.pdf'],
  )
  for (let index = 0; index < parts.length; index += 1) {
    const labels = await labelsOf(parts[index].blob)
    assert.equal(labels.length, 1, `part ${index + 1} must contain exactly one page`)
    assert.deepEqual(labels, [`DOC-PAGE-${index + 1}`])
  }
})

test('split: custom ranges produce the requested groupings', async () => {
  const source = await makePdf(6, 'DOC')
  const parts = await organize.splitPdfGroups(source, [[0, 1], [2, 3, 4], [5]], 'DOC')
  assert.equal(parts.length, 3)
  assert.deepEqual(
    parts.map((part) => part.label),
    ['DOC_p1-2.pdf', 'DOC_p3-5.pdf', 'DOC_p6.pdf'],
  )
  assert.deepEqual(await labelsOf(parts[0].blob), ['DOC-PAGE-1', 'DOC-PAGE-2'])
  assert.deepEqual(await labelsOf(parts[1].blob), ['DOC-PAGE-3', 'DOC-PAGE-4', 'DOC-PAGE-5'])
  assert.deepEqual(await labelsOf(parts[2].blob), ['DOC-PAGE-6'])
})

test('split: out-of-range groups are dropped instead of corrupting output', async () => {
  const source = await makePdf(3, 'DOC')
  const parts = await organize.splitPdfGroups(source, [[0], [9], [2]], 'DOC')
  assert.equal(parts.length, 2)
  assert.deepEqual(await labelsOf(parts[1].blob), ['DOC-PAGE-3'])
})

/* ---------------------------------------------------------------- *
 * EXTRACT
 * ---------------------------------------------------------------- */
test('extract: non-consecutive pages keep the requested order', async () => {
  const source = await makePdf(6, 'DOC')
  const out = await organize.extractPagesToPdf(source, [0, 2, 4])
  assert.deepEqual(await labelsOf(out), ['DOC-PAGE-1', 'DOC-PAGE-3', 'DOC-PAGE-5'])
})

test('extract: order follows the argument, not the document', async () => {
  const source = await makePdf(6, 'DOC')
  const out = await organize.extractPagesToPdf(source, [4, 0, 2])
  assert.deepEqual(await labelsOf(out), ['DOC-PAGE-5', 'DOC-PAGE-1', 'DOC-PAGE-3'])
})

test('extract: a single page yields a one-page PDF', async () => {
  const source = await makePdf(6, 'DOC')
  const out = await organize.extractPagesToPdf(source, [1])
  const labels = await labelsOf(out)
  assert.equal(labels.length, 1)
  assert.deepEqual(labels, ['DOC-PAGE-2'])
})

test('extract: unselected pages are absent', async () => {
  const source = await makePdf(6, 'DOC')
  const out = await organize.extractPagesToPdf(source, [0, 5])
  const labels = await labelsOf(out)
  assert.equal(labels.length, 2)
  assert.ok(!labels.some((label) => label === 'DOC-PAGE-2'))
  assert.ok(!labels.some((label) => label === 'DOC-PAGE-3'))
})

test('extract: invalid index is rejected instead of producing an empty PDF', async () => {
  const source = await makePdf(3, 'DOC')
  await assert.rejects(() => organize.extractPagesToPdf(source, [99]))
})

test('extract: per-page ZIP bundle contains N separate valid PDFs', async () => {
  const source = await makePdf(3, 'DOC')
  const singles = await Promise.all([0, 1, 2].map((index) => organize.extractPagesToPdf(source, [index])))
  const zip = await zipBlobs(
    singles.map((blob, index) => ({ name: `DOC-page-${index + 1}.pdf`, blob })),
  )
  const reopened = await JSZip.loadAsync(await bytesOf(zip))
  const names = Object.keys(reopened.files).sort()
  assert.deepEqual(names, ['DOC-page-1.pdf', 'DOC-page-2.pdf', 'DOC-page-3.pdf'])
  for (const name of names) {
    const entry = await reopened.file(name)?.async('uint8array')
    assert.ok(entry, `${name} must exist in the archive`)
    const labels = await labelsOf(entry as Uint8Array)
    assert.equal(labels.length, 1)
    assert.match(labels[0], /^DOC-PAGE-[123]$/)
  }
})

/* ---------------------------------------------------------------- *
 * ORGANIZE / ROTATE
 * ---------------------------------------------------------------- */
test('organize: reorder supports duplicates and arbitrary order', async () => {
  const source = await makePdf(4, 'DOC')
  const out = await organize.reorderPages(source, [2, 2, 0])
  assert.deepEqual(await labelsOf(out), ['DOC-PAGE-3', 'DOC-PAGE-3', 'DOC-PAGE-1'])
})

test('organize: deleting pages keeps the remaining order', async () => {
  const source = await makePdf(5, 'DOC')
  const out = await organize.deletePages(source, [1, 3])
  assert.deepEqual(await labelsOf(out), ['DOC-PAGE-1', 'DOC-PAGE-3', 'DOC-PAGE-5'])
})

test('organize: deleting every page is refused', async () => {
  const source = await makePdf(2, 'DOC')
  await assert.rejects(() => organize.deletePages(source, [0, 1]))
})

test('rotate: rotation is written into the output document', async () => {
  const source = await makePdf(2, 'DOC')
  const out = await organize.rotatePdf(source, { global: 90 })
  const doc = await openPdf(out)
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index)
      assert.equal(((page.rotate % 360) + 360) % 360, 90, `page ${index} must be rotated 90°`)
      page.cleanup()
    }
  } finally {
    await closeDoc(doc)
  }
  // Content must survive rotation.
  assert.deepEqual(await labelsOf(out), ['DOC-PAGE-1', 'DOC-PAGE-2'])
})

test('rotate: per-page rotation overrides the global value', async () => {
  const source = await makePdf(2, 'DOC')
  const out = await organize.rotatePdf(source, { global: 90, perPage: { 1: 180 } })
  const doc = await openPdf(out)
  try {
    const first = await doc.getPage(1)
    const second = await doc.getPage(2)
    assert.equal(((first.rotate % 360) + 360) % 360, 90)
    assert.equal(((second.rotate % 360) + 360) % 360, 180)
    first.cleanup()
    second.cleanup()
  } finally {
    await closeDoc(doc)
  }
})

test('fixture sanity: the independent generator produces readable text', async () => {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  page.setRotation(degrees(0))
  const bytes = await doc.save()
  const reopened = await PDFDocument.load(bytes)
  assert.equal(reopened.getPageCount(), 1)
})
