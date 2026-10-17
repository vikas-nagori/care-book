import { getCurrentProfile } from '@/lib/auth'
import { evaluateRoleAccess } from '@/lib/auth-access'
import { logger } from '@/lib/logger'
import { createEventLimiter, parseClientEvent } from '@/lib/observability/client-events'

const allowLegacy = createEventLimiter()
const allowBooking = createEventLimiter(60)
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return new Response(null, { status: 403 })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415 })
  const profile = await getCurrentProfile()
  if (!profile) return new Response(null, { status: 401 })
  if (evaluateRoleAccess(profile, ['admin', 'staff']) !== 'authorized') return new Response(null, { status: 403 })
  let body: unknown
  try {
    const text = await request.text()
    if (text.length > 512) return new Response(null, { status: 413 })
    body = JSON.parse(text)
  } catch { return new Response(null, { status: 400 }) }
  const event = parseClientEvent(body)
  if (!event) return new Response(null, { status: 400 })
  const isBooking = event.operation === 'AppointmentForm/booking'
  if (!(isBooking ? allowBooking : allowLegacy)(profile.id, Date.now())) return new Response(null, { status: 429 })
  const meta = {
    correlationId: event.correlationId,
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
    source: 'client',
  }
  if (isBooking) {
    const bookingMeta = {
      ...meta, phase: event.phase,
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    }
    const context = 'client/AppointmentForm/booking'
    if (['rejected', 'preparation_failed', 'options_failed'].includes(event.phase)) {
      logger.error(context, { code: event.errorCode ?? 'CLIENT_BOOKING_FAILED' }, bookingMeta)
    } else if (['timeout', 'unconfirmed'].includes(event.phase)) {
      logger.warn(context, 'Booking outcome is uncertain', bookingMeta)
    } else {
      logger.info(context, 'Booking stage reported', bookingMeta)
    }
  } else {
    logger.error(`client/${event.operation}`, { code: 'CLIENT_OPERATION_FAILED' }, meta)
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
