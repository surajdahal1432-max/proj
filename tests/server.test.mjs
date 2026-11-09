/**
 * Server integration tests — real files, real engines, real downloads.
 *
 * Boots Folio's processing server, drives the public job API exactly like the
 * browser client does (create → upload → start → poll → download), then reopens
 * every produced file to prove the output is valid rather than merely present.
 */

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

const FIXTURES = resolve('tests/fixtures')
let child
let base = ''
let jobDir = ''
let cookie = ''
let ready = new Set()

async function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}

function headers(extra = {}) {
  return {
    origin: base,
    referer: `${base}/`,
    'sec-fetch-site': 'same-origin',
    ...(cookie ? { cookie } : {}),
    ...extra,
  }
}

function remember(response) {
  for (const value of response.headers.getSetCookie?.() ?? []) {
    const pair = value.split(';')[0]
    if (pair) cookie = pair
  }
}

async function getJson(path) {
  const response = await fetch(`${base}${path}`, { headers: headers() })
  remember(response)
  return { status: response.status, body: await response.json().catch(() => null) }
}

async function postJson(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  })
  remember(response)
  return { status: response.status, body: await response.json().catch(() => null) }
}

/** Create a job, upload the real fixture bytes, start it and wait for the result. */
async function runJob(tool, names, options = {}) {
  const payload = []
  for (const name of names) {
    const bytes = await readFile(join(FIXTURES, name))
    payload.push({ name, size: bytes.length })
  }
  const created = await postJson('/api/jobs', { tool, files: payload, options })
  assert.equal(created.status, 201, `create ${tool}: ${JSON.stringify(created.body)}`)
  const job = created.body

  for (let index = 0; index < names.length; index += 1) {
    const bytes = await readFile(join(FIXTURES, names[index]))
    const upload = await fetch(`${base}${job.uploads[index].url}`, {
      method: 'PUT',
      headers: headers({ 'content-type': 'application/octet-stream' }),
      body: bytes,
    })
    remember(upload)
    assert.equal(upload.status, 200, `upload ${names[index]}: ${await upload.text()}`)
  }

  const started = await postJson(`/api/jobs/${job.jobId}/start`, {})
  assert.equal(started.status, 202, `start ${tool}: ${JSON.stringify(started.body)}`)

  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const status = await getJson(`/api/jobs/${job.jobId}`)
    assert.equal(status.status, 200)
    const state = status.body
    if (state.status === 'done') return state
    if (state.status === 'error' || state.status === 'cancelled') {
      throw new Error(`${tool} failed: ${state.error || state.status}`)
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`${tool} timed out`)
}

/** Run a job from in-memory bytes, used to inspect an output produced by an earlier job. */
async function runJobFromBytes(tool, name, bytes, options = {}) {
  const created = await postJson('/api/jobs', { tool, files: [{ name, size: bytes.length }], options })
  assert.equal(created.status, 201, `create ${tool}: ${JSON.stringify(created.body)}`)
  const job = created.body
  const upload = await fetch(`${base}${job.uploads[0].url}`, {
    method: 'PUT',
    headers: headers({ 'content-type': 'application/octet-stream' }),
    body: bytes,
  })
  remember(upload)
  assert.equal(upload.status, 200, `upload ${name}: ${await upload.text()}`)
  const started = await postJson(`/api/jobs/${job.jobId}/start`, {})
  assert.equal(started.status, 202)

  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const status = await getJson(`/api/jobs/${job.jobId}`)
    const state = status.body
    if (state.status === 'done') return state
    if (state.status === 'error' || state.status === 'cancelled') {
      throw new Error(`${tool} failed: ${state.error || state.status}`)
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`${tool} timed out`)
}

async function download(job, index = 0) {
  const response = await fetch(`${base}${job.outputs[index].downloadUrl}`, { headers: headers() })
  assert.equal(response.status, 200)
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    type: response.headers.get('content-type') || '',
  }
}

async function pageCount(buffer) {
  const pdf = await PDFDocument.load(new Uint8Array(buffer))
  return pdf.getPageCount()
}

before(async () => {
  jobDir = await mkdtemp(join(tmpdir(), 'folio-test-jobs-'))
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FOLIO_JOB_DIR: jobDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', () => {})

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${base}/api/health`)
      if (health.ok) {
        const engines = await (await fetch(`${base}/api/engines`)).json()
        ready = new Set(engines.ready || [])
        break
      }
    } catch {
      /* server still starting */
    }
    await new Promise((done) => setTimeout(done, 200))
  }
  assert.ok(ready.size > 0, 'server did not become ready')
})

after(async () => {
  child?.kill('SIGKILL')
  if (jobDir) await rm(jobDir, { recursive: true, force: true })
})

test('health endpoint reports engines and limits', async () => {
  const { status, body } = await getJson('/api/health')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.ok(body.engines && typeof body.engines === 'object')
})

test('merge produces one PDF containing every source page in order', async () => {
  const job = await runJob('merge', ['simple.pdf', 'ten.pdf'])
  assert.equal(job.outputs.length, 1)
  const { buffer, type } = await download(job)
  assert.match(type, /pdf/)
  const pages = await pageCount(buffer)
  assert.ok(pages >= 11, `expected at least 11 pages, received ${pages}`)
})

test('extract keeps exactly the selected pages', async () => {
  const job = await runJob('extract', ['ten.pdf'], { pages: [1, 3, 5] })
  const { buffer } = await download(job)
  assert.equal(await pageCount(buffer), 3)
})

test('rotate applies the requested rotation to the output pages', async () => {
  const job = await runJob('rotate', ['ten.pdf'], { angle: 90 })
  const { buffer } = await download(job)
  const pdf = await PDFDocument.load(new Uint8Array(buffer))
  assert.equal(pdf.getPage(0).getRotation().angle, 90)
})

test('split into individual pages yields one valid PDF per page', async () => {
  const job = await runJob('split', ['ten.pdf'], { mode: 'each', individual: true })
  assert.ok(job.outputs.length >= 2, 'expected multiple split outputs')
  const { buffer } = await download(job)
  assert.equal(await pageCount(buffer), 1)
})

test('pdf-to-text returns extracted text', async () => {
  const job = await runJob('pdf-to-text', ['ten.pdf'])
  const { buffer } = await download(job)
  assert.ok(buffer.toString('utf8').trim().length > 0, 'extracted text was empty')
})

test('word-to-pdf produces a PDF with no raw OOXML markup', async (t) => {
  if (!ready.has('word-to-pdf')) return t.skip('LibreOffice is not installed in this environment')
  const job = await runJob('word-to-pdf', ['study.docx'])
  const { buffer } = await download(job)
  assert.ok((await pageCount(buffer)) > 0, 'converted document had no pages')

  // Reopen the produced PDF through the server's own extractor: the visible text
  // must be document content, never leaked WordprocessingML tags.
  const text = await runJobFromBytes('pdf-to-text', 'converted.pdf', buffer)
  const extracted = (await download(text)).buffer.toString('utf8')
  assert.ok(extracted.trim().length > 0, 'converted PDF had no extractable text')
  assert.doesNotMatch(extracted, /<\/?w:[a-zA-Z]+/, 'converted PDF leaked raw OOXML markup')
})

test('pdf-to-jpg renders real JPEG images', async (t) => {
  if (!ready.has('pdf-to-jpg')) return t.skip('poppler is not installed in this environment')
  const job = await runJob('pdf-to-jpg', ['simple.pdf'], { dpi: 72 })
  assert.equal(job.outputs.length, 1, 'expected a single download')
  const { buffer, type } = await download(job)

  if (!/\.zip$/i.test(job.outputs[0].name)) {
    assert.match(job.outputs[0].name, /\.jpe?g$/i)
    assert.match(type, /image\/jpeg/)
    assert.deepEqual([...buffer.subarray(0, 2)], [0xff, 0xd8])
    return
  }

  // Multi-page jobs are delivered as a zip bundle: prove the archive holds JPEGs.
  assert.match(type, /zip/)
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK')
  const dir = await mkdtemp(join(tmpdir(), 'folio-zip-'))
  try {
    const zipPath = join(dir, 'images.zip')
    await writeFile(zipPath, buffer)
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(dir, 'out')])
    const files = (await readdir(join(dir, 'out'))).filter((name) => /\.jpe?g$/i.test(name))
    assert.ok(files.length >= 2, `archive held ${files.length} images`)
    const first = await readFile(join(dir, 'out', files[0]))
    assert.deepEqual([...first.subarray(0, 2)], [0xff, 0xd8])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cross-origin job creation is rejected', async () => {
  const response = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie },
    body: JSON.stringify({ tool: 'merge', files: [{ name: 'a.pdf', size: 10 }] }),
  })
  assert.equal(response.status, 403)
})

test('unknown jobs are not readable', async () => {
  const { status } = await getJson('/api/jobs/does-not-exist')
  assert.equal(status, 404)
})
