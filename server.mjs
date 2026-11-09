import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { createServer } from 'node:http'
import { createGzip } from 'node:zlib'
import { CONFIG } from './server/config.mjs'
import { startSweeper } from './server/jobs.mjs'
import { handleApi, HttpError } from './server/app.mjs'

const ROOT = CONFIG.root
const PORT = CONFIG.port
const HOST = CONFIG.host

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.traineddata': 'application/octet-stream',
}

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map'])

function safePath(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0])
  } catch {
    return null
  }
  if (decoded.includes('\u0000')) return null
  const full = join(ROOT, normalize(decoded))
  if (full === ROOT || full.startsWith(ROOT + sep)) return full
  return null
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

const server = createServer(async (req, res) => {
  const raw = req.url || '/'
  let url
  try {
    url = new URL(raw, 'http://localhost')
  } catch {
    return send(res, 400, 'Bad request')
  }

  // Processing API: jobs, uploads, status, cancellation and downloads.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url)
    } catch (error) {
      if (res.headersSent) return
      const status = error instanceof HttpError ? error.status : 500
      const message = error?.message || 'Unexpected server error'
      if (status >= 500) console.error('[folio] api error:', message)
      send(res, status, JSON.stringify({ error: message }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
    }
    return
  }

  const filePath = safePath(raw)
  if (!filePath) return send(res, 400, 'Bad request')

  let target = filePath
  if (!existsSync(target) || statSync(target).isDirectory()) {
    const indexCandidate = join(target, 'index.html')
    if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
      target = indexCandidate
    } else if (extname(target)) {
      return send(res, 404, 'Not found')
    } else {
      // SPA fallback for client-side routes
      target = join(ROOT, 'index.html')
    }
  }

  if (!existsSync(target)) return send(res, 404, 'Not found')

  const ext = extname(target).toLowerCase()
  const info = statSync(target)
  const immutable = /\/assets\//.test(target)
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  }

  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip')
  if (acceptsGzip && COMPRESSIBLE.has(ext) && info.size > 1024) {
    headers['Content-Encoding'] = 'gzip'
    headers['Vary'] = 'Accept-Encoding'
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    return createReadStream(target).pipe(createGzip({ level: 6 })).pipe(res)
  }

  headers['Content-Length'] = String(info.size)
  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()
  createReadStream(target).pipe(res)
})

startSweeper()

server.listen(PORT, HOST, () => {
  console.log(`Folio server listening on http://${HOST}:${PORT}`)
  console.log(`  static root: ${ROOT}`)
  console.log(`  job dir:     ${CONFIG.jobRoot}`)
})
