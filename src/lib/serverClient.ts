/**
 * Browser client for Folio's processing API.
 *
 * Every tool call becomes a server job: create → upload → start → poll → download.
 * The browser never processes documents; it only orchestrates and renders previews.
 */

export interface ServerOutput {
  name: string
  blob: Blob
  type: string
  size: number
}

export interface ServerResult {
  outputs: ServerOutput[]
  meta: Record<string, unknown> | null
  warnings: string[]
}

export interface RunReporter {
  onProgress?: (percent: number, stage?: string) => void
  signal?: AbortSignal
}

export class ProcessingError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ProcessingError'
    this.status = status
  }
}

interface JobState {
  jobId: string
  status: 'created' | 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  stage: string
  progress: number
  error: string | null
  warnings: string[]
  outputs: { index: number; name: string; size: number; type: string; downloadUrl: string }[]
  meta?: Record<string, unknown> | null
}

const POLL_MS = 350

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProcessingError(text.slice(0, 200) || `Unexpected response (${response.status})`, response.status)
  }
}

async function fail(response: Response): Promise<never> {
  let message = `Processing failed (${response.status})`
  try {
    const body = (await response.json()) as { error?: string }
    if (body?.error) message = body.error
  } catch {
    /* keep the status-based message */
  }
  throw new ProcessingError(message, response.status)
}

function nameOf(file: File | Blob, index: number): string {
  const candidate = (file as File).name
  return typeof candidate === 'string' && candidate ? candidate : `input-${index + 1}.bin`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run one tool on Folio's server and return the produced files.
 * Throws ProcessingError with the server's message for any failure.
 */
export async function runTool(
  tool: string,
  files: (File | Blob)[] = [],
  options: Record<string, unknown> = {},
  reporter: RunReporter = {},
): Promise<ServerResult> {
  const { onProgress, signal } = reporter
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  const created = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool,
      options,
      files: files.map((file, index) => ({ name: nameOf(file, index), size: file.size })),
    }),
    signal,
  })
  if (!created.ok) await fail(created)
  const job = await readJson<{ jobId: string; uploads: { index: number; name: string; url: string }[] }>(created)

  const cancel = () => {
    void fetch(`/api/jobs/${job.jobId}/cancel`, { method: 'POST' }).catch(() => undefined)
  }
  signal?.addEventListener('abort', cancel, { once: true })

  try {
    onProgress?.(2, 'Uploading')
    for (const slot of job.uploads) {
      const source = files[slot.index]
      if (!source) continue
      const uploaded = await fetch(slot.url, {
        method: 'PUT',
        headers: { 'Content-Type': source.type || 'application/octet-stream' },
        body: source,
        signal,
      })
      if (!uploaded.ok) await fail(uploaded)
      onProgress?.(2 + ((slot.index + 1) / Math.max(1, job.uploads.length)) * 18, 'Uploading')
    }

    const started = await fetch(`/api/jobs/${job.jobId}/start`, { method: 'POST', signal })
    if (!started.ok) await fail(started)

    let state = await readJson<JobState>(started)
    while (state.status === 'queued' || state.status === 'running') {
      onProgress?.(Math.max(20, state.progress), state.stage)
      await sleep(POLL_MS)
      if (signal?.aborted) {
        cancel()
        throw new DOMException('Cancelled', 'AbortError')
      }
      const polled = await fetch(`/api/jobs/${job.jobId}`, { signal })
      if (!polled.ok) await fail(polled)
      state = await readJson<JobState>(polled)
    }

    if (state.status === 'cancelled') throw new DOMException('Cancelled', 'AbortError')
    if (state.status === 'error') throw new ProcessingError(state.error || 'Processing failed')

    const outputs: ServerOutput[] = []
    for (const output of state.outputs) {
      const response = await fetch(output.downloadUrl, { signal })
      if (!response.ok) await fail(response)
      const blob = await response.blob()
      outputs.push({
        name: output.name,
        blob,
        type: output.type || blob.type || 'application/octet-stream',
        size: output.size || blob.size,
      })
    }
    onProgress?.(100, 'Done')
    return { outputs, meta: state.meta ?? null, warnings: state.warnings ?? [] }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

/** First output as a Blob — the shape most tool handlers expect. */
export async function runToolBlob(
  tool: string,
  files: (File | Blob)[] = [],
  options: Record<string, unknown> = {},
  reporter: RunReporter = {},
): Promise<Blob> {
  const result = await runTool(tool, files, options, reporter)
  const first = result.outputs[0]
  if (!first) throw new ProcessingError('The server returned no output for this document')
  return first.blob
}

/** Ask the server which native engines are actually available. */
export async function engineStatus(): Promise<{
  engines: Record<string, string | null>
  tools: string[]
}> {
  const response = await fetch('/api/meta', { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new ProcessingError('Could not read server capabilities', response.status)
  const body = await readJson<{ engines: Record<string, string | null>; tools: string[] }>(response)
  return { engines: body.engines ?? {}, tools: body.tools ?? [] }
}
