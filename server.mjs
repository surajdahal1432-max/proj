import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { createServer } from 'node:http'
import { createGzip } from 'node:zlib'

const ROOT = resolve(process.cwd(), 'dist')
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'

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
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.traineddata': 'application/octet-stream',
}

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map'])

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  return join(ROOT, rel)
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

const server = createServer((req, res) => {
  const url = req.url || '/'
  let filePath = safePath(url)

  if (!existsSync(filePath) || (existsSync(filePath) && statSync(filePath).isDirectory())) {
    const indexCandidate = join(filePath, 'index.html')
    if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
      filePath = indexCandidate
    } else {
      // SPA fallback
      filePath = join(ROOT, 'index.html')
    }
  }

  if (!existsSync(filePath)) {
    return send(res, 404, 'Not found')
  }

  const ext = extname(filePath).toLowerCase()
  const stat = statSync(filePath)
  const immutable = /\/assets\//.test(filePath)
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  }

  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip')
  if (acceptsGzip && COMPRESSIBLE.has(ext) && stat.size > 1024) {
    headers['Content-Encoding'] = 'gzip'
    headers['Vary'] = 'Accept-Encoding'
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    return createReadStream(filePath).pipe(createGzip({ level: 6 })).pipe(res)
  }

  headers['Content-Length'] = String(stat.size)
  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()
  createReadStream(filePath).pipe(res)
})

server.listen(PORT, HOST, () => {
  console.log(`Folio static server listening on http://${HOST}:${PORT}`)
})
