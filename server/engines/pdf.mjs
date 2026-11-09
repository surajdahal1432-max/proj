import { readFile, writeFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

const PDF_MAGIC = Buffer.from('%PDF-')

export async function readPdfBytes(path) {
  const bytes = await readFile(path)
  if (bytes.length < 5 || !bytes.subarray(0, 5).equals(PDF_MAGIC)) {
    throw new Error(`"${path.split('/').pop()}" is not a PDF file`)
  }
  return bytes
}

export async function loadPdf(path) {
  const bytes = await readPdfBytes(path)
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
  } catch (error) {
    if (/encrypt/i.test(error.message)) {
      throw new Error('This PDF is password protected. Unlock it first, then run the tool again.')
    }
    throw new Error(`The PDF could not be parsed: ${error.message}`)
  }
}

/** Strip characters the standard 14 fonts cannot encode. */
export function winAnsi(text) {
  return String(text ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
}

function colorOf(input, fallback = { r: 0, g: 0, b: 0 }) {
  const value = input && typeof input === 'object' ? input : fallback
  const channel = (v, f) => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : f))
  return rgb(channel(value.r, fallback.r), channel(value.g, fallback.g), channel(value.b, fallback.b))
}

async function embedStandardFont(doc, name = 'Helvetica') {
  const fonts = {
    Helvetica: StandardFonts.Helvetica,
    'Helvetica-Bold': StandardFonts.HelveticaBold,
    'Helvetica-Oblique': StandardFonts.HelveticaOblique,
    'Times-Roman': StandardFonts.TimesRoman,
    'Times-Bold': StandardFonts.TimesRomanBold,
    'Courier': StandardFonts.Courier,
    Courier: StandardFonts.Courier,
  }
  return doc.embedFont(fonts[name] ?? StandardFonts.Helvetica)
}

export async function pageCount(path) {
  const doc = await loadPdf(path)
  return doc.getPageCount()
}

/* ------------------------------ organize ------------------------------ */

export async function merge(inputPaths, outputPath) {
  const merged = await PDFDocument.create()
  for (const path of inputPaths) {
    const source = await loadPdf(path)
    const pages = await merged.copyPages(source, source.getPageIndices())
    pages.forEach((page) => merged.addPage(page))
  }
  if (merged.getPageCount() === 0) throw new Error('No pages were found in the supplied files')
  await writeFile(outputPath, await merged.save())
  return { pages: merged.getPageCount() }
}

/** Extract an explicit list of 0-based page indexes into one document. */
export async function extractPages(inputPath, indexes, outputPath) {
  const source = await loadPdf(inputPath)
  const total = source.getPageCount()
  const unique = [...new Set(indexes.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < total))]
  if (!unique.length) throw new Error('No valid pages were selected')
  const target = await PDFDocument.create()
  const pages = await target.copyPages(source, unique)
  pages.forEach((page) => target.addPage(page))
  await writeFile(outputPath, await target.save())
  return { pages: target.getPageCount(), sourcePages: unique.map((i) => i + 1) }
}

/** Reorder / duplicate / delete pages, optionally rotating individual pages. */
export async function rearrange(inputPath, order, rotations = {}, outputPath) {
  const source = await loadPdf(inputPath)
  const total = source.getPageCount()
  const sequence = (Array.isArray(order) && order.length ? order : source.getPageIndices()).map(Number)
  const valid = sequence.filter((i) => Number.isInteger(i) && i >= 0 && i < total)
  if (!valid.length) throw new Error('The page order contains no valid pages')
  const target = await PDFDocument.create()
  const pages = await target.copyPages(source, valid)
  pages.forEach((page, index) => {
    const sourceIndex = valid[index]
    const angle = Number(rotations?.[sourceIndex] ?? rotations?.[String(sourceIndex)] ?? 0)
    if (Number.isFinite(angle) && angle % 90 === 0 && angle !== 0) {
      page.setRotation(degrees(((page.getRotation().angle + angle) % 360 + 360) % 360))
    }
    target.addPage(page)
  })
  await writeFile(outputPath, await target.save())
  return { pages: target.getPageCount() }
}

export async function rotate(inputPath, { angle = 90, perPage = {} } = {}, outputPath) {
  const source = await loadPdf(inputPath)
  const pages = source.getPages()
  pages.forEach((page, index) => {
    const override = perPage?.[index] ?? perPage?.[String(index)]
    const delta = Number(override ?? angle)
    if (!Number.isFinite(delta) || delta % 90 !== 0) return
    const next = ((page.getRotation().angle + delta) % 360 + 360) % 360
    page.setRotation(degrees(next))
  })
  await writeFile(outputPath, await source.save())
  return { pages: pages.length }
}

/** Split into groups of 0-based page indexes; one output document per group. */
export async function splitGroups(inputPath, groups, outputPathFor) {
  const source = await loadPdf(inputPath)
  const total = source.getPageCount()
  const results = []
  for (let index = 0; index < groups.length; index += 1) {
    const indexes = groups[index].filter((i) => i >= 0 && i < total)
    if (!indexes.length) continue
    const target = await PDFDocument.create()
    const pages = await target.copyPages(source, indexes)
    pages.forEach((page) => target.addPage(page))
    const outputPath = outputPathFor(index)
    await writeFile(outputPath, await target.save())
    results.push({ path: outputPath, pages: target.getPageCount(), sourcePages: indexes.map((i) => i + 1) })
  }
  if (!results.length) throw new Error('The page ranges did not match any pages in this document')
  return results
}

/* ------------------------------ overlays ------------------------------ */

async function embedImage(doc, bytes) {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8
  if (isPng) return { image: await doc.embedPng(bytes), kind: 'png' }
  if (isJpg) return { image: await doc.embedJpg(bytes), kind: 'jpg' }
  throw new Error('Only PNG and JPEG images can be stamped onto a page')
}

/**
 * Draw client-supplied vector ops onto pages.
 * Coordinates are PDF points with the origin at the bottom-left corner.
 */
export async function applyOverlays(inputPath, ops, outputPath) {
  const doc = await loadPdf(inputPath)
  const pages = doc.getPages()
  const fontCache = new Map()

  for (const op of Array.isArray(ops) ? ops : []) {
    const pageIndex = Number(op.page)
    const page = pages[pageIndex]
    if (!page) continue
    const items = Array.isArray(op.items) ? op.items : []
    for (const item of items) {
      const opacity = Number.isFinite(Number(item.opacity)) ? Math.min(1, Math.max(0, Number(item.opacity))) : 1
      if (item.type === 'text') {
        const name = item.font || 'Helvetica'
        if (!fontCache.has(name)) fontCache.set(name, await embedStandardFont(doc, name))
        const font = fontCache.get(name)
        const size = Math.max(2, Number(item.size) || 12)
        const text = winAnsi(item.text ?? '')
        if (!text) continue
        const lines = text.split('\n')
        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: Number(item.x) || 0,
            y: (Number(item.y) || 0) - lineIndex * size * 1.2,
            size,
            font,
            color: colorOf(item.color),
            opacity,
            rotate: degrees(Number(item.rotate) || 0),
          })
        })
      } else if (item.type === 'rect') {
        const width = Math.abs(Number(item.w) || 0)
        const height = Math.abs(Number(item.h) || 0)
        if (!width || !height) continue
        page.drawRectangle({
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          width,
          height,
          color: item.fill === false ? undefined : colorOf(item.color),
          borderColor: item.borderColor ? colorOf(item.borderColor) : undefined,
          borderWidth: item.borderWidth ? Number(item.borderWidth) : undefined,
          opacity,
          rotate: degrees(Number(item.rotate) || 0),
        })
      } else if (item.type === 'line') {
        page.drawLine({
          start: { x: Number(item.x1) || 0, y: Number(item.y1) || 0 },
          end: { x: Number(item.x2) || 0, y: Number(item.y2) || 0 },
          thickness: Math.max(0.25, Number(item.thickness) || 1),
          color: colorOf(item.color),
          opacity,
        })
      } else if (item.type === 'image' && item.dataBase64) {
        const bytes = Buffer.from(String(item.dataBase64), 'base64')
        if (!bytes.length) continue
        const { image } = await embedImage(doc, bytes)
        page.drawImage(image, {
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          width: Math.abs(Number(item.w) || image.width),
          height: Math.abs(Number(item.h) || image.height),
          opacity,
          rotate: degrees(Number(item.rotate) || 0),
        })
      }
    }
  }

  await writeFile(outputPath, await doc.save())
  return { pages: pages.length }
}

export async function watermark(inputPath, options, outputPath) {
  const doc = await loadPdf(inputPath)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const text = winAnsi(options.text || 'CONFIDENTIAL')
  const size = Math.max(6, Number(options.size) || 48)
  const opacity = Math.min(1, Math.max(0.02, Number(options.opacity) || 0.15))
  const diagonal = options.diagonal !== false
  const pages = doc.getPages()
  for (const page of pages) {
    const { width, height } = page.getSize()
    if (diagonal) {
      const textWidth = font.widthOfTextAtSize(text, size)
      page.drawText(text, {
        x: Math.max(12, (width - textWidth * 0.7) / 2),
        y: height / 2 - size / 2,
        size,
        font,
        color: colorOf(options.color, { r: 0.5, g: 0.5, b: 0.5 }),
        opacity,
        rotate: degrees(45),
      })
    } else {
      const textWidth = font.widthOfTextAtSize(text, size)
      const stepX = textWidth + 40
      const stepY = size + 60
      for (let y = 40; y < height; y += stepY) {
        for (let x = -20; x < width; x += stepX) {
          page.drawText(text, {
            x,
            y,
            size,
            font,
            color: colorOf(options.color, { r: 0.5, g: 0.5, b: 0.5 }),
            opacity,
            rotate: degrees(Number(options.rotate) || 0),
          })
        }
      }
    }
  }
  await writeFile(outputPath, await doc.save())
  return { pages: pages.length }
}

export async function imagesToPdf(imagePaths, { pageSize = 'fit', margin = 0 } = {}, outputPath) {
  const doc = await PDFDocument.create()
  for (const path of imagePaths) {
    const bytes = await readFile(path)
    const { image } = await embedImage(doc, bytes)
    const pad = Math.max(0, Number(margin) || 0)
    let width = image.width
    let height = image.height
    if (pageSize === 'a4') {
      width = 595.28
      height = 841.89
    } else if (pageSize === 'letter') {
      width = 612
      height = 792
    } else {
      width += pad * 2
      height += pad * 2
    }
    const page = doc.addPage([width, height])
    const available = { w: width - pad * 2, h: height - pad * 2 }
    const scale = Math.min(available.w / image.width, available.h / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    page.drawImage(image, {
      x: (width - drawWidth) / 2,
      y: (height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })
  }
  if (doc.getPageCount() === 0) throw new Error('No readable images were supplied')
  await writeFile(outputPath, await doc.save())
  return { pages: doc.getPageCount() }
}

/* ------------------------------ forms ------------------------------ */

export async function inspectForm(inputPath) {
  const doc = await loadPdf(inputPath)
  const form = doc.getForm()
  const fields = form.getFields().map((field) => {
    const type = field.constructor.name
    const entry = { name: field.getName(), type }
    if (type === 'PDFTextField') entry.value = field.getText() ?? ''
    if (type === 'PDFCheckBox') entry.value = field.isChecked()
    if (type === 'PDFDropdown' || type === 'PDFRadioGroup') entry.value = field.getSelected?.() ?? []
    return entry
  })
  return { fields, hasForm: fields.length > 0 }
}

export async function fillForm(inputPath, values, { flatten = false } = {}, outputPath) {
  const doc = await loadPdf(inputPath)
  const form = doc.getForm()
  const filled = []
  for (const [name, value] of Object.entries(values || {})) {
    try {
      const field = form.getField(name)
      const type = field.constructor.name
      if (type === 'PDFTextField') field.setText(String(value ?? ''))
      else if (type === 'PDFCheckBox') (value ? field.check() : field.uncheck())
      else if (type === 'PDFDropdown') field.select(String(value))
      else if (type === 'PDFRadioGroup') field.select(String(value))
      else if (type === 'PDFOptionList') field.select(String(value))
      filled.push(name)
    } catch {
      /* unknown or read-only field — reported below */
    }
  }
  if (flatten) form.flatten()
  await writeFile(outputPath, await doc.save())
  return { pages: doc.getPageCount(), filled, requested: Object.keys(values || {}).length }
}

/* ------------------------------ archival ------------------------------ */

export async function toPdfA(inputPath, outputPath) {
  const doc = await loadPdf(inputPath)
  const now = new Date().toISOString()
  doc.setProducer('Folio')
  doc.setCreator('Folio PDF/A export')
  doc.setCreationDate(new Date())
  doc.setModificationDate(new Date())
  const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>${now}</xmp:CreateDate><xmp:CreatorTool>Folio</xmp:CreatorTool>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
  doc.setLanguage?.('en-US')
  await writeFile(outputPath, await doc.save({ useObjectStreams: false }))
  return { pages: doc.getPageCount(), xmp }
}

export async function pdfInfo(path) {
  const doc = await loadPdf(path)
  const pages = doc.getPages().map((page, index) => {
    const { width, height } = page.getSize()
    return { index: index + 1, width: Math.round(width), height: Math.round(height), rotation: page.getRotation().angle }
  })
  return { pages: doc.getPageCount(), dimensions: pages }
}

export { PDFDocument, rgb, degrees, StandardFonts }
