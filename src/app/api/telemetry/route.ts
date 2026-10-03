import { getCurrentProfile } from '@/lib/auth'
import { evaluateRoleAccess } from '@/lib/auth-access'
import { logger } from '@/lib/logger'
import { createEventLimiter, parseClientEvent } from '@/lib/observability/client-events'

const allow = createEventLimiter()
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return new Response(null, { status: 403 })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415 })
  const profile = await getCurrentProfile()
  if (!profile) return new Response(null, { status: 401 })
  if (evaluateRoleAccess(profile, ['admin', 'staff']) !== 'authorized') return new Response(null, { status: 403 })
  if (!allow(profile.id, Date.now())) return new Response(null, { status: 429 })
  let body: unknown
  try {
    const text = await request.text()
    if (text.length > 512) return new Response(null, { status: 413 })
    body = JSON.parse(text)
  } catch { return new Response(null, { status: 400 }) }
  const event = parseClientEvent(body)
  if (!event) return new Response(null, { status: 400 })
  logger.error(`client/${event.operation}`, { code: 'CLIENT_OPERATION_FAILED' }, {
    correlationId: event.correlationId,
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
    source: 'client',
  })
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
