import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { evaluateRoleAccess, type ProfileAccessShape } from '@/lib/auth-access'
import { CLINIC_TIME_ZONE, getZonedDate } from '@/lib/timezone'
import { logger } from '@/lib/logger'
import { isBookingCorrelationId, parseBookingRequest, type CreateAppointmentResult } from './booking-contract'
import { executeBooking, bookingDatabaseErrorCode } from './booking-service'
import { createBookingStore } from './booking-supabase'

const MAX_BODY_BYTES = 65536
async function readJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('Missing body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('Body too large') }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let position = 0
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export async function handleBookingRequest(request: Request, mode: 'create' | 'status'): Promise<Response> {
  const started = Date.now()
  let correlationId: string = randomUUID()
  const release = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12)
  const log = (phase: string, errorCode?: string) => {
    const meta = { correlationId, phase, durationMs: Date.now() - started, errorCode, release, mode, source: 'server' }
    if (errorCode) logger.warn('appointments/booking', 'Booking stage', meta)
    else logger.info('appointments/booking', 'Booking stage', meta)
  }
  const respond = (result: CreateAppointmentResult, status = 200) => Response.json(result, {
    status, headers: { 'x-correlation-id': correlationId, 'cache-control': 'no-store' },
  })
  const invalid = (status = 400) => {
    log('validation', 'BOOKING_INVALID_REQUEST')
    return respond({ success: false, errorCode: 'BOOKING_INVALID_REQUEST', message: 'Check the appointment details and try again.' }, status)
  }
  try {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return invalid(403)
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return invalid(415)
    let raw: unknown
    try { raw = await readJson(request) } catch { return invalid() }
    if (raw && typeof raw === 'object' && 'correlationId' in raw && isBookingCorrelationId(raw.correlationId)) correlationId = raw.correlationId.toLowerCase()
    log('received')
    const parsed = parseBookingRequest(raw)
    if (!parsed.success) return invalid()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      log('auth', 'SCHEDULE_UNAUTHORIZED')
      return respond({ success: false, errorCode: 'SCHEDULE_UNAUTHORIZED', message: 'Sign in again to manage appointments.' }, 401)
    }
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('id,role,clinic_id,status,clinic:clinics(status)').eq('id', user.id).maybeSingle()
    if (profileError || evaluateRoleAccess(profile as ProfileAccessShape | null, ['admin', 'staff']) !== 'authorized' || !profile?.clinic_id) {
      log('auth', 'SCHEDULE_UNAUTHORIZED')
      return respond({ success: false, errorCode: 'SCHEDULE_UNAUTHORIZED', message: 'You are not allowed to manage appointments.' }, 403)
    }
    log('auth')
    const result = await executeBooking(parsed.request, mode, {
      actorId: user.id, clinicId: profile.clinic_id, role: profile.role,
      today: getZonedDate(new Date(), CLINIC_TIME_ZONE),
      store: createBookingStore(supabase, profile.clinic_id), log,
    })
    if (result.success && mode === 'create') {
      // The booking has committed. A cache failure must never turn its response into a failed save.
      try {
        for (const path of ['/schedule', '/', '/billing']) revalidatePath(path)
        const patientId = result.createdPatientId ?? parsed.request.input.patientId
        if (patientId) revalidatePath(`/patients/${patientId}`)
      } catch {
        log('cache_revalidation', 'BOOKING_CACHE_REVALIDATION_FAILED')
      }
    }
    log('complete', result.success ? undefined : result.errorCode)
    const status = result.success ? 200 : result.errorCode === 'BOOKING_NOT_FOUND' ? 404
      : result.errorCode === 'BOOKING_UNCONFIRMED' ? 503
        : ['BOOKING_INTENT_MISMATCH', 'APPOINTMENT_CONFLICT'].includes(result.errorCode) ? 409 : 400
    return respond(result, status)
  } catch (error) {
    log('complete', bookingDatabaseErrorCode(error) ?? 'BOOKING_UNCONFIRMED')
    return respond({ success: false, errorCode: 'BOOKING_UNCONFIRMED', message: 'We could not confirm whether this appointment saved. Check its status before retrying.' }, 503)
  }
}
