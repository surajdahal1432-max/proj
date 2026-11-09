import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CONFIG, ENGINES } from '../config.mjs'
import { run, requireEngine } from './run.mjs'
import { merge as mergePdfs } from './pdf.mjs'

const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/* ------------------------------- qpdf ------------------------------- */

export async function protectPdf(input, options, output, ctx = {}) {
  const qpdf = requireEngine(ENGINES.qpdf, 'qpdf')
  const user = String(options.userPassword || '')
  const owner = String(options.ownerPassword || options.userPassword || randomUUID())
  if (!user && !owner) throw new Error('Provide a user or owner password to encrypt this PDF')
  const args = [
    '--encrypt',
    user,
    owner,
    '256',
    `--print=${options.allowPrint === false ? 'none' : 'full'}`,
    `--modify=${options.allowModify ? 'all' : 'none'}`,
    `--extract=${options.allowCopy ? 'y' : 'n'}`,
    '--annotate=' + (options.allowAnnotate ? 'y' : 'n'),
    '--',
    input,
    output,
  ]
  await run(qpdf, args, { signal: ctx.signal, engine: 'qpdf' })
  return { pages: await pageCount(output) }
}

export async function unlockPdf(input, options, output, ctx = {}) {
  const qpdf = requireEngine(ENGINES.qpdf, 'qpdf')
  const password = String(options.password || '')
  await run(qpdf, [`--password=${password}`, '--decrypt', '--', input, output], {
    signal: ctx.signal,
    engine: 'qpdf',
  })
  return { pages: await pageCount(output) }
}

export async function repairPdf(input, output, ctx = {}) {
  const qpdf = requireEngine(ENGINES.qpdf, 'qpdf')
  try {
    await run(qpdf, ['--', input, output], { signal: ctx.signal, engine: 'qpdf' })
  } catch (error) {
    if (error?.code === 'CANCELLED') throw error
    // Second attempt: rebuild as uncompressed QDF, which recovers more structures.
    await run(qpdf, ['--qdf', '--object-streams=disable', '--', input, output], {
      signal: ctx.signal,
      engine: 'qpdf',
    })
  }
  return { pages: await pageCount(output), recovered: true }
}

export async function compressPdf(input, output, options = {}, ctx = {}) {
  const qpdf = requireEngine(ENGINES.qpdf, 'qpdf')
  const before = (await stat(input)).size
  const args = ['--object-streams=generate', '--recompress-flate', '--compression-level=9']
  if (options.optimizeImages !== false) args.push('--optimize-images')
  args.push('--', input, output)
  try {
    await run(qpdf, args, { signal: ctx.signal, engine: 'qpdf' })
  } catch (error) {
    if (error?.code === 'CANCELLED') throw error
    await run(qpdf, ['--object-streams=generate', '--', input, output], {
      signal: ctx.signal,
      engine: 'qpdf',
    })
  }
  const after = (await stat(output)).size
  return { pages: await pageCount(output), before, after, method: 'qpdf-lossless' }
}

/* ------------------------------ poppler ------------------------------ */

export async function pageCount(input, ctx = {}) {
  const pdfinfo = ENGINES.pdfinfo
  if (pdfinfo) {
    const { stdout } = await run(pdfinfo, [input], { signal: ctx.signal, engine: 'pdfinfo', allowFailure: true })
    const match = /Pages:\s+(\d+)/.exec(stdout)
    if (match) return Number(match[1])
  }
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.load(await readFile(input), { updateMetadata: false })
  return doc.getPageCount()
}

export async function pdfToImages(input, { format = 'png', dpi = 150, outDir, base = 'page' }, ctx = {}) {
  const pdftoppm = requireEngine(ENGINES.pdftoppm, 'pdftoppm')
  await mkdir(outDir, { recursive: true })
  const prefix = join(outDir, base)
  const flag = format === 'jpeg' || format === 'jpg' ? '-jpeg' : '-png'
  const dpiValue = Math.min(400, Math.max(72, Number(dpi) || 150))
  await run(pdftoppm, [flag, '-r', String(dpiValue), input, prefix], { signal: ctx.signal, engine: 'pdftoppm' })
  const files = (await readdir(outDir))
    .filter((name) => name.startsWith(`${base}-`) && /\.(png|jpg|jpeg)$/i.test(name))
    .sort((a, b) => {
      const num = (value) => Number(/(\d+)\.[a-z]+$/i.exec(value)?.[1] ?? 0)
      return num(a) - num(b)
    })
    .map((name) => join(outDir, name))
  if (!files.length) throw new Error('The PDF produced no page images')
  return files
}

export async function pdfToText(input, ctx = {}) {
  const pdftotext = requireEngine(ENGINES.pdftotext, 'pdftotext')
  const { stdout } = await run(pdftotext, ['-layout', '-enc', 'UTF-8', input, '-'], {
    signal: ctx.signal,
    engine: 'pdftotext',
  })
  return stdout
}

/* ----------------------------- tesseract ----------------------------- */

export async function ocrPdf(input, { languages = 'eng', dpi = 200, outDir }, ctx = {}) {
  const tesseract = requireEngine(ENGINES.tesseract, 'tesseract')
  const pdftoppm = requireEngine(ENGINES.pdftoppm, 'pdftoppm')
  await mkdir(outDir, { recursive: true })
  const prefix = join(outDir, 'ocr')
  await run(pdftoppm, ['-r', String(Math.min(400, Math.max(120, Number(dpi) || 200))), '-png', input, prefix], {
    signal: ctx.signal,
    engine: 'pdftoppm',
  })
  const images = (await readdir(outDir))
    .filter((name) => /^ocr-\d+\.png$/.test(name))
    .sort((a, b) => Number(/(\d+)\.png$/.exec(a)[1]) - Number(/(\d+)\.png$/.exec(b)[1]))
    .map((name) => join(outDir, name))
  if (!images.length) throw new Error('The PDF has no pages to recognise')

  const pagePdfs = []
  const texts = []
  const langArg = String(languages || 'eng').split(/[+,]/).filter(Boolean).join('+') || 'eng'
  for (let index = 0; index < images.length; index += 1) {
    if (ctx.signal?.aborted) throw new Error('Cancelled')
    const image = images[index]
    const stem = image.replace(/\.png$/, '')
    await run(tesseract, [image, stem, '-l', langArg, 'pdf', 'txt'], { signal: ctx.signal, engine: 'tesseract' })
    const pdfPath = `${stem}.pdf`
    if (await exists(pdfPath)) pagePdfs.push(pdfPath)
    if (await exists(`${stem}.txt`)) texts.push((await readFile(`${stem}.txt`, 'utf8')).trim())
    ctx.onProgress?.(((index + 1) / images.length) * 80)
  }
  if (!pagePdfs.length) throw new Error('Text recognition produced no searchable pages')
  return { pagePdfs, text: texts.join('\n\n'), pages: images.length, languages: langArg }
}

export async function ocrText(input, { languages = 'eng', dpi = 200, outDir }, ctx = {}) {
  const result = await ocrPdf(input, { languages, dpi, outDir }, ctx)
  return { text: result.text, pages: result.pages }
}

/* ---------------------------- LibreOffice ---------------------------- */

function officeProfile(dir) {
  return `file://${join(dir, 'lo-profile')}`
}

export async function officeToPdf(input, { outDir, cwd }, ctx = {}) {
  const soffice = requireEngine(ENGINES.soffice, 'LibreOffice')
  await mkdir(outDir, { recursive: true })
  await run(
    soffice,
    [
      '--headless',
      '--norestore',
      '--nolockcheck',
      '--nodefault',
      '--invisible',
      `-env:UserInstallation=${officeProfile(cwd || outDir)}`,
      '--convert-to',
      'pdf:writer_pdf_Export',
      '--outdir',
      outDir,
      input,
    ],
    { signal: ctx.signal, engine: 'LibreOffice', timeoutMs: CONFIG.engineTimeoutMs },
  )
  const produced = (await readdir(outDir)).filter((name) => name.toLowerCase().endsWith('.pdf'))
  if (!produced.length) throw new Error('LibreOffice did not produce a PDF')
  return join(outDir, produced[0])
}

export async function htmlToPdf(input, { outDir, cwd }, ctx = {}) {
  const soffice = requireEngine(ENGINES.soffice, 'LibreOffice')
  await mkdir(outDir, { recursive: true })
  await run(
    soffice,
    [
      '--headless',
      '--norestore',
      '--nolockcheck',
      '--nodefault',
      '--invisible',
      `-env:UserInstallation=${officeProfile(cwd || outDir)}`,
      '--convert-to',
      'pdf:writer_web_pdf_Export',
      '--outdir',
      outDir,
      input,
    ],
    { signal: ctx.signal, engine: 'LibreOffice' },
  )
  const produced = (await readdir(outDir)).filter((name) => name.toLowerCase().endsWith('.pdf'))
  if (!produced.length) throw new Error('The HTML could not be rendered to PDF')
  return join(outDir, produced[0])
}

/** Merge per-page PDFs (OCR output) into one document. */
export async function mergePagePdfs(pagePdfs, output, ctx = {}) {
  await mergePdfs(pagePdfs, output, ctx)
  return { pages: await pageCount(output) }
}

export async function imageToPng(input, outDir, ctx = {}) {
  const magick = requireEngine(ENGINES.magick, 'ImageMagick')
  await mkdir(outDir, { recursive: true })
  const output = join(outDir, 'converted.png')
  await run(magick, [input, output], { signal: ctx.signal, engine: 'ImageMagick' })
  return output
}

export { exists, writeFile }

/**
 * Permanent redaction.
 *
 * Text and vector objects cannot be selectively erased from a PDF stream, so the
 * page is rasterised by Poppler and rebuilt from pixels. The original text layer,
 * fonts and annotations are therefore absent from the output — the content is
 * genuinely gone, not merely covered. Region coordinates are normalised (0..1)
 * with the origin at the top-left, matching the editor canvas.
 */
export async function redactPdf(input, regions, output, { dpi = 150, ctx = {}, workDir } = {}) {
  const { PDFDocument, rgb } = await import('pdf-lib')
  const dir = workDir || `${output}-work`
  const images = await pdfToImages(input, { format: 'png', dpi, outDir: dir, base: 'redact' }, ctx)
  const source = await PDFDocument.load(await readFile(input), { ignoreEncryption: true })
  const sizes = source.getPages().map((page) => page.getSize())
  const doc = await PDFDocument.create()
  const list = Array.isArray(regions) ? regions : []
  for (let index = 0; index < images.length; index += 1) {
    if (ctx.signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
    const size = sizes[index] || sizes[sizes.length - 1] || { width: 595.28, height: 841.89 }
    const page = doc.addPage([size.width, size.height])
    const png = await doc.embedPng(await readFile(images[index]))
    page.drawImage(png, { x: 0, y: 0, width: size.width, height: size.height })
    const pageRegions = list.filter((region) => (Number(region.page) || index + 1) === index + 1)
    for (const region of pageRegions) {
      const width = Math.min(1, Math.max(0, Number(region.width) || 0)) * size.width
      const height = Math.min(1, Math.max(0, Number(region.height) || 0)) * size.height
      const x = Math.min(1, Math.max(0, Number(region.x) || 0)) * size.width
      const top = Math.min(1, Math.max(0, Number(region.y) || 0)) * size.height
      if (width < 1 || height < 1) continue
      page.drawRectangle({ x, y: size.height - top - height, width, height, color: rgb(0, 0, 0) })
    }
    ctx.onProgress?.(((index + 1) / images.length) * 95, 'Redacting pages')
  }
  await writeFile(output, await doc.save())
  return { pages: images.length, regions: list.length, textLayerRemoved: true, method: 'rasterise-and-cover' }
}
