import { readFile, writeFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import * as pdfEngine from './engines/pdf.mjs'
import * as native from './engines/native.mjs'
import * as convert from './engines/convert.mjs'
import { CONFIG } from './config.mjs'

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
}

export const OUTPUT_MIME = MIME

function safeBase(name, fallback = 'document') {
  const stem = basename(String(name || fallback)).replace(/\.[^.]+$/, '')
  return (stem.replace(/[^\w\-. ]+/g, '_').trim().slice(0, 60) || fallback)
}

function out(dir, name, ext, extra = {}) {
  return { path: join(dir, `${name}.${ext}`), name: `${name}.${ext}`, mime: MIME[ext] || 'application/octet-stream', ...extra }
}

async function zipOutputs(outputs, dir, name) {
  const zip = new JSZip()
  for (const item of outputs) zip.file(item.name, await readFile(item.path))
  const path = join(dir, `${name}.zip`)
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return [{ path, name: `${name}.zip`, mime: MIME.zip }]
}

function requireFiles(files, min = 1, message = 'Upload at least one file') {
  if (!Array.isArray(files) || files.length < min) throw new Error(message)
}

function parsePages(input, pageCount) {
  const result = []
  const seen = new Set()
  const add = (page) => {
    if (page >= 1 && page <= pageCount && !seen.has(page - 1)) {
      seen.add(page - 1)
      result.push(page - 1)
    }
  }
  const normalized = String(input ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
  for (const token of normalized.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(token)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      const [from, to] = a <= b ? [a, b] : [b, a]
      for (let page = Math.max(1, from); page <= Math.min(pageCount, to); page += 1) add(page)
      continue
    }
    const openEnded = /^(\d+)-$/.exec(token)
    if (openEnded) {
      for (let page = Math.max(1, Number(openEnded[1])); page <= pageCount; page += 1) add(page)
      continue
    }
    const single = /^\d+$/.exec(token)
    if (single) add(Number(single[0]))
  }
  return result
}

/* ------------------------------ AI helpers ------------------------------ */

function sentencesOf(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40)
}

function termFrequencies(text) {
  const stop = new Set(
    'the a an and or but if then than that this these those of to in on for with without from by as at is are was were be been being it its into their his her our your you we they he she not no can could would should may might will shall do does did have has had also more most such other some any all each which who whom what when where why how'.split(
      ' ',
    ),
  )
  const counts = new Map()
  for (const word of String(text || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) {
    if (stop.has(word)) continue
    counts.set(word, (counts.get(word) || 0) + 1)
  }
  return counts
}

function scoreSentences(text, limit) {
  const sentences = sentencesOf(text)
  if (!sentences.length) return []
  const frequencies = termFrequencies(text)
  const max = Math.max(1, ...frequencies.values())
  const scored = sentences.map((sentence, index) => {
    const words = (sentence.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => frequencies.has(w))
    const density = words.reduce((sum, word) => sum + (frequencies.get(word) || 0) / max, 0)
    const score = density / Math.sqrt(words.length || 1) + (index < 3 ? 0.35 : 0)
    return { sentence, index, score }
  })
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence)
}

/* ------------------------------- handlers ------------------------------- */

const handlers = {}

/* ---- organize ---- */

handlers.merge = async ({ files, dir, ctx }) => {
  requireFiles(files, 2, 'Select at least two PDFs to merge')
  const target = out(dir, 'merged', 'pdf')
  const result = await pdfEngine.merge(files.map((file) => file.path), target.path, ctx)
  return { outputs: [target], meta: result }
}

handlers.split = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const input = files[0].path
  const pages = await native.pageCount(input, ctx)
  const mode = options.mode || 'ranges'
  const base = safeBase(files[0].name)
  const ranges = []

  if (mode === 'each') {
    for (let page = 1; page <= pages; page += 1) ranges.push([page - 1])
  } else if (mode === 'interval') {
    const size = Math.max(1, Number(options.interval) || 1)
    for (let start = 0; start < pages; start += size) {
      ranges.push(Array.from({ length: Math.min(size, pages - start) }, (_, index) => start + index))
    }
  } else {
    const selected = parsePages(options.ranges, pages)
    if (!selected.length) throw new Error('That page range does not match any page in this document')
    for (const index of selected) ranges.push([index])
  }

  const outputs = []
  for (let index = 0; index < ranges.length; index += 1) {
    const label = ranges[index].length === 1 ? `page-${ranges[index][0] + 1}` : `part-${index + 1}`
    const target = out(dir, `${base}-${label}`, 'pdf')
    await pdfEngine.extractPages(input, ranges[index], target.path)
    outputs.push(target)
    ctx.onProgress?.(((index + 1) / ranges.length) * 90)
  }
  if (outputs.length === 1) return { outputs, meta: { parts: 1, pages } }
  return { outputs: await zipOutputs(outputs, dir, `${base}-split`), meta: { parts: outputs.length, pages } }
}

handlers.extract = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const input = files[0].path
  const pages = await native.pageCount(input, ctx)
  const requested = Array.isArray(options.pages) ? options.pages.map(Number).filter((n) => n >= 1 && n <= pages) : parsePages(options.ranges, pages).map((n) => n + 1)
  if (!requested.length) throw new Error('Select at least one page to extract')
  const ordered = requested.map((page) => page - 1)
  const base = safeBase(files[0].name)
  const combined = out(dir, `${base}-extracted`, 'pdf')
  await pdfEngine.extractPages(input, ordered, combined.path)

  if (options.individual === false) return { outputs: [combined], meta: { pages: ordered.length } }

  const singles = []
  for (let index = 0; index < ordered.length; index += 1) {
    const target = out(dir, `${base}-page-${ordered[index] + 1}`, 'pdf')
    await pdfEngine.extractPages(input, [ordered[index]], target.path)
    singles.push(target)
    ctx.onProgress?.(((index + 1) / ordered.length) * 80)
  }
  return { outputs: [combined, ...singles], meta: { pages: ordered.length, files: singles.length } }
}

handlers.rearrange = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const input = files[0].path
  const pages = await native.pageCount(input, ctx)
  const order = Array.isArray(options.order) && options.order.length ? options.order.map(Number).filter((n) => n >= 1 && n <= pages) : Array.from({ length: pages }, (_, i) => i + 1)
  const deleted = new Set((options.deleted || []).map(Number))
  const kept = order.filter((page) => !deleted.has(page))
  if (!kept.length) throw new Error('Every page was deleted — keep at least one page')
  const target = out(dir, `${safeBase(files[0].name)}-organized`, 'pdf')
  const rotations = {}
  for (const [key, value] of Object.entries(options.rotations || {})) {
    const index = Number(key) - 1
    if (Number.isFinite(index) && index >= 0) rotations[index] = Number(value)
  }
  await pdfEngine.rearrange(input, kept.map((page) => page - 1), rotations, target.path)
  return { outputs: [target], meta: { pages: kept.length } }
}

handlers.rotate = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const input = files[0].path
  const pages = await native.pageCount(input, ctx)
  const target = out(dir, `${safeBase(files[0].name)}-rotated`, 'pdf')
  const perPage = {}
  for (const [key, value] of Object.entries(options.rotations || {})) {
    const index = Number(key) - 1
    if (Number.isFinite(index) && index >= 0) perPage[index] = Number(value)
  }
  await pdfEngine.rotate(input, { angle: Number(options.angle || 90), perPage }, target.path)
  return { outputs: [target], meta: { pages, angle: options.angle || 'per-page' } }
}

/* ---- optimize ---- */

handlers.compress = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-compressed`, 'pdf')
  const result = await native.compressPdf(files[0].path, target.path, { optimizeImages: options.level !== 'low' }, ctx)
  return { outputs: [target], meta: result }
}

handlers.repair = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-repaired`, 'pdf')
  const result = await native.repairPdf(files[0].path, target.path, ctx)
  return { outputs: [target], meta: result }
}

handlers.ocr = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const languages = options.languages || 'eng'
  const result = await native.ocrPdf(files[0].path, { languages, dpi: options.dpi, outDir: join(dir, 'ocr') }, ctx)
  const base = safeBase(files[0].name)
  const pdfOut = out(dir, `${base}-searchable`, 'pdf')
  await native.mergePagePdfs(result.pagePdfs, pdfOut.path, ctx)
  const textOut = out(dir, `${base}-ocr`, 'txt')
  await writeFile(textOut.path, result.text, 'utf8')
  return { outputs: [pdfOut, textOut], meta: { pages: result.pages, languages: result.languages } }
}

/* ---- conversions ---- */

handlers['pdf-to-word'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, safeBase(files[0].name), 'docx')
  const result = await convert.pdfToDocx(files[0].path, target.path, { title: safeBase(files[0].name) }, ctx)
  return { outputs: [target], meta: result }
}

handlers['pdf-to-excel'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, safeBase(files[0].name), 'xlsx')
  const result = await convert.pdfToXlsx(files[0].path, target.path, ctx)
  return { outputs: [target], meta: result }
}

handlers['pdf-to-powerpoint'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, safeBase(files[0].name), 'pptx')
  const result = await convert.pdfToPptx(files[0].path, target.path, { title: safeBase(files[0].name) }, ctx)
  return { outputs: [target], meta: result }
}

handlers['pdf-to-jpg'] = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const base = safeBase(files[0].name)
  const images = await native.pdfToImages(files[0].path, { format: 'jpeg', dpi: options.dpi, outDir: join(dir, 'img'), base }, ctx)
  const outputs = images.map((path, index) => ({
    path,
    name: `${base}-page-${index + 1}.jpg`,
    mime: MIME.jpg,
  }))
  return { outputs: outputs.length === 1 ? outputs : await zipOutputs(outputs, dir, `${base}-jpg`), meta: { pages: images.length } }
}

handlers['pdf-to-png'] = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const base = safeBase(files[0].name)
  const images = await native.pdfToImages(files[0].path, { format: 'png', dpi: options.dpi, outDir: join(dir, 'img'), base }, ctx)
  const outputs = images.map((path, index) => ({ path, name: `${base}-page-${index + 1}.png`, mime: MIME.png }))
  return { outputs: outputs.length === 1 ? outputs : await zipOutputs(outputs, dir, `${base}-png`), meta: { pages: images.length } }
}

handlers['pdf-to-markdown'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, safeBase(files[0].name), 'md')
  const result = await convert.pdfToMarkdown(files[0].path, target.path, ctx)
  return { outputs: [target], meta: result }
}

handlers['pdf-to-text'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, safeBase(files[0].name), 'txt')
  const result = await convert.pdfToTxt(files[0].path, target.path, ctx)
  return { outputs: [target], meta: result }
}

handlers['pdf-to-pdfa'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-archive`, 'pdf')
  const result = await pdfEngine.toPdfA(files[0].path, target.path)
  return { outputs: [target], meta: result }
}

const officeHandler = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const pdfPath = await native.officeToPdf(files[0].path, { outDir: join(dir, 'office'), cwd: dir }, ctx)
  const target = out(dir, safeBase(files[0].name), 'pdf')
  await writeFile(target.path, await readFile(pdfPath))
  return { outputs: [target], meta: { pages: await native.pageCount(target.path, ctx), engine: 'LibreOffice' } }
}

handlers['word-to-pdf'] = officeHandler
handlers['excel-to-pdf'] = officeHandler
handlers['powerpoint-to-pdf'] = officeHandler

handlers['html-to-pdf'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const pdfPath = await native.htmlToPdf(files[0].path, { outDir: join(dir, 'html'), cwd: dir }, ctx)
  const target = out(dir, safeBase(files[0].name), 'pdf')
  await writeFile(target.path, await readFile(pdfPath))
  return { outputs: [target], meta: { pages: await native.pageCount(target.path, ctx) } }
}

handlers['markdown-to-pdf'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const markdown = await readFile(files[0].path, 'utf8')
  const htmlPath = join(dir, 'markdown.html')
  await convert.textToHtmlFile(markdown, htmlPath)
  const pdfPath = await native.htmlToPdf(htmlPath, { outDir: join(dir, 'md'), cwd: dir }, ctx)
  const target = out(dir, safeBase(files[0].name), 'pdf')
  await writeFile(target.path, await readFile(pdfPath))
  return { outputs: [target], meta: { pages: await native.pageCount(target.path, ctx) } }
}

handlers['webpage-to-pdf'] = async ({ options, dir, ctx }) => {
  const url = String(options.url || '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full http(s) URL to capture')
  const html = await fetchWebpage(url, ctx)
  const htmlPath = join(dir, 'webpage.html')
  await writeFile(htmlPath, html, 'utf8')
  const pdfPath = await native.htmlToPdf(htmlPath, { outDir: join(dir, 'web'), cwd: dir }, ctx)
  const target = out(dir, 'webpage', 'pdf')
  await writeFile(target.path, await readFile(pdfPath))
  return { outputs: [target], meta: { pages: await native.pageCount(target.path, ctx), url } }
}

async function fetchWebpage(url, ctx) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(CONFIG.engineTimeoutMs, 20_000))
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: ctx.signal ?? controller.signal,
      headers: { 'user-agent': 'Folio/1.0 (+document capture)', accept: 'text/html,application/xhtml+xml' },
    })
    if (!response.ok) throw new Error(`The page returned HTTP ${response.status}`)
    const type = response.headers.get('content-type') || ''
    if (!/html|xml|text/i.test(type)) throw new Error(`That URL returned ${type || 'an unknown type'}, not a web page`)
    const body = await response.text()
    return body.length > 4 * 1024 * 1024 ? body.slice(0, 4 * 1024 * 1024) : body
  } finally {
    clearTimeout(timer)
  }
}

handlers['image-to-pdf'] = async ({ files, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, files.length === 1 ? safeBase(files[0].name) : 'images', 'pdf')
  const result = await pdfEngine.imagesToPdf(
    files.map((file) => file.path),
    { pageSize: options.pageSize || 'fit', margin: Number(options.margin) || 0 },
    target.path,
  )
  return { outputs: [target], meta: result }
}

/* ---- edit, forms, signatures ---- */

handlers.editor = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-edited`, 'pdf')
  const result = await pdfEngine.applyOverlays(files[0].path, options.ops || [], target.path, ctx)
  return { outputs: [target], meta: result }
}

handlers.sign = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-signed`, 'pdf')
  const result = await pdfEngine.applySignatures(files[0].path, options.signatures || [], target.path, ctx)
  return { outputs: [target], meta: result }
}

handlers.forms = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-filled`, 'pdf')
  const result = await pdfEngine.fillForm(files[0].path, options.fields || {}, target.path, {
    flatten: Boolean(options.flatten),
    ctx,
  })
  return { outputs: [target], meta: result }
}

handlers.watermark = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-watermarked`, 'pdf')
  const result = await pdfEngine.watermark(files[0].path, target.path, options, ctx)
  return { outputs: [target], meta: result }
}

/* ---- security ---- */

handlers.redact = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-redacted`, 'pdf')
  const result = await pdfEngine.redact(files[0].path, options.regions || [], target.path, {
    dpi: options.dpi,
    ctx,
  })
  return { outputs: [target], meta: result }
}

handlers.compare = async ({ files, dir, ctx }) => {
  requireFiles(files, 2, 'Select two PDFs to compare')
  const target = out(dir, 'comparison-report', 'pdf')
  const result = await convert.comparePdfs(files[0].path, files[1].path, target.path, ctx)
  return { outputs: [target], meta: result }
}

handlers.encrypt = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-protected`, 'pdf')
  const result = await native.protectPdf(files[0].path, options, target.path, ctx)
  return { outputs: [target], meta: { ...result, encryption: 'AES-256' } }
}

handlers.decrypt = async ({ files, options, dir, ctx }) => {
  requireFiles(files, 1)
  const target = out(dir, `${safeBase(files[0].name)}-unlocked`, 'pdf')
  const result = await native.unlockPdf(files[0].path, options, target.path, ctx)
  return { outputs: [target], meta: result }
}

/* ---- document intelligence ---- */

async function documentText(files, ctx) {
  requireFiles(files, 1)
  const text = await native.pdfToText(files[0].path, ctx)
  if (!text.trim()) throw new Error('No selectable text found. Run OCR PDF first for scanned documents.')
  return text
}

handlers['ai-summarize'] = async ({ files, options, ctx }) => {
  const text = await documentText(files, ctx)
  const limit = Math.max(3, Math.min(20, Number(options.sentences) || 6))
  const sentences = scoreSentences(text, limit)
  const words = text.split(/\s+/).filter(Boolean).length
  return {
    outputs: [],
    result: {
      mode: 'extractive',
      engine: 'folio-summarizer',
      summary: sentences,
      stats: { words, sentences: sentencesOf(text).length, readingMinutes: Math.max(1, Math.round(words / 220)) },
    },
    meta: { words },
  }
}

handlers['ai-chat'] = async ({ files, options, ctx }) => {
  const text = await documentText(files, ctx)
  const question = String(options.question || '').trim()
  if (!question) throw new Error('Ask a question about the document')
  const sentences = sentencesOf(text)
  const terms = (question.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(
    (word) => !'the and for what when where which how why does did is are was were of to in on'.split(' ').includes(word),
  )
  const scored = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase()
    const hits = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0)
    return { sentence, index, score: hits / Math.max(1, terms.length) + (hits ? 0.01 : 0) }
  })
  const best = scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 3)
  return {
    outputs: [],
    result: {
      mode: 'extractive',
      engine: 'folio-retrieval',
      answer: best.length
        ? best.map((entry) => entry.sentence).join(' ')
        : 'No passage in this document mentions those terms.',
      citations: best.map((entry) => ({ sentence: entry.sentence.slice(0, 240), position: entry.index + 1 })),
      confidence: best.length ? Math.min(0.95, 0.35 + best[0].score * 0.6) : 0,
    },
    meta: { terms },
  }
}

handlers['ai-tables'] = async ({ files, options, ctx }) => {
  requireFiles(files, 1)
  const text = await native.pdfToText(files[0].path, ctx)
  const tables = convert.detectTablesFromText(text)
  if (!tables.length) throw new Error('No tabular structure was detected in this document')
  const csv = tables
    .map((rows, index) =>
      [`# Table ${index + 1}`, ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n'),
    )
    .join('\n\n')
  const base = safeBase(files[0].name)
  const csvOut = out(dir_for(options), `${base}-tables`, 'csv')
  const jsonOut = out(dir_for(options), `${base}-tables`, 'json')
  await writeFile(csvOut.path, csv, 'utf8')
  await writeFile(jsonOut.path, JSON.stringify({ tables }, null, 2), 'utf8')
  return { outputs: [csvOut, jsonOut], result: { tables: tables.length, rows: tables.reduce((sum, t) => sum + t.length, 0) }, meta: {} }
}

function dir_for(options) {
  if (!options.__dir) throw new Error('Internal: missing job directory')
  return options.__dir
}

handlers['ai-translate'] = async ({ files, options }) => {
  requireFiles(files, 1)
  const text = await native.pdfToText(files[0].path, {})
  const target = String(options.target || 'es')
  throw new Error(
    `Translation needs a language model. Folio's server runs no translation model, so this request was not performed. ` +
      `Configure FOLIO_OLLAMA_URL to a reachable model host (target language: ${target}; ${text.length} characters extracted) to enable it.`,
  )
}

handlers['ai-workspace'] = async ({ files, ctx }) => {
  const text = await documentText(files, ctx)
  return {
    outputs: [],
    result: {
      mode: 'extractive',
      engine: 'folio-analysis',
      summary: scoreSentences(text, 5),
      stats: {
        words: text.split(/\s+/).filter(Boolean).length,
        sentences: sentencesOf(text).length,
        tables: convert.detectTablesFromText(text).length,
      },
    },
    meta: {},
  }
}

/* ------------------------------- dispatch ------------------------------- */

export const SERVER_TOOLS = Object.keys(handlers)

export function hasHandler(toolId) {
  return Object.prototype.hasOwnProperty.call(handlers, toolId)
}

export async function runTool(toolId, context) {
  const handler = handlers[toolId]
  if (!handler) throw new Error(`Tool "${toolId}" is not available on the server`)
  const options = { ...(context.options || {}) }
  Object.defineProperty(options, '__dir', { value: context.dir, enumerable: false })
  const result = await handler({ ...context, options })
  const outputs = Array.isArray(result?.outputs) ? result.outputs : []
  for (const output of outputs) {
    const info = await stat(output.path)
    if (!info.size) throw new Error(`The engine produced an empty file for "${toolId}"`)
    output.size = info.size
  }
  return { outputs, result: result?.result ?? null, meta: result?.meta ?? {} }
}
