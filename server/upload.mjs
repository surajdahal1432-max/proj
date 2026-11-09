import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { CONFIG } from './config.mjs'

const OFFICE_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'])
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'html', 'htm', 'csv'])

export function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''))
  return match ? match[1].toLowerCase() : ''
}

/** Strip directories and control characters so uploads cannot escape the job dir. */
export function sanitizeName(name, fallback = 'input') {
  const base = String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  const cleaned = base.slice(0, 120)
  if (!cleaned) return fallback
  return cleaned.replace(/[^A-Za-z0-9._\- ()[\]]/g, '_') || fallback
}

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false
  return bytes.every((byte, index) => buffer[index] === byte)
}

/** Sniff the real content type from the first bytes of the upload. */
export function sniff(head, extension) {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf' // %PDF-
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) {
    return OFFICE_EXTENSIONS.has(extension) ? 'office' : 'zip'
  }
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image'
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image'
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'image'
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46])) return 'image' // RIFF (webp)
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return 'image'
  if (TEXT_EXTENSIONS.has(extension) && !head.includes(0x00)) return 'text'
  if (head.length && !head.includes(0x00)) return 'text'
  return 'unknown'
}

const EXPECTED = {
  pdf: ['pdf'],
  office: ['office', 'zip'],
  image: ['image'],
  text: ['text'],
}

/**
 * Validate an uploaded file against the tool's accepted content.
 * Returns a human-readable error string, or null when the file is acceptable.
 */
export function validateUpload(head, name, accept) {
  const extension = extensionOf(name)
  if (!extension) return 'The file has no extension, so its type cannot be verified.'
  if (Array.isArray(accept) && accept.length && !accept.includes(extension)) {
    return `.${extension} files are not supported by this tool (expected ${accept.map((item) => `.${item}`).join(', ')}).`
  }
  const kind = sniff(head, extension)
  if (kind === 'unknown') return 'The file content is not a recognised document format.'
  const expected = EXPECTED[kind]
  const acceptable = expected.some((candidate) => {
    if (candidate === 'pdf') return extension === 'pdf'
    if (candidate === 'office') return OFFICE_EXTENSIONS.has(extension)
    if (candidate === 'image') return IMAGE_EXTENSIONS.has(extension)
    if (candidate === 'text') return TEXT_EXTENSIONS.has(extension)
    return false
  })
  if (!acceptable) {
    return `The file content does not match its .${extension} extension.`
  }
  if (kind === 'pdf' && extension !== 'pdf') {
    return 'The file contains PDF data but is not named .pdf.'
  }
  return null
}

/**
 * Stream a raw request body to disk with a hard byte limit.
 * Never buffers the whole file in memory.
 */
export function writeStream(req, destPath, maxBytes = CONFIG.maxFileBytes) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(destPath, { mode: 0o600 })
    let bytes = 0
    let head = Buffer.alloc(0)
    let settled = false

    const cleanup = async () => {
      try {
        await unlink(destPath)
      } catch {
        /* noop */
      }
    }

    const abortWith = (error) => {
      if (settled) return
      settled = true
      req.unpipe?.(stream)
      stream.destroy()
      cleanup().finally(() => reject(error))
    }

    req.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.length
      if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16)
      if (bytes > maxBytes) {
        abortWith(new Error(`File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`))
      }
    })
    req.on('aborted', () => abortWith(new Error('Upload aborted')))
    req.on('error', (error) => abortWith(error))
    stream.on('error', (error) => abortWith(error))
    stream.on('finish', () => {
      if (settled) return
      settled = true
      resolve({ bytes, head })
    })
    req.pipe(stream)
  })
}

export function outputTypeFor(name) {
  const extension = extensionOf(name)
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'zip') return 'application/zip'
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'txt' || extension === 'md') return 'text/plain; charset=utf-8'
  if (extension === 'csv') return 'text/csv; charset=utf-8'
  if (extension === 'json') return 'application/json'
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (extension === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (extension === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  return 'application/octet-stream'
}
