import { reportClientError } from './observability/report-client-error.ts'

const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_PATTERN =
  /(^|_)(email|phone|mobile|address|note|notes|medical_history|name|amount|diagnostic|payload|body|details|hint|message|token|secret|password|cookie|authorization|apikey|api_key|service_role|session|jwt)($|_)/i
const RAW_OBJECT_KEY_PATTERN = /^(input|values|error|exception)$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// The sensitive-key pattern is anchored on `_` boundaries, but every input type in this
// codebase is camelCase and HTTP headers are kebab-case — so `passwordConfirmation` and
// `x-api-key` slipped straight through. Fold every convention onto the snake_case form the
// pattern was written against before matching.
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[-\s.]+/g, '_')
}
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const TOKEN_PATTERN = /\b(?:bearer\s+)?(?:eyJ[A-Za-z0-9_-]+|sb_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{32,})\b/gi

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return {
      name: 'Error',
      message: REDACTED,
    }
  }

  if (typeof value === 'bigint') return value.toString()

  if (typeof value === 'string') {
    return redactString(value)
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen))
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      RAW_OBJECT_KEY_PATTERN.test(key) || SENSITIVE_KEY_PATTERN.test(normalizeKey(key))
        ? REDACTED
        : (key === 'runId' || key === 'correlationId') && typeof entry === 'string' && UUID_PATTERN.test(entry)
          ? entry
          : redactValue(entry, seen),
    ])
  )
}

function redactString(value: string): string {
  return value
    .replace(/\b(?:authorization|cookie|set-cookie|x-api-key)\s*:\s*[^\r\n]+/gi, REDACTED)
    .replace(/\bbearer\s+\S+/gi, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED).replace(TOKEN_PATTERN, REDACTED)
}

export function redactLogMeta(meta: unknown): unknown {
  return redactValue(meta, new WeakSet<object>())
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = error.code
  return typeof code === 'string' && /^[A-Za-z0-9_]{2,48}$/.test(code) ? redactString(code) : undefined
}

const ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'AggregateError',
  'AuthError', 'AuthApiError', 'AuthRetryableFetchError', 'AuthSessionMissingError',
  'AuthInvalidTokenResponseError', 'AuthUnknownError', 'AuthWeakPasswordError',
])

function technicalError(error: unknown) {
  const fields = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const name = typeof fields.name === 'string' && ERROR_TYPES.has(fields.name) ? fields.name : 'UnknownError'
  const status = fields.status
  return {
    errorCode: errorCode(error), errorType: name,
    statusCode: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
  }
}

function emit(level: 'info' | 'warn' | 'error', context: string, message: string, meta?: Record<string, unknown>, error?: unknown) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(), level, context: redactString(context),
    message: redactString(message), ...(error !== undefined ? technicalError(error) : {}),
    ...(meta ? { meta: redactLogMeta(meta) } : {}),
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  // Arbitrary provider messages can contain patient data (e.g. constraint details).
  // Stable context + code identify the operation without exporting those payloads.
  error: (context: string, error: unknown, meta?: Record<string, unknown>) => {
    emit('error', context, 'Operation failed', meta, error)
    reportClientError(context)
  },
  warn: (context: string, messageOrError: unknown, meta?: Record<string, unknown>) =>
    typeof messageOrError === 'string'
      ? emit('warn', context, messageOrError, meta)
      : emit('warn', context, 'Operation warning', meta, messageOrError),
  info: (context: string, message: string, meta?: Record<string, unknown>) => emit('info', context, message, meta),
}
