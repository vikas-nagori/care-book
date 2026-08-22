export class ToolError extends Error {}

export class OAuthError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const SAFE_PATTERNS: Array<{ match: RegExp; message: string }> = [
  { match: /42501|not allowed|permission denied/i, message: 'You are not allowed to perform this action.' },
  { match: /violates row-level security/i, message: 'You do not have access to that record.' },
  { match: /not found|no rows/i, message: 'No matching record was found.' },
  { match: /duplicate key/i, message: 'A matching record already exists.' },
]

export function sanitizeToolError(error: unknown): string {
  if (error instanceof ToolError) return error.message
  const raw = error instanceof Error ? error.message : String(error)
  for (const { match, message } of SAFE_PATTERNS) {
    if (match.test(raw)) return message
  }
  return 'The operation failed.'
}
