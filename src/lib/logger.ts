const TAG = '[CareBook]'

const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_PATTERN =
  /(^|_)(email|phone|mobile|address|note|notes|medical_history|token|secret|password|cookie|authorization|apikey|api_key|service_role|session|jwt)($|_)/i
const RAW_OBJECT_KEY_PATTERN = /^(input|values)$/i
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const TOKEN_PATTERN = /\b(?:bearer\s+)?(?:eyJ[A-Za-z0-9_-]+|sb_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{32,})\b/gi

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    }
  }

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
      RAW_OBJECT_KEY_PATTERN.test(key) || SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(entry, seen),
    ])
  )
}

function redactString(value: string): string {
  return value.replace(EMAIL_PATTERN, REDACTED).replace(TOKEN_PATTERN, REDACTED)
}

export function redactLogMeta(meta: unknown): unknown {
  return redactValue(meta, new WeakSet<object>())
}

export const logger = {
  error: (context: string, error: unknown, meta?: Record<string, unknown>) =>
    console.error(
      `${TAG} [${context}]`,
      error instanceof Error ? redactString(error.message) : redactLogMeta(error),
      meta ? redactLogMeta(meta) : ''
    ),
  warn: (context: string, message: string, meta?: Record<string, unknown>) =>
    console.warn(`${TAG} [${context}]`, redactString(message), meta ? redactLogMeta(meta) : ''),
  info: (context: string, message: string, meta?: Record<string, unknown>) =>
    console.log(`${TAG} [${context}]`, redactString(message), meta ? redactLogMeta(meta) : ''),
}
