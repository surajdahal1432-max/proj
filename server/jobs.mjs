import { mkdir, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CONFIG } from './config.mjs'

/** In-memory job registry. Nothing is persisted; temp dirs are the only state. */
const jobs = new Map()

const slots = {
  heavy: { active: 0, max: CONFIG.heavyConcurrency, waiters: [] },
  light: { active: 0, max: CONFIG.lightConcurrency, waiters: [] },
}

function acquire(weight, signal) {
  const pool = slots[weight] ?? slots.light
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError())
    const attempt = () => {
      if (pool.active < pool.max) {
        pool.active += 1
        resolve(() => {
          pool.active -= 1
          const next = pool.waiters.shift()
          if (next) next()
        })
        return true
      }
      return false
    }
    if (attempt()) return
    const onAbort = () => {
      const index = pool.waiters.indexOf(entry)
      if (index >= 0) pool.waiters.splice(index, 1)
      reject(new AbortError())
    }
    const entry = () => {
      signal?.removeEventListener?.('abort', onAbort)
      if (!attempt()) pool.waiters.push(entry)
    }
    pool.waiters.push(entry)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

export class AbortError extends Error {
  constructor(message = 'Job cancelled') {
    super(message)
    this.name = 'AbortError'
    this.code = 'CANCELLED'
  }
}

export function createJob({ sessionId, tool, options = {}, files = [] }) {
  const id = randomUUID()
  const job = {
    id,
    sessionId,
    tool,
    options,
    dir: join(CONFIG.jobRoot, id),
    inputDir: join(CONFIG.jobRoot, id, 'in'),
    outputDir: join(CONFIG.jobRoot, id, 'out'),
    files: files.map((file, index) => ({
      index,
      name: String(file?.name ?? `input-${index}`),
      declaredSize: Number(file?.size) || 0,
      path: null,
      size: 0,
      uploaded: false,
    })),
    outputs: [],
    status: 'created',
    stage: 'Awaiting upload',
    progress: 0,
    error: null,
    warnings: [],
    controller: new AbortController(),
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
  }
  jobs.set(id, job)
  return job
}

export function getJob(id) {
  return jobs.get(id) ?? null
}

export function ownsJob(job, sessionId) {
  return Boolean(job && sessionId && job.sessionId === sessionId)
}

export function publicJob(job) {
  return {
    jobId: job.id,
    tool: job.tool,
    status: job.status,
    stage: job.stage,
    progress: Math.round(job.progress),
    error: job.error,
    warnings: job.warnings,
    outputs: job.outputs.map((output, index) => ({
      index,
      name: output.name,
      size: output.size,
      type: output.type,
      downloadUrl: `/api/jobs/${job.id}/download/${index}`,
    })),
    expiresAt: job.expiresAt,
  }
}

export async function prepareJobDir(job) {
  await mkdir(job.inputDir, { recursive: true, mode: 0o700 })
  await mkdir(job.outputDir, { recursive: true, mode: 0o700 })
  return job
}

export function setProgress(job, progress, stage) {
  if (job.status === 'cancelled') return
  if (typeof progress === 'number' && Number.isFinite(progress)) {
    job.progress = Math.max(job.progress, Math.min(99, progress))
  }
  if (stage) job.stage = stage
}

export function warn(job, message) {
  if (message && !job.warnings.includes(message)) job.warnings.push(message)
}

export function fail(job, error) {
  job.status = 'error'
  job.error = typeof error === 'string' ? error : error?.message || 'Processing failed'
  job.stage = 'Failed'
  job.finishedAt = Date.now()
  job.expiresAt = job.finishedAt + CONFIG.resultTtlMs
}

export function succeed(job, outputs) {
  job.outputs = outputs
  job.status = 'done'
  job.progress = 100
  job.stage = 'Ready'
  job.finishedAt = Date.now()
  job.expiresAt = job.finishedAt + CONFIG.resultTtlMs
}

export function cancel(job) {
  if (!job) return false
  if (job.status === 'done' || job.status === 'error') return false
  job.status = 'cancelled'
  job.stage = 'Cancelled'
  job.error = 'Cancelled by user'
  job.finishedAt = Date.now()
  job.expiresAt = Date.now() + 5_000
  try {
    job.controller.abort()
  } catch {
    /* already aborted */
  }
  return true
}

/**
 * Run a handler under the concurrency gate with a hard deadline.
 * The handler receives the job and must honour `job.controller.signal`.
 */
export async function runJob(job, handler, weight = 'light') {
  job.status = 'queued'
  job.stage = 'Queued'
  const timeout = setTimeout(() => {
    job.error = 'Processing exceeded the time limit'
    try {
      job.controller.abort()
    } catch {
      /* noop */
    }
  }, CONFIG.jobTimeoutMs)

  let release = () => {}
  try {
    release = await acquire(weight, job.controller.signal)
    if (job.status === 'cancelled') throw new AbortError()
    job.status = 'running'
    job.startedAt = Date.now()
    job.stage = 'Processing'
    const outputs = await handler(job)
    if (job.status === 'cancelled') throw new AbortError()
    if (!Array.isArray(outputs) || outputs.length === 0) {
      throw new Error('The engine produced no output file')
    }
    succeed(job, outputs)
  } catch (error) {
    if (job.status === 'cancelled' || error?.name === 'AbortError') {
      job.status = 'cancelled'
      job.stage = 'Cancelled'
      job.error = job.error || 'Cancelled'
      job.finishedAt = Date.now()
      job.expiresAt = Date.now() + 5_000
    } else {
      fail(job, error)
    }
  } finally {
    clearTimeout(timeout)
    release()
  }
  return job
}

async function removeJobDir(job) {
  try {
    await rm(job.dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

export async function deleteJob(job) {
  jobs.delete(job.id)
  await removeJobDir(job)
}

/** Remove finished jobs past their TTL and jobs that never finished uploading. */
export async function sweep() {
  const now = Date.now()
  for (const job of jobs.values()) {
    const expired = job.expiresAt && now > job.expiresAt
    const abandoned =
      job.status === 'created' && now - job.createdAt > CONFIG.abandonedTtlMs
    if (expired || abandoned) {
      cancel(job)
      await deleteJob(job)
    }
  }
  // Clean orphaned directories from a previous process (crash / restart).
  try {
    const entries = await readdir(CONFIG.jobRoot)
    for (const entry of entries) {
      if (!jobs.has(entry)) await rm(join(CONFIG.jobRoot, entry), { recursive: true, force: true })
    }
  } catch {
    /* job root may not exist yet */
  }
}

export function startSweeper() {
  const timer = setInterval(() => {
    void sweep()
  }, CONFIG.sweepMs)
  timer.unref?.()
  return timer
}

export function stats() {
  return {
    jobs: jobs.size,
    running: [...jobs.values()].filter((job) => job.status === 'running').length,
    heavySlots: { active: slots.heavy.active, max: slots.heavy.max },
    lightSlots: { active: slots.light.active, max: slots.light.max },
  }
}
