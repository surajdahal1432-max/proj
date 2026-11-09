/**
 * Regression tests for the Strict Local Mode privacy guard.
 *
 * These assert the guarantee the UI advertises: with Strict Local Mode on, no request can leave the
 * browser for a remote host, while the user's own loopback Ollama keeps working.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  LocalModeViolation,
  assertTransmissionAllowed,
  clearTransmissionLog,
  describeDestination,
  getTransmissionLog,
  guardedFetch,
  isLocalModeViolation,
  isLoopbackUrl,
  isStrictLocalMode,
  registerLocalModeProvider,
} from '../src/lib/privacy.ts'

let mode = true
registerLocalModeProvider(() => mode)

afterEach(() => {
  mode = true
  clearTransmissionLog()
})

test('fail-closed: strict local mode is on before the store registers itself', () => {
  // The module default provider must be conservative, so a provider that throws is treated as ON.
  registerLocalModeProvider(() => {
    throw new Error('store not ready')
  })
  assert.equal(isStrictLocalMode(), true)
  assert.throws(() => assertTransmissionAllowed('https://api.example.com/ocr'), LocalModeViolation)
  registerLocalModeProvider(() => mode)
})

test('loopback detection covers localhost, 127.0.0.1, ::1 and rejects remote hosts', () => {
  assert.equal(isLoopbackUrl('http://localhost:11434/api/tags'), true)
  assert.equal(isLoopbackUrl('http://127.0.0.1:11434/api/chat'), true)
  assert.equal(isLoopbackUrl('http://[::1]:11434/api/chat'), true)
  assert.equal(isLoopbackUrl('http://app.localhost:3000/'), true)
  assert.equal(isLoopbackUrl('https://api.openai.com/v1/chat'), false)
  assert.equal(isLoopbackUrl('http://192.168.1.10:11434/api/tags'), false)
  // A host that merely contains "localhost" must not pass.
  assert.equal(isLoopbackUrl('https://localhost.evil.example/api'), false)
  assert.equal(isLoopbackUrl('not a url'), false)
})

test('strict mode blocks a remote destination and records the refusal', () => {
  assert.throws(() => assertTransmissionAllowed('https://api.example.com/convert'), (error: unknown) => {
    assert.equal(isLocalModeViolation(error), true)
    assert.match((error as Error).message, /Strict Local Mode/)
    assert.match((error as Error).message, /Turn off Strict Local Mode/)
    return true
  })
  const log = getTransmissionLog()
  assert.equal(log.length, 1)
  assert.equal(log[0].allowed, false)
  assert.equal(log[0].reason, 'strict-local-blocked')
  assert.equal(log[0].url, 'https://api.example.com/convert')
})

test('strict mode allows loopback Ollama and records why', () => {
  assert.doesNotThrow(() => assertTransmissionAllowed('http://localhost:11434/api/chat'))
  const log = getTransmissionLog()
  assert.equal(log.length, 1)
  assert.equal(log[0].allowed, true)
  assert.equal(log[0].reason, 'loopback')
})

test('turning strict mode off allows remote transmission and is recorded as such', () => {
  mode = false
  assert.doesNotThrow(() => assertTransmissionAllowed('https://api.example.com/convert'))
  const log = getTransmissionLog()
  assert.equal(log.length, 1)
  assert.equal(log[0].allowed, true)
  assert.equal(log[0].reason, 'local-mode-off')
})

test('guardedFetch refuses before any request is made', async () => {
  mode = true
  let called = false
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    called = true
    return new Response('should not happen')
  }) as typeof fetch
  try {
    await assert.rejects(() => guardedFetch('https://api.example.com/upload'), LocalModeViolation)
    assert.equal(called, false, 'fetch must not be invoked when strict local mode blocks it')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('guardedFetch passes through for loopback hosts', async () => {
  mode = true
  let seen = ''
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    seen = String(url)
    return new Response('ok')
  }) as unknown as typeof fetch
  try {
    const response = await guardedFetch('http://127.0.0.1:11434/api/tags')
    assert.equal(await response.text(), 'ok')
    assert.equal(seen, 'http://127.0.0.1:11434/api/tags')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the violation message names the blocked destination', () => {
  const violation = new LocalModeViolation('api.example.com')
  assert.match(violation.message, /api\.example\.com/)
  assert.equal(violation.destination, 'api.example.com')
  assert.equal(violation.name, 'LocalModeViolation')
})

test('describeDestination reduces a URL to its host', () => {
  assert.equal(describeDestination('https://api.example.com:8443/path?x=1'), 'api.example.com:8443')
  assert.equal(describeDestination('garbage'), 'garbage')
})

test('the transmission log is bounded and clearable', () => {
  mode = false
  for (let i = 0; i < 120; i++) assertTransmissionAllowed(`https://api.example.com/${i}`)
  const log = getTransmissionLog()
  assert.equal(log.length, 100)
  assert.equal(log[log.length - 1].url, 'https://api.example.com/119')
  clearTransmissionLog()
  assert.equal(getTransmissionLog().length, 0)
})

test('the log is a copy, so callers cannot mutate guard state', () => {
  assertTransmissionAllowed('http://localhost:11434/api/tags')
  const snapshot = getTransmissionLog()
  snapshot.push({ url: 'https://evil.example', allowed: true, reason: 'local-mode-off', at: 0 })
  assert.equal(getTransmissionLog().length, 1)
})
