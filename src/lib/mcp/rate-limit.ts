import { ToolError } from './errors.ts'

const calls = new Map<string, number[]>()
const limits = {
  read: { windowMs: 60_000, max: 60 },
  clinical: { windowMs: 60_000, max: 10 },
  billing: { windowMs: 60 * 60_000, max: 20 },
} as const

/**
 * Per-instance sliding window. This is a brake on runaway callers, not a security boundary: each
 * serverless instance keeps its own counters, so the effective ceiling scales with instance count.
 * Anything that must hold globally belongs in the database.
 */
function allow(key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  const recent = (calls.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs)
  if (recent.length >= max) return false
  recent.push(now)
  calls.set(key, recent)
  // Unbounded growth is the only real memory risk here, so drop windows that have fully drained.
  if (calls.size > 5_000) {
    for (const [existing, timestamps] of calls) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) calls.delete(existing)
    }
  }
  return true
}

export function enforceRateLimit(grantId: string, scope: 'read' | 'write:clinical' | 'write:billing') {
  const kind = scope === 'read' ? 'read' : scope === 'write:clinical' ? 'clinical' : 'billing'
  const limit = limits[kind]
  if (!allow(`${grantId}:${kind}`, limit.windowMs, limit.max)) {
    throw new ToolError('Too many MCP requests. Please try again shortly.')
  }
}

const OAUTH_LIMITS = {
  register: { windowMs: 60 * 60_000, max: 10 },
  token: { windowMs: 60_000, max: 30 },
  revoke: { windowMs: 60_000, max: 30 },
} as const

export type OAuthEndpoint = keyof typeof OAUTH_LIMITS

/**
 * The OAuth endpoints are unauthenticated by definition — dynamic client registration has no
 * caller to identify — so they are throttled per client IP. Without this, /oauth/register writes an
 * unbounded row per request and /oauth/token accepts unlimited code and refresh-token guesses.
 */
export function allowOAuthRequest(endpoint: OAuthEndpoint, clientIp: string): boolean {
  const limit = OAUTH_LIMITS[endpoint]
  return allow(`oauth:${endpoint}:${clientIp || 'unknown'}`, limit.windowMs, limit.max)
}

export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
