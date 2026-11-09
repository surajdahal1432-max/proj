/**
 * Privacy guard for Strict Local Mode.
 *
 * Strict Local Mode is only meaningful if it is enforced in code, not just displayed in the header.
 * Every outbound request that can carry document content goes through `guardedFetch`, which is
 * fail-closed: if the mode is on and the destination is not the user's own machine, the request is
 * refused with a `LocalModeViolation` before any bytes leave the browser.
 *
 * Loopback destinations (localhost / 127.0.0.1 / [::1]) stay allowed even in Strict Local Mode,
 * because a locally running Ollama instance is still "on your device" — that is the whole point of
 * the offline AI workspace. A remote Ollama host is blocked, exactly like any other server.
 */

export class LocalModeViolation extends Error {
  readonly destination: string

  constructor(destination: string) {
    super(
      `Strict Local Mode is on, so Folio will not send anything to ${destination}. ` +
        'Turn off Strict Local Mode in the header to allow this request.',
    )
    this.name = 'LocalModeViolation'
    this.destination = destination
  }
}

export interface TransmissionRecord {
  url: string
  allowed: boolean
  reason: 'strict-local-blocked' | 'loopback' | 'local-mode-off'
  at: number
}

const MAX_LOG = 100
const log: TransmissionRecord[] = []

/**
 * Fail-closed default: until the store registers itself, Strict Local Mode is considered ON.
 * This guarantees no code path can transmit before the user's preference is known.
 */
let provider: () => boolean = () => true

export function registerLocalModeProvider(read: () => boolean): void {
  provider = read
}

export function isStrictLocalMode(): boolean {
  try {
    return provider()
  } catch {
    return true
  }
}

export function getTransmissionLog(): TransmissionRecord[] {
  return log.slice()
}

export function clearTransmissionLog(): void {
  log.length = 0
}

/** True for hosts that resolve to the user's own machine. */
export function isLoopbackUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '::1' ||
    host.endsWith('.localhost')
  )
}

function record(entry: Omit<TransmissionRecord, 'at'>): void {
  log.push({ ...entry, at: Date.now() })
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG)
}

/**
 * Throws before transmission when Strict Local Mode forbids this destination.
 * Call this at the top of any function that is about to send document data.
 */
export function assertTransmissionAllowed(url: string, destination = describeDestination(url)): void {
  if (!isStrictLocalMode()) {
    record({ url, allowed: true, reason: 'local-mode-off' })
    return
  }
  if (isLoopbackUrl(url)) {
    record({ url, allowed: true, reason: 'loopback' })
    return
  }
  record({ url, allowed: false, reason: 'strict-local-blocked' })
  throw new LocalModeViolation(destination)
}

export function describeDestination(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** fetch() wrapper that cannot run in Strict Local Mode against a remote host. */
export async function guardedFetch(
  url: string,
  init?: RequestInit,
  destination?: string,
): Promise<Response> {
  assertTransmissionAllowed(url, destination ?? describeDestination(url))
  return fetch(url, init)
}

export function isLocalModeViolation(error: unknown): error is LocalModeViolation {
  return error instanceof LocalModeViolation || (error as { name?: string } | null)?.name === 'LocalModeViolation'
}
