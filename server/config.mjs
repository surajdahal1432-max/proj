import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const MB = 1024 * 1024
const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function firstExisting(candidates) {
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate
  return null
}

/**
 * Central configuration for Folio's processing server.
 * Every limit can be tuned through the environment so hosting capacity and
 * engine availability are deployment decisions, not code changes.
 */
export const CONFIG = {
  root: resolve(process.env.FOLIO_ROOT || join(process.cwd(), 'dist')),
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  jobRoot: process.env.FOLIO_JOB_DIR || join(tmpdir(), 'folio-jobs'),
  maxFileBytes: num(process.env.FOLIO_MAX_FILE_BYTES, 40 * MB),
  maxTotalBytes: num(process.env.FOLIO_MAX_TOTAL_BYTES, 120 * MB),
  maxFiles: num(process.env.FOLIO_MAX_FILES, 20),
  maxOutputs: num(process.env.FOLIO_MAX_OUTPUTS, 60),
  jobTimeoutMs: num(process.env.FOLIO_JOB_TIMEOUT_MS, 180_000),
  engineTimeoutMs: num(process.env.FOLIO_ENGINE_TIMEOUT_MS, 120_000),
  resultTtlMs: num(process.env.FOLIO_RESULT_TTL_MS, 10 * 60_000),
  abandonedTtlMs: num(process.env.FOLIO_ABANDONED_TTL_MS, 15 * 60_000),
  sweepMs: 30_000,
  // Heavy engines (LibreOffice, Tesseract) need ~300-500 MB per process.
  // On a 1 GB / 1 vCPU app only one may run at a time; light pdf-lib work is cheap.
  heavyConcurrency: num(process.env.FOLIO_HEAVY_CONCURRENCY, 1),
  lightConcurrency: num(process.env.FOLIO_LIGHT_CONCURRENCY, 2),
  maxBodyBytes: num(process.env.FOLIO_MAX_BODY_BYTES, 2 * MB),
  /** Public origin used for absolute download links when behind a proxy. */
  publicOrigin: process.env.FOLIO_PUBLIC_ORIGIN || '',
}

export const ENGINES = {
  soffice: firstExisting([
    process.env.FOLIO_SOFFICE_PATH,
    '/usr/bin/soffice',
    '/usr/lib/libreoffice/program/soffice',
    '/usr/local/bin/soffice',
  ]),
  qpdf: firstExisting([process.env.FOLIO_QPDF_PATH, '/usr/bin/qpdf', '/usr/local/bin/qpdf']),
  pdftoppm: firstExisting([process.env.FOLIO_PDFTOPPM_PATH, '/usr/bin/pdftoppm', '/usr/local/bin/pdftoppm']),
  pdftotext: firstExisting([process.env.FOLIO_PDFTOTEXT_PATH, '/usr/bin/pdftotext', '/usr/local/bin/pdftotext']),
  pdfinfo: firstExisting([process.env.FOLIO_PDFINFO_PATH, '/usr/bin/pdfinfo', '/usr/local/bin/pdfinfo']),
  tesseract: firstExisting([process.env.FOLIO_TESSERACT_PATH, '/usr/bin/tesseract', '/usr/local/bin/tesseract']),
  magick: firstExisting([process.env.FOLIO_MAGICK_PATH, '/usr/bin/convert', '/usr/bin/magick']),
}

export function engineCapabilities() {
  return Object.fromEntries(Object.entries(ENGINES).map(([name, path]) => [name, { available: Boolean(path), path }]))
}

/** Tools whose engine is genuinely installed and therefore runs server-side. */
export function availableTools(toolIds) {
  const caps = engineCapabilities()
  const needs = {
    office: () => caps.soffice.available,
    ocr: () => caps.tesseract.available && caps.pdftoppm.available,
    raster: () => caps.pdftoppm.available,
    qpdf: () => caps.qpdf.available,
  }
  const requirements = {
    'word-to-pdf': 'office',
    'excel-to-pdf': 'office',
    'powerpoint-to-pdf': 'office',
    'pdf-to-word': 'office',
    'pdf-to-excel': 'office',
    'pdf-to-powerpoint': 'office',
    'html-to-pdf': 'office',
    'markdown-to-pdf': 'office',
    'webpage-to-pdf': 'office',
    ocr: 'ocr',
    'pdf-to-jpg': 'raster',
    'pdf-to-png': 'raster',
    redact: 'raster',
    compress: 'qpdf',
    repair: 'qpdf',
    encrypt: 'qpdf',
    decrypt: 'qpdf',
  }
  const ready = []
  const unavailable = []
  for (const id of toolIds) {
    const requirement = requirements[id]
    if (!requirement || needs[requirement]()) ready.push(id)
    else unavailable.push({ id, requirement })
  }
  return { ready, unavailable, engines: caps }
}
