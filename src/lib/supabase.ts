/**
 * Optional, minimal Supabase integration.
 *
 * Scope is deliberately tiny and matches the privacy policy:
 *   - authentication (email + password)
 *   - per-user settings metadata (theme, strict local mode, Ollama host/model)
 *   - optional processing job *status* rows (tool id, status, counts, timestamps)
 *
 * It never stores documents. There is no bucket, no storage upload and no document column: every
 * write goes through `assertNoDocumentPayload`, which throws if a payload looks like file data.
 *
 * Requests use plain `fetch` through the Strict Local Mode guard rather than the Supabase SDK, so
 *   a) the bundle stays small and no extra dependency/licence is introduced, and
 *   b) with Strict Local Mode on, cloud sync is *refused by the same guard as any other remote host*.
 *
 * Configuration comes from build-time env vars. Without them the whole module reports
 * `configured: false` and every function throws `SupabaseError('not-configured')`; the app keeps
 * working fully offline, which is the default deployment.
 */
import { guardedFetch, isLocalModeViolation } from './privacy'

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export type SupabaseErrorCode =
  | 'not-configured'
  | 'strict-local-mode'
  | 'network'
  | 'http'
  | 'document-payload'
  | 'no-session'

export class SupabaseError extends Error {
  readonly code: SupabaseErrorCode
  readonly status?: number

  constructor(code: SupabaseErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'SupabaseError'
    this.code = code
    this.status = status
  }
}

export interface CloudSession {
  accessToken: string
  refreshToken: string
  userId: string
  email: string
  expiresAt: number
}

/** Settings that are safe to sync: preferences only, never document content. */
export interface CloudSettings {
  theme: 'light' | 'dark'
  strictLocalMode: boolean
  ollamaHost: string
  ollamaModel: string
}

/** Job metadata only — no file names, no page text, no document bytes. */
export interface CloudJob {
  toolId: string
  status: 'queued' | 'running' | 'done' | 'failed'
  pageCount?: number
  outputCount?: number
  startedAt: string
  finishedAt?: string
  errorCode?: string
}

const STORAGE_KEY = 'folio.cloud.session'

function readEnv(name: string): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
  return (env[name] ?? '').trim()
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')
  if (!url || !anonKey) return null
  // Only an https origin (or localhost for development) is acceptable for an auth endpoint.
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) return null
  return { url: url.replace(/\/$/, ''), anonKey }
}

export function isSupabaseConfigured(): boolean {
  return supabaseConfig() !== null
}

/** Keys that would mean document content is being sent somewhere. */
const DOCUMENT_KEYS = ['file', 'files', 'blob', 'bytes', 'buffer', 'content', 'text', 'pages', 'document', 'pdf', 'base64']

export function assertNoDocumentPayload(payload: unknown, path = 'payload'): void {
  if (payload === null || payload === undefined) return
  if (typeof payload === 'string') {
    if (payload.length > 4096) {
      throw new SupabaseError('document-payload', `Refusing to sync ${path}: value is too large to be settings metadata.`)
    }
    return
  }
  if (typeof payload !== 'object') return
  if (payload instanceof Blob || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
    throw new SupabaseError('document-payload', `Refusing to sync ${path}: binary document data is not allowed.`)
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (DOCUMENT_KEYS.includes(key.toLowerCase())) {
      throw new SupabaseError('document-payload', `Refusing to sync ${path}.${key}: documents are never stored in the cloud.`)
    }
    assertNoDocumentPayload(value, `${path}.${key}`)
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
  config = supabaseConfig(),
): Promise<T> {
  if (!config) {
    throw new SupabaseError('not-configured', 'Cloud sync is not configured on this deployment. Folio works fully offline.')
  }
  const { token, headers, ...rest } = init
  const url = `${config.url}${path}`
  let response: Response
  try {
    response = await guardedFetch(
      url,
      {
        ...rest,
        headers: {
          apikey: config.anonKey,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(headers as Record<string, string> | undefined),
        },
      },
      new URL(config.url).host,
    )
  } catch (error) {
    if (isLocalModeViolation(error)) {
      throw new SupabaseError(
        'strict-local-mode',
        'Strict Local Mode is on, so Folio will not contact the cloud. Turn it off in the header to sync.',
      )
    }
    throw new SupabaseError('network', 'Could not reach the cloud service. Check your connection and try again.')
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new SupabaseError('http', describeHttpError(response.status, detail), response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function describeHttpError(status: number, body: string): string {
  if (status === 400 || status === 401) return 'Email or password is incorrect.'
  if (status === 403) return 'This account is not allowed to do that.'
  if (status === 404) return 'Cloud sync tables are missing — run the schema in DEPLOYMENT.md.'
  if (status === 429) return 'Too many attempts. Wait a moment and try again.'
  const short = body.slice(0, 200).replace(/\s+/g, ' ')
  return `Cloud request failed (${status})${short ? `: ${short}` : ''}.`
}

function saveSession(session: CloudSession | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable (private mode) — session stays in memory only */
  }
}

export function loadSession(): CloudSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CloudSession
    if (!parsed?.accessToken || !parsed?.userId) return null
    return parsed
  } catch {
    return null
  }
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string; email?: string }
}

function toSession(payload: TokenResponse): CloudSession {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    userId: payload.user.id,
    email: payload.user.email ?? '',
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  }
}

export async function signInWithPassword(email: string, password: string): Promise<CloudSession> {
  if (!email.includes('@')) throw new SupabaseError('http', 'Enter a valid email address.')
  if (password.length < 6) throw new SupabaseError('http', 'Password must be at least 6 characters.')
  const payload = await request<TokenResponse>('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  const session = toSession(payload)
  saveSession(session)
  return session
}

export async function refreshSession(session: CloudSession): Promise<CloudSession> {
  const payload = await request<TokenResponse>('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  })
  const next = toSession(payload)
  saveSession(next)
  return next
}

export async function signOut(session: CloudSession | null): Promise<void> {
  if (session) {
    await request<void>('/auth/v1/logout', { method: 'POST', token: session.accessToken }).catch(() => undefined)
  }
  saveSession(null)
}

function requireSession(session: CloudSession | null): CloudSession {
  if (!session) throw new SupabaseError('no-session', 'Sign in to sync your preferences.')
  return session
}

export async function saveSettings(session: CloudSession | null, settings: CloudSettings): Promise<void> {
  const auth = requireSession(session)
  const row = {
    user_id: auth.userId,
    theme: settings.theme,
    strict_local_mode: settings.strictLocalMode,
    ollama_host: settings.ollamaHost,
    ollama_model: settings.ollamaModel,
    updated_at: new Date().toISOString(),
  }
  assertNoDocumentPayload(row)
  await request<void>('/rest/v1/folio_settings?on_conflict=user_id', {
    method: 'POST',
    token: auth.accessToken,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  })
}

interface SettingsRow {
  theme?: 'light' | 'dark'
  strict_local_mode?: boolean
  ollama_host?: string
  ollama_model?: string
}

export async function loadSettings(session: CloudSession | null): Promise<CloudSettings | null> {
  const auth = requireSession(session)
  const rows = await request<SettingsRow[]>(
    `/rest/v1/folio_settings?user_id=eq.${encodeURIComponent(auth.userId)}&select=theme,strict_local_mode,ollama_host,ollama_model&limit=1`,
    { token: auth.accessToken },
  )
  const row = rows?.[0]
  if (!row) return null
  return {
    theme: row.theme === 'dark' ? 'dark' : 'light',
    strictLocalMode: row.strict_local_mode ?? true,
    ollamaHost: row.ollama_host ?? 'http://localhost:11434',
    ollamaModel: row.ollama_model ?? 'llama3',
  }
}

export async function recordJob(session: CloudSession | null, job: CloudJob): Promise<void> {
  const auth = requireSession(session)
  const row = { ...job, user_id: auth.userId }
  assertNoDocumentPayload(row)
  await request<void>('/rest/v1/folio_jobs', {
    method: 'POST',
    token: auth.accessToken,
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  })
}

export async function listJobs(session: CloudSession | null, limit = 20): Promise<CloudJob[]> {
  const auth = requireSession(session)
  return request<CloudJob[]>(
    `/rest/v1/folio_jobs?user_id=eq.${encodeURIComponent(auth.userId)}&select=tool_id,status,page_count,output_count,started_at,finished_at,error_code&order=started_at.desc&limit=${Math.min(100, Math.max(1, limit))}`,
    { token: auth.accessToken },
  )
}

export function describeSupabaseState(): { configured: boolean; signedIn: boolean } {
  return { configured: isSupabaseConfigured(), signedIn: loadSession() !== null }
}
