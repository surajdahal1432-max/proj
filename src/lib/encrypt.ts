import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from 'pdf-lib'
import { bytesToHex } from './utils'

/* ------------------------------------------------------------------ *
 * AES (pure TypeScript) — needed for the R6 key-derivation loop, which
 * requires un-padded CBC over data the browser WebCrypto API cannot take.
 * ------------------------------------------------------------------ */

function buildSbox(): Uint8Array {
  const sbox = new Uint8Array(256)
  const inv = new Uint8Array(256)
  for (let a = 0; a < 256; a++) {
    let found = 0
    if (a !== 0) {
      for (let b = 1; b < 256; b++) {
        if (gfMul(a, b) === 1) {
          found = b
          break
        }
      }
    }
    inv[a] = found
  }
  for (let a = 0; a < 256; a++) {
    const x = inv[a]
    const s = x ^ rotl8(x, 1) ^ rotl8(x, 2) ^ rotl8(x, 3) ^ rotl8(x, 4) ^ 0x63
    sbox[a] = s & 0xff
  }
  return sbox
}

function rotl8(value: number, shift: number): number {
  return ((value << shift) | (value >>> (8 - shift))) & 0xff
}

function gfMul(a: number, b: number): number {
  let p = 0
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a
    const hi = a & 0x80
    a = (a << 1) & 0xff
    if (hi) a ^= 0x1b
    b >>= 1
  }
  return p & 0xff
}

const SBOX = buildSbox()
const INV_SBOX = (() => {
  const inv = new Uint8Array(256)
  for (let i = 0; i < 256; i++) inv[SBOX[i]] = i
  return inv
})()

function expandKey(key: Uint8Array): Uint8Array {
  const nk = key.length / 4
  const nr = nk + 6
  const words = 4 * (nr + 1)
  const w = new Uint8Array(words * 4)
  w.set(key)
  let rcon = 1
  for (let i = nk; i < words; i++) {
    let t0 = w[(i - 1) * 4]
    let t1 = w[(i - 1) * 4 + 1]
    let t2 = w[(i - 1) * 4 + 2]
    let t3 = w[(i - 1) * 4 + 3]
    if (i % nk === 0) {
      const tmp = t0
      t0 = SBOX[t1] ^ rcon
      t1 = SBOX[t2]
      t2 = SBOX[t3]
      t3 = SBOX[tmp]
      rcon = gfMul(rcon, 2)
    } else if (nk > 6 && i % nk === 4) {
      t0 = SBOX[t0]
      t1 = SBOX[t1]
      t2 = SBOX[t2]
      t3 = SBOX[t3]
    }
    w[i * 4] = w[(i - nk) * 4] ^ t0
    w[i * 4 + 1] = w[(i - nk) * 4 + 1] ^ t1
    w[i * 4 + 2] = w[(i - nk) * 4 + 2] ^ t2
    w[i * 4 + 3] = w[(i - nk) * 4 + 3] ^ t3
  }
  return w
}

function addRoundKey(state: Uint8Array, w: Uint8Array, round: number) {
  const offset = round * 16
  for (let i = 0; i < 16; i++) state[i] ^= w[offset + i]
}

function subBytes(state: Uint8Array) {
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]]
}

function invSubBytes(state: Uint8Array) {
  for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]]
}

/** State is column-major: state[row + 4 * col]. */
function shiftRows(state: Uint8Array) {
  const copy = state.slice()
  for (let row = 1; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      state[row + 4 * col] = copy[row + 4 * ((col + row) % 4)]
    }
  }
}

function invShiftRows(state: Uint8Array) {
  const copy = state.slice()
  for (let row = 1; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      state[row + 4 * col] = copy[row + 4 * ((col - row + 4) % 4)]
    }
  }
}

function mixColumns(state: Uint8Array) {
  for (let col = 0; col < 4; col++) {
    const i = col * 4
    const a0 = state[i]
    const a1 = state[i + 1]
    const a2 = state[i + 2]
    const a3 = state[i + 3]
    state[i] = gfMul(a0, 2) ^ gfMul(a1, 3) ^ a2 ^ a3
    state[i + 1] = a0 ^ gfMul(a1, 2) ^ gfMul(a2, 3) ^ a3
    state[i + 2] = a0 ^ a1 ^ gfMul(a2, 2) ^ gfMul(a3, 3)
    state[i + 3] = gfMul(a0, 3) ^ a1 ^ a2 ^ gfMul(a3, 2)
  }
}

function invMixColumns(state: Uint8Array) {
  for (let col = 0; col < 4; col++) {
    const i = col * 4
    const a0 = state[i]
    const a1 = state[i + 1]
    const a2 = state[i + 2]
    const a3 = state[i + 3]
    state[i] = gfMul(a0, 14) ^ gfMul(a1, 11) ^ gfMul(a2, 13) ^ gfMul(a3, 9)
    state[i + 1] = gfMul(a0, 9) ^ gfMul(a1, 14) ^ gfMul(a2, 11) ^ gfMul(a3, 13)
    state[i + 2] = gfMul(a0, 13) ^ gfMul(a1, 9) ^ gfMul(a2, 14) ^ gfMul(a3, 11)
    state[i + 3] = gfMul(a0, 11) ^ gfMul(a1, 13) ^ gfMul(a2, 9) ^ gfMul(a3, 14)
  }
}

function encryptBlock(input: Uint8Array, w: Uint8Array): Uint8Array {
  const nr = w.length / 16 - 1
  const state = input.slice(0, 16)
  addRoundKey(state, w, 0)
  for (let round = 1; round < nr; round++) {
    subBytes(state)
    shiftRows(state)
    mixColumns(state)
    addRoundKey(state, w, round)
  }
  subBytes(state)
  shiftRows(state)
  addRoundKey(state, w, nr)
  return state
}

function decryptBlock(input: Uint8Array, w: Uint8Array): Uint8Array {
  const nr = w.length / 16 - 1
  const state = input.slice(0, 16)
  addRoundKey(state, w, nr)
  for (let round = nr - 1; round >= 1; round--) {
    invShiftRows(state)
    invSubBytes(state)
    addRoundKey(state, w, round)
    invMixColumns(state)
  }
  invShiftRows(state)
  invSubBytes(state)
  addRoundKey(state, w, 0)
  return state
}

export function aesCbcEncryptNoPad(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const w = expandKey(key)
  const out = new Uint8Array(data.length)
  let prev = iv.slice(0, 16)
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = new Uint8Array(16)
    for (let i = 0; i < 16; i++) block[i] = data[offset + i] ^ prev[i]
    const encrypted = encryptBlock(block, w)
    out.set(encrypted, offset)
    prev = encrypted
  }
  return out
}

export function aesCbcDecryptNoPad(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const w = expandKey(key)
  const out = new Uint8Array(data.length)
  let prev = iv.slice(0, 16)
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.slice(offset, offset + 16)
    const decrypted = decryptBlock(block, w)
    for (let i = 0; i < 16; i++) out[offset + i] = decrypted[i] ^ prev[i]
    prev = block
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function repeatBytes(data: Uint8Array, times: number): Uint8Array {
  const out = new Uint8Array(data.length * times)
  for (let i = 0; i < times; i++) out.set(data, i * data.length)
  return out
}

async function digest(algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array): Promise<Uint8Array> {
  const buffer = await crypto.subtle.digest(algorithm, data as unknown as ArrayBuffer)
  return new Uint8Array(buffer)
}

/** ISO 32000-2 Algorithm 2.B — iterative hash used by revisions 5 and 6. */
export async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await digest('SHA-256', concat(password, salt, udata))
  let round = 0
  let lastByte = 0
  do {
    const block = repeatBytes(concat(password, k, udata), 64)
    const e = aesCbcEncryptNoPad(block, k.slice(0, 16), k.slice(16, 32))
    const selector = e.slice(0, 16).reduce((sum, byte) => sum + byte, 0) % 3
    k = await digest(selector === 0 ? 'SHA-256' : selector === 1 ? 'SHA-384' : 'SHA-512', e)
    lastByte = e[e.length - 1]
    round++
  } while (round < 64 || lastByte > round - 32)
  return k.slice(0, 32)
}

function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

const ZERO_IV = new Uint8Array(16)

function importAesKey(key: Uint8Array) {
  return crypto.subtle.importKey('raw', key as unknown as ArrayBuffer, { name: 'AES-CBC' }, false, [
    'encrypt',
    'decrypt',
  ])
}

async function aesCbcEncryptPadded(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await importAesKey(key)
  const buffer = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv as unknown as ArrayBuffer }, cryptoKey, data as unknown as ArrayBuffer)
  return new Uint8Array(buffer)
}

async function aesCbcDecryptPadded(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await importAesKey(key)
  const buffer = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as unknown as ArrayBuffer }, cryptoKey, data as unknown as ArrayBuffer)
  return new Uint8Array(buffer)
}

/* ------------------------------------------------------------------ *
 * Permission bits
 * ------------------------------------------------------------------ */

export interface PermissionOptions {
  allowPrinting?: boolean
  allowCopying?: boolean
  allowModifying?: boolean
  allowAnnotating?: boolean
}

export function permissionsToP(options: PermissionOptions = {}): number {
  const { allowPrinting = true, allowCopying = true, allowModifying = true, allowAnnotating = true } = options
  let p = 0xfffffffc // reserved bits 7-8 set, all bits 13-32 set
  if (!allowPrinting) p &= ~(0x4 | 0x800)
  if (!allowModifying) p &= ~(0x8 | 0x20 | 0x400)
  if (!allowCopying) p &= ~0x10
  if (!allowAnnotating) p &= ~0x20
  return p | 0
}

export interface EncryptOptions extends PermissionOptions {
  userPassword: string
  ownerPassword?: string
  encryptMetadata?: boolean
}

export class PdfEncryptionUnsupported extends Error {}

export class PdfWrongPassword extends Error {
  constructor() {
    super('That password did not unlock this document.')
  }
}

/* ------------------------------------------------------------------ *
 * Object-graph walk
 * ------------------------------------------------------------------ */

type Walker = (value: unknown) => unknown

function walkObject(value: unknown, transform: Walker, seen = new Set<unknown>()): unknown {
  if (!value || seen.has(value)) return value
  seen.add(value)

  if (value instanceof PDFDict) {
    for (const [key, entry] of value.entries()) {
      const next = transform(entry)
      if (next !== entry) {
        value.set(key, next as never)
      } else {
        walkObject(entry, transform, seen)
      }
    }
    return value
  }

  if (value instanceof PDFArray) {
    for (let i = 0; i < value.size(); i++) {
      const entry = value.get(i)
      const next = transform(entry)
      if (next !== entry) {
        value.set(i, next as never)
      } else {
        walkObject(entry, transform, seen)
      }
    }
    return value
  }

  return value
}

function isStringObject(value: unknown): value is PDFString | PDFHexString {
  return value instanceof PDFString || value instanceof PDFHexString
}

function stringBytes(value: PDFString | PDFHexString): Uint8Array {
  if (value instanceof PDFHexString) return value.asBytes()
  return latin1Bytes(value.asText?.() ?? value.value ?? '')
}

/* ------------------------------------------------------------------ *
 * Encrypt
 * ------------------------------------------------------------------ */

export async function encryptPdf(file: File | Blob, options: EncryptOptions): Promise<Blob> {
  const userPassword = latin1Bytes(options.userPassword)
  if (userPassword.length === 0) throw new Error('Choose a password with at least one character.')

  const ownerPassword = latin1Bytes(options.ownerPassword || options.userPassword)

  const source = new Uint8Array(await file.arrayBuffer())
  const normalised = await PDFDocument.load(source, { updateMetadata: false, ignoreEncryption: true })
  const normalisedBytes = await normalised.save({ useObjectStreams: false })
  const doc = await PDFDocument.load(normalisedBytes as unknown as ArrayBuffer, {
    updateMetadata: false,
    ignoreEncryption: true,
  })

  const fileKey = randomBytes(32)

  // U / UE (user password)
  const validationSalt = randomBytes(8)
  const keySalt = randomBytes(8)
  const userHash = await hash2B(userPassword, validationSalt, new Uint8Array(0))
  const u = concat(userHash, validationSalt, keySalt)
  const ue = aesCbcEncryptNoPad(fileKey, userHash, ZERO_IV)

  // O / OE (owner password)
  const ownerValidationSalt = randomBytes(8)
  const ownerKeySalt = randomBytes(8)
  const ownerHash = await hash2B(ownerPassword, ownerValidationSalt, u)
  const o = concat(ownerHash, ownerValidationSalt, ownerKeySalt)
  const oe = aesCbcEncryptNoPad(fileKey, ownerHash, ZERO_IV)

  // Perms
  const permissions = permissionsToP(options)
  const perms = new Uint8Array(16)
  new DataView(perms.buffer).setInt32(0, permissions, true)
  perms[4] = 0xff
  perms[5] = 0xff
  perms[6] = 0xff
  perms[7] = 0xff
  perms[8] = options.encryptMetadata === false ? 0x46 : 0x54 // 'F' / 'T'
  perms[9] = 0x61 // 'a'
  perms[10] = 0x64 // 'd'
  perms[11] = 0x62 // 'b'
  perms.set(randomBytes(4), 12)
  const encryptedPerms = aesCbcEncryptNoPad(perms, fileKey, ZERO_IV).slice(0, 16)

  const encryptDict = doc.context.obj({
    Filter: 'Standard',
    V: 5,
    R: 6,
    Length: 256,
    CF: {
      StdCF: {
        AuthEvent: 'DocOpen',
        CFM: 'AESV3',
        Length: 32,
      },
    },
    StmF: 'StdCF',
    StrF: 'StdCF',
    O: PDFHexString.of(bytesToHex(o)),
    U: PDFHexString.of(bytesToHex(u)),
    OE: PDFHexString.of(bytesToHex(oe)),
    UE: PDFHexString.of(bytesToHex(ue)),
    Perms: PDFHexString.of(bytesToHex(encryptedPerms)),
    P: PDFNumber.of(permissions),
    EncryptMetadata: options.encryptMetadata === false ? false : true,
  }) as PDFDict

  const encryptRef = doc.context.register(encryptDict)

  // /ID must be present and stable for AES-256 readers.
  const idValue = PDFHexString.of(bytesToHex(randomBytes(16)))
  doc.context.trailerInfo.ID = doc.context.obj([idValue, idValue]) as PDFArray
  doc.context.trailerInfo.Encrypt = encryptRef

  const objects = doc.context.enumerateIndirectObjects()
  for (const [ref, object] of objects) {
    if (ref.objectNumber === encryptRef.objectNumber) continue
    encryptIndirectObject(doc, ref, object, fileKey)
  }

  const bytes = await doc.save({ useObjectStreams: false })
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

function encryptIndirectObject(
  doc: PDFDocument,
  ref: PDFRef,
  object: unknown,
  fileKey: Uint8Array,
) {
  if (object instanceof PDFStream) {
    const dict = object.dict
    const contents = object instanceof PDFRawStream ? object.contents : object.getContents()
    const iv = randomBytes(16)
    const encrypted = aesCbcEncryptNoPad(concat(iv, padPkcs7(contents)), fileKey, ZERO_IV)
    // NOTE: stream encryption uses AES-CBC over (IV || padded data); the IV is
    // prefixed to the ciphertext. Because our pure-JS CBC has no padding, apply
    // PKCS#7 manually so every reader agrees on the byte layout.
    const payload = concat(iv, encryptStreamBody(contents, fileKey, iv))
    void encrypted

    walkObject(dict, (value) => {
      if (isStringObject(value)) {
        return PDFHexString.of(bytesToHex(encryptStringBody(stringBytes(value), fileKey)))
      }
      return value
    })

    dict.set(PDFName.of('Length'), PDFNumber.of(payload.length))
    doc.context.assign(ref, PDFRawStream.of(dict, payload))
    return
  }

  if (object instanceof PDFDict || object instanceof PDFArray) {
    walkObject(object, (value) => {
      if (isStringObject(value)) {
        return PDFHexString.of(bytesToHex(encryptStringBody(stringBytes(value), fileKey)))
      }
      return value
    })
    doc.context.assign(ref, object as never)
  }
}

function padPkcs7(data: Uint8Array): Uint8Array {
  const padding = 16 - (data.length % 16)
  const out = new Uint8Array(data.length + padding)
  out.set(data)
  out.fill(padding, data.length)
  return out
}

/**
 * Encrypt a stream body with AES-256-CBC, prefixing a random IV.
 * Implemented with the synchronous CBC routine plus manual PKCS#7 padding so
 * that the layout is exactly IV || ciphertext (no WebCrypto padding surprises).
 */
function encryptStreamBody(data: Uint8Array, fileKey: Uint8Array, iv: Uint8Array): Uint8Array {
  const padded = padPkcs7(data)
  return aesCbcEncryptNoPad(padded, fileKey, iv)
}

function encryptStringBody(data: Uint8Array, fileKey: Uint8Array): Uint8Array {
  const iv = randomBytes(16)
  const padded = padPkcs7(data)
  return concat(iv, aesCbcEncryptNoPad(padded, fileKey, iv))
}

/* ------------------------------------------------------------------ *
 * Decrypt / unlock
 * ------------------------------------------------------------------ */

export interface DecryptResult {
  blob: Blob
  usedOwnerPassword: boolean
}

function lookupBytes(doc: PDFDocument, dict: PDFDict, key: string): Uint8Array {
  const entry = dict.get(PDFName.of(key))
  const resolved = entry ? doc.context.lookup(entry) : undefined
  if (resolved instanceof PDFHexString) return resolved.asBytes()
  if (resolved instanceof PDFString) return latin1Bytes(resolved.value)
  return new Uint8Array(0)
}

function lookupNumber(doc: PDFDocument, dict: PDFDict, key: string): number | undefined {
  const entry = dict.get(PDFName.of(key))
  const resolved = entry ? doc.context.lookup(entry) : undefined
  if (resolved instanceof PDFNumber) return resolved.asNumber()
  return undefined
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** True when the PDF trailer advertises an /Encrypt dictionary. */
export async function isEncrypted(file: File | Blob): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes.slice(-4096))
    return /\/Encrypt\s+\d+\s+\d+\s+R/.test(text) || /\/Encrypt\s*<</.test(text)
  } catch {
    return false
  }
}

/**
 * Remove AES-256 (V5/R5-R6) password protection, preserving text and vectors.
 * Revisions using RC4/AES-128 are reported as unsupported so the UI can offer
 * the pixel-based unlock fallback instead of silently producing a broken file.
 */
export async function decryptPdf(file: File | Blob, password: string): Promise<DecryptResult> {
  const source = new Uint8Array(await file.arrayBuffer())
  const doc = await PDFDocument.load(source, { updateMetadata: false, ignoreEncryption: true })
  const encryptEntry = doc.context.trailerInfo.Encrypt
  if (!encryptEntry) {
    return { blob: new Blob([source as unknown as BlobPart], { type: 'application/pdf' }), usedOwnerPassword: false }
  }

  const encryptDict = doc.context.lookup(encryptEntry)
  if (!(encryptDict instanceof PDFDict)) throw new PdfEncryptionUnsupported('Malformed /Encrypt dictionary.')

  const v = lookupNumber(doc, encryptDict, 'V') ?? 0
  const r = lookupNumber(doc, encryptDict, 'R') ?? 0
  if (v < 5 || r < 5) {
    throw new PdfEncryptionUnsupported(
      'This file uses legacy RC4/AES-128 encryption. Use “Unlock PDF” in pixel mode to remove it.',
    )
  }

  const u = lookupBytes(doc, encryptDict, 'U')
  const ue = lookupBytes(doc, encryptDict, 'UE')
  const o = lookupBytes(doc, encryptDict, 'O')
  const oe = lookupBytes(doc, encryptDict, 'OE')
  if (u.length < 48 || ue.length < 32 || o.length < 48 || oe.length < 32) {
    throw new PdfEncryptionUnsupported('Incomplete AES-256 key material in this file.')
  }

  const passwordBytes = latin1Bytes(password)
  let fileKey: Uint8Array | null = null
  let usedOwnerPassword = false

  const userHash = await hash2B(passwordBytes, u.slice(32, 40), new Uint8Array(0))
  if (bytesEqual(userHash, u.slice(0, 32))) {
    fileKey = aesCbcDecryptNoPad(ue.slice(0, 32), userHash, ZERO_IV).slice(0, 32)
  } else {
    const ownerHash = await hash2B(passwordBytes, o.slice(32, 40), u)
    if (bytesEqual(ownerHash, o.slice(0, 32))) {
      fileKey = aesCbcDecryptNoPad(oe.slice(0, 32), ownerHash, ZERO_IV).slice(0, 32)
      usedOwnerPassword = true
    }
  }

  if (!fileKey) throw new PdfWrongPassword()

  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (ref.objectNumber === (encryptEntry as PDFRef).objectNumber) continue
    decryptIndirectObject(doc, ref, object, fileKey)
  }

  doc.context.trailerInfo.Encrypt = undefined
  const bytes = await doc.save({ useObjectStreams: false })
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    usedOwnerPassword,
  }
}

function decryptIndirectObject(doc: PDFDocument, ref: PDFRef, object: unknown, fileKey: Uint8Array) {
  if (object instanceof PDFStream) {
    const dict = object.dict
    const contents = object instanceof PDFRawStream ? object.contents : object.getContents()
    let plain: Uint8Array
    if (contents.length > 32) {
      const iv = contents.slice(0, 16)
      plain = unpadPkcs7(aesCbcDecryptNoPad(contents.slice(16), fileKey, iv))
    } else {
      plain = contents
    }

    walkObject(dict, (value) => {
      if (isStringObject(value)) {
        return PDFHexString.of(bytesToHex(decryptStringBody(stringBytes(value), fileKey)))
      }
      return value
    })

    dict.set(PDFName.of('Length'), PDFNumber.of(plain.length))
    doc.context.assign(ref, PDFRawStream.of(dict, plain))
    return
  }

  if (object instanceof PDFDict || object instanceof PDFArray) {
    walkObject(object, (value) => {
      if (isStringObject(value)) {
        return PDFHexString.of(bytesToHex(decryptStringBody(stringBytes(value), fileKey)))
      }
      return value
    })
    doc.context.assign(ref, object as never)
  }
}

function decryptStringBody(data: Uint8Array, fileKey: Uint8Array): Uint8Array {
  if (data.length <= 16) return data
  const iv = data.slice(0, 16)
  const plain = aesCbcDecryptNoPad(data.slice(16), fileKey, iv)
  return unpadPkcs7(plain)
}

function unpadPkcs7(data: Uint8Array): Uint8Array {
  if (!data.length) return data
  const padding = data[data.length - 1]
  if (padding < 1 || padding > 16 || padding > data.length) return data
  for (let i = data.length - padding; i < data.length; i++) {
    if (data[i] !== padding) return data
  }
  return data.slice(0, data.length - padding)
}

/** Pixel-level unlock for legacy encryption: re-render pages without protection. */
export async function unlockViaRaster(file: File, password: string, dpi = 150): Promise<Blob> {
  const { rasterizePdf, pdfFromJpegs } = await import('./pdf')
  const pages = await rasterizePdf(file, { dpi, password })
  return pdfFromJpegs(pages)
}

export { aesCbcEncryptPadded, aesCbcDecryptPadded }
