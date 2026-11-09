import { spawn } from 'node:child_process'
import { CONFIG } from '../config.mjs'

export class EngineError extends Error {
  constructor(message, { code = 'ENGINE_FAILED', stderr = '', engine = '' } = {}) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.stderr = stderr
    this.engine = engine
  }
}

const MAX_OUTPUT = 512 * 1024

/**
 * Run a native engine with a hard deadline, bounded output capture and
 * cancellation support. Never inherits the parent's stdio.
 */
export function run(command, args, options = {}) {
  const {
    cwd,
    timeoutMs = CONFIG.engineTimeoutMs,
    signal,
    env,
    engine = command,
    allowFailure = false,
  } = options

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new EngineError('Cancelled', { code: 'CANCELLED', engine }))
      return
    }

    let child
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, HOME: cwd || process.env.HOME, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(new EngineError(`${engine} could not be started: ${error.message}`, { engine }))
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      fn(value)
    }

    const kill = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }

    const onAbort = () => {
      kill()
      finish(reject, new EngineError('Cancelled', { code: 'CANCELLED', engine }))
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)
    timer.unref?.()
    signal?.addEventListener?.('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      finish(reject, new EngineError(`${engine} failed to start: ${error.message}`, { engine }))
    })
    child.on('close', (code) => {
      if (timedOut) {
        finish(
          reject,
          new EngineError(`${engine} exceeded the ${Math.round(timeoutMs / 1000)}s time limit`, {
            code: 'TIMEOUT',
            stderr,
            engine,
          }),
        )
        return
      }
      if (code !== 0 && !allowFailure) {
        const detail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300)
        finish(
          reject,
          new EngineError(`${engine} exited with code ${code}${detail ? `: ${detail}` : ''}`, {
            code: 'ENGINE_FAILED',
            stderr,
            engine,
          }),
        )
        return
      }
      finish(resolve, { code, stdout, stderr })
    })
  })
}

export function requireEngine(path, name) {
  if (!path) {
    throw new EngineError(
      `${name} is not installed on this server, so this tool cannot run here yet.`,
      { code: 'ENGINE_MISSING', engine: name },
    )
  }
  return path
}
