import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat, readFile } from 'node:fs/promises'
import { join, normalize, extname, sep, basename } from 'node:path'
import { CONFIG, engineCapabilities, availableTools } from './config.mjs'
import { ensureSession, sameOrigin } from './auth.mjs'
import {
  createJob,
  getJob,
  ownsJob,
  publicJob,
  prepareJobDir,
  setProgress,
  warn,
  cancel,
  runJob,
  startSweeper,
  stats,
} from './jobs.mjs'
import { sanitizeName, validateUpload, writeStream, outputTypeFor, extensionOf } from './upload.mjs'
import { runTool, hasHandler, SERVER_TOOLS } from './pipeline.mjs'

/** Tools that spawn a native process needing ~300-500 MB. Serialised on small hosts. */
const HEAVY_TOOLS = new Set([
  'word-to-pdf',
  'excel-to-pdf',
  'powerpoint-to-pdf',
  'pdf-to-word',
  'pdf-to-excel',
  'pdf-to-powerpoint',
  'html-to-pdf',
  'webpage-to-pdf',
  'markdown-to-pdf',
  'ocr',
])

/** Extensions each tool accepts. The server enforces this, not just the browser. */
const ACCEPT = {
  merge: ['pdf'],
  split: ['pdf'],
  rearrange: ['pdf'],
  extract: ['pdf'],
  rotate: ['pdf'],
  compress: ['pdf'],
  repair: ['pdf'],
  ocr: ['pdf'],
  'pdf-to-word': ['pdf'],
  'pdf-to-excel': ['pdf'],
  'pdf-to-powerpoint': ['pdf'],
  'pdf-to-jpg': ['pdf'],
  'pdf-to-png': ['pdf'],
  'pdf-to-markdown': ['pdf'],
  'pdf-to-text': ['pdf'],
  'pdf-to-pdfa': ['pdf'],
  'word-to-pdf': ['docx', 'doc', 'odt'],
  'excel-to-pdf': ['xlsx', 'xls', 'ods', 'csv'],
  'powerpoint-to-pdf': ['pptx', 'ppt', 'odp'],
  'image-to-pdf': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'],
  'markdown-to-pdf': ['md', 'markdown', 'txt'],
  'html-to-pdf': ['html', 'htm'],
  'webpage-to-pdf': [],
  editor: ['pdf'],
  sign: ['pdf', 'png', 'jpg', 'jpeg'],
  forms: ['pdf'],
  watermark: ['pdf'],
  redact: ['pdf'],
  compare: ['pdf'],
  encrypt: ['pdf'],
  decrypt: ['pdf'],
  'ai-summarize': ['pdf'],
  'ai-chat': ['pdf'],
  'ai-tables': ['pdf'],
  'ai-translate': ['pdf'],
  'ai-workspace': ['pdf'],
}

const MAX_FILES_FOR = (tool) => (tool === 'merge' || tool === 'image-to-pdf' ? CONFIG.maxFiles : 2)

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendText(res, status, text) {
  const body = Buffer.from(String(text))
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function readJson(req, limit = CONFIG.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, 'Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/* ------------------------------ job control ------------------------------ */

async function createJobRoute(req, res, sessionId) {
  const body = await readJson(req)
  const tool = String(body.tool || '')
  if (!hasHandler(tool)) throw new HttpError(400, `Unknown tool "${tool}"`)
  const declared = Array.isArray(body.files) ? body.files : []
  const maxFiles = MAX_FILES_FOR(tool)
  if (declared.length > maxFiles) throw new HttpError(400, `This tool accepts at most ${maxFiles} files`)
  if (declared.length === 0 && tool !== 'webpage-to-pdf') throw new HttpError(400, 'Select at least one file')
  let total = 0
  for (const file of declared) {
    const size = Number(file?.size) || 0
    if (size > CONFIG.maxFileBytes) {
      throw new HttpError(413, `${file?.name || 'A file'} exceeds the ${Math.round(CONFIG.maxFileBytes / (1024 * 1024))} MB limit`)
    }
    total += size
  }
  if (total > CONFIG.maxTotalBytes) {
    throw new HttpError(413, `The upload exceeds the ${Math.round(CONFIG.maxTotalBytes / (1024 * 1024))} MB total limit`)
  }

  const job = createJob({
    sessionId,
    tool,
    options: body.options && typeof body.options === 'object' ? body.options : {},
    files: declared,
  })
  await prepareJobDir(job)
  setProgress(job, 0, 'Awaiting upload')
  sendJson(res, 201, {
    jobId: job.id,
    tool: job.tool,
    uploads: job.files.map((file) => ({
      index: file.index,
      name: file.name,
      maxBytes: CONFIG.maxFileBytes,
      url: `/api/jobs/${job.id}/files/${file.index}`,
    })),
    expiresAt: Date.now() + CONFIG.abandonedTtlMs,
  })
}

async function uploadRoute(req, res, sessionId, jobId, index) {
  const job = getJob(jobId)
  if (!ownsJob(job, sessionId)) throw new HttpError(404, 'Job not found')
  const file = job.files[index]
  if (!file) throw new HttpError(404, 'Unknown upload slot')
  if (job.status !== 'created') throw new HttpError(409, 'This job is no longer accepting uploads')
  if (file.uploaded) throw new HttpError(409, 'This file was already uploaded')

  const dest = join(job.inputDir, `${index}-${sanitizeName(file.name, 'input')}`)
  const { bytes, head } = await writeStream(req, dest, CONFIG.maxFileBytes)
  if (bytes === 0) throw new HttpError(400, 'The uploaded file is empty')

  const accept = ACCEPT[job.tool] || []
  if (job.tool !== 'webpage-to-pdf') {
    const problem = validateUpload(head, file.name, accept)
    if (problem) {
      const { rm } = await import('node:fs/promises')
      await rm(dest, { force: true })
      throw new HttpError(415, problem)
    }
  }

  file.path = dest
  file.size = bytes
  file.uploaded = true
  sendJson(res, 200, { ok: true, index, name: file.name, size: bytes })
}

async function startRoute(req, res, sessionId, jobId) {
  const job = getJob(jobId)
  if (!ownsJob(job, sessionId)) throw new HttpError(404, 'Job not found')
  if (job.status !== 'created') throw new HttpError(409, 'This job has already been started')
  if (job.files.some((file) => !file.uploaded) && job.tool !== 'webpage-to-pdf') {
    throw new HttpError(400, 'Upload every file before starting the job')
  }

  const files = job.files.map((file) => ({
    name: file.name,
    path: file.path,
    size: file.size,
    type: extensionOf(file.name),
  }))
  const ctx = {
    signal: job.controller.signal,
    onProgress: (value, stage) => setProgress(job, value, stage),
    warn: (message) => warn(job, message),
  }
  const weight = HEAVY_TOOLS.has(job.tool) ? 'heavy' : 'light'

  // Respond first so the client can poll progress, then process.
  sendJson(res, 202, publicJob(job))

  void runJob(
    job,
    async () => {
      setProgress(job, 5, 'Starting engine')
      const result = await runTool(job.tool, {
        files,
        options: { ...job.options, __dir: job.outputDir },
        dir: job.outputDir,
        ctx,
      })
      const outputs = Array.isArray(result) ? result : result?.outputs || []
      if (!outputs.length) throw new Error('The engine produced no output file')
      const validated = []
      for (const output of outputs) {
        const info = await stat(output.path).catch(() => null)
        if (!info || !info.isFile() || info.size === 0) {
          throw new Error(`The engine produced an empty or missing file: ${output.name || 'output'}`)
        }
        validated.push({
          path: output.path,
          name: sanitizeName(output.name || basename(output.path), 'output'),
          size: info.size,
          type: output.mime || outputTypeFor(output.name || output.path),
        })
      }
      if (result && typeof result === 'object' && result.meta) job.meta = result.meta
      return validated
    },
    weight,
  )
}

function statusRoute(req, res, sessionId, jobId) {
  const job = getJob(jobId)
  if (!ownsJob(job, sessionId)) throw new HttpError(404, 'Job not found')
  sendJson(res, 200, { ...publicJob(job), meta: job.meta ?? null })
}

function cancelRoute(req, res, sessionId, jobId) {
  const job = getJob(jobId)
  if (!ownsJob(job, sessionId)) throw new HttpError(404, 'Job not found')
  const cancelled = cancel(job)
  sendJson(res, cancelled ? 200 : 409, { ok: cancelled, ...publicJob(job) })
}

async function downloadRoute(req, res, sessionId, jobId, index) {
  const job = getJob(jobId)
  if (!ownsJob(job, sessionId)) throw new HttpError(404, 'Job not found')
  if (job.status !== 'done') throw new HttpError(409, 'The job has no downloadable result yet')
  const output = job.outputs[index]
  if (!output) throw new HttpError(404, 'Unknown result file')
  const info = await stat(output.path).catch(() => null)
  if (!info || !info.isFile()) throw new HttpError(410, 'The result file has expired and was deleted')

  res.writeHead(200, {
    'content-type': output.type || 'application/octet-stream',
    'content-length': info.size,
    'content-disposition': `attachment; filename="${sanitizeName(output.name, 'result')}"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  createReadStream(output.path).pipe(res)
}

/* -------------------------------- routing -------------------------------- */

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean) // api, jobs, :id, ...
  const method = req.method || 'GET'

  if (parts[1] === 'health') {
    return sendJson(res, 200, { ok: true, ...stats(), engines: engineCapabilities() })
  }
  if (parts[1] === 'engines') {
    const tools = availableTools(SERVER_TOOLS)
    return sendJson(res, 200, {
      engines: tools.engines,
      tools: SERVER_TOOLS,
      ready: tools.ready,
      unavailable: tools.unavailable,
      limits: {
        maxFileBytes: CONFIG.maxFileBytes,
        maxTotalBytes: CONFIG.maxTotalBytes,
        maxFiles: CONFIG.maxFiles,
        jobTimeoutMs: CONFIG.jobTimeoutMs,
        resultTtlMs: CONFIG.resultTtlMs,
      },
    })
  }
  if (parts[1] !== 'jobs') throw new HttpError(404, 'Unknown endpoint')

  const sessionId = ensureSession(req, res)
  if (method !== 'GET' && !sameOrigin(req)) throw new HttpError(403, 'Cross-origin requests are not allowed')

  if (!parts[2]) {
    if (method !== 'POST') throw new HttpError(405, 'Use POST to create a job')
    return createJobRoute(req, res, sessionId)
  }

  const jobId = parts[2]
  if (parts[3] === 'files') {
    if (method !== 'PUT') throw new HttpError(405, 'Use PUT to upload a file')
    return uploadRoute(req, res, sessionId, jobId, Number(parts[4]))
  }
  if (parts[3] === 'download') {
    if (method !== 'GET') throw new HttpError(405, 'Use GET to download a result')
    return downloadRoute(req, res, sessionId, jobId, Number(parts[4]))
  }
  if (parts[3] === 'start') {
    if (method !== 'POST') throw new HttpError(405, 'Use POST to start a job')
    return startRoute(req, res, sessionId, jobId)
  }
  if (parts[3] === 'cancel') {
    if (method !== 'POST') throw new HttpError(405, 'Use POST to cancel a job')
    return cancelRoute(req, res, sessionId, jobId)
  }
  if (!parts[3]) {
    if (method !== 'GET') throw new HttpError(405, 'Use GET for job status')
    return statusRoute(req, res, sessionId, jobId)
  }
  throw new HttpError(404, 'Unknown job endpoint')
}

/** Resolve a URL path inside the static root, or null when it escapes. */
export function safePath(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const full = join(CONFIG.root, normalize(decoded))
  if (full === CONFIG.root || full.startsWith(CONFIG.root + sep)) return full
  return null
}

async function serveStatic(req, res, url) {
  const filePath = safePath(url.pathname)
  if (!filePath) return sendText(res, 400, 'Bad request')

  const info = await stat(filePath).catch(() => null)
  if (info?.isFile()) {
    const type = outputTypeFor(filePath) || 'application/octet-stream'
    const cache = /\/assets\//.test(url.pathname) ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'cache-control': cache })
    return createReadStream(filePath).pipe(res)
  }

  if (info?.isDirectory()) {
    const index = join(filePath, 'index.html')
    const indexInfo = await stat(index).catch(() => null)
    if (indexInfo?.isFile()) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': indexInfo.size })
      return createReadStream(index).pipe(res)
    }
  }

  // A missing asset (has an extension) is a real 404; anything else is a SPA route.
  if (extname(filePath)) return sendText(res, 404, 'Not found')

  const shell = join(CONFIG.root, 'index.html')
  const shellInfo = await stat(shell).catch(() => null)
  if (!shellInfo?.isFile()) return sendText(res, 404, 'Not found')
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': shellInfo.size })
  return createReadStream(shell).pipe(res)
}

export function createApp() {
  startSweeper()
  const server = createServer(async (req, res) => {
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      return sendText(res, 400, 'Bad request')
    }
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url)
      else await serveStatic(req, res, url)
    } catch (error) {
      if (res.headersSent) return
      const status = error instanceof HttpError ? error.status : 500
      const message = error?.message || 'Unexpected server error'
      if (status >= 500) console.error('[folio] request failed:', message)
      sendJson(res, status, { error: message })
    }
  })
  server.requestTimeout = CONFIG.jobTimeoutMs + 60_000
  return { server }
}

export { handleApi, HttpError, sendJson }
