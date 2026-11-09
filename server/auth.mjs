import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const COOKIE = 'folio_sid'
const SECRET = process.env.FOLIO_SESSION_SECRET || randomBytes(32).toString('hex')
const SESSION_TTL_S = 24 * 60 * 60

if (!process.env.FOLIO_SESSION_SECRET) {
  console.warn('[folio] FOLIO_SESSION_SECRET is not set — using an ephemeral secret. Sessions will not survive a restart or a second instance.')
}

function sign(id) {
  return createHmac('sha256', SECRET).update(id).digest('base64url')
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

/** Read a verified session id from the request, or null when absent/forged. */
export function sessionFrom(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE]
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const id = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  if (!/^[a-f0-9]{32}$/.test(id)) return null
  return safeEqual(mac, sign(id)) ? id : null
}

function isSecure(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  return proto === 'https' || Boolean(req.socket?.encrypted)
}

/** Return the caller's session id, issuing a signed cookie when none exists. */
export function ensureSession(req, res) {
  const existing = sessionFrom(req)
  if (existing) return existing
  const id = randomBytes(16).toString('hex')
  const attrs = [
    `${COOKIE}=${encodeURIComponent(`${id}.${sign(id)}`)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_S}`,
  ]
  if (isSecure(req)) attrs.push('Secure')
  res.setHeader('Set-Cookie', attrs.join('; '))
  return id
}

/**
 * Reject cross-site state-changing requests. Browsers always send Origin for
 * these, so a mismatch means the request did not come from Folio itself.
 */
export function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host
    return new URL(origin).host === host
  } catch {
    return false
  }
}
