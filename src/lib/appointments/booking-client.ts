import type { BookingRequest, CreateAppointmentResult } from './booking-contract.ts'

export const BOOKING_TIMEOUT_MS = 30_000
// A healthy save answers in under 1.5s. iOS Safari can hold a POST on a silently dropped idle
// connection for ~13s before failing it, so a slower attempt is abandoned and resent sooner.
export const BOOKING_ATTEMPT_TIMEOUT_MS = 6_000
export const BOOKING_MAX_ATTEMPTS = 4
const BOOKING_RETRY_PAUSE_MS = 500

export class BookingTransportError extends Error {
  readonly code: 'BOOKING_TIMEOUT' | 'BOOKING_REQUEST_FAILED' | 'BOOKING_INVALID_RESPONSE'
  constructor(code: BookingTransportError['code']) {
    super(code)
    this.name = 'BookingTransportError'
    this.code = code
  }
}

/** Bounds the whole operation, even if a dependency ignores AbortSignal. */
export async function withBookingDeadline<T>(operation: PromiseLike<T>, timeoutMs = BOOKING_TIMEOUT_MS, controller?: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new BookingTransportError('BOOKING_TIMEOUT'))
      controller?.abort()
    }, timeoutMs)
  })
  try { return await Promise.race([operation, deadline]) }
  finally { clearTimeout(timer) }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseResult(value: unknown): CreateAppointmentResult {
  if (!value || typeof value !== 'object') throw new BookingTransportError('BOOKING_INVALID_RESPONSE')
  const result = value as Record<string, unknown>
  if (result.createdPatientId !== undefined && (typeof result.createdPatientId !== 'string' || !UUID.test(result.createdPatientId))) {
    throw new BookingTransportError('BOOKING_INVALID_RESPONSE')
  }
  if (result.success === true && Array.isArray(result.appointmentIds) && result.appointmentIds.length > 0
    && result.appointmentIds.length <= 100 && result.appointmentIds.every(id => typeof id === 'string' && UUID.test(id))) {
    return { success: true, appointmentIds: result.appointmentIds, createdPatientId: result.createdPatientId as string | undefined }
  }
  if (result.success === false && typeof result.errorCode === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(result.errorCode)
    && typeof result.message === 'string' && result.message.length <= 500
    && (result.conflictingDates === undefined || (Array.isArray(result.conflictingDates)
      && result.conflictingDates.length <= 100 && result.conflictingDates.every(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))))) {
    return {
      success: false, errorCode: result.errorCode, message: result.message,
      conflictingDates: result.conflictingDates as string[] | undefined,
      createdPatientId: result.createdPatientId as string | undefined,
    }
  }
  throw new BookingTransportError('BOOKING_INVALID_RESPONSE')
}

/** A normal fetch bypasses the Next router's server-action/refresh queue. No automatic writes are retried. */
export async function requestBooking(request: BookingRequest, mode: 'create' | 'status' = 'create', timeoutMs = BOOKING_TIMEOUT_MS): Promise<CreateAppointmentResult> {
  const controller = new AbortController()
  try {
    return await withBookingDeadline((async () => {
      const response = await fetch(`/api/appointments/bookings${mode === 'status' ? '/status' : ''}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request), signal: controller.signal, cache: 'no-store', redirect: 'error',
      })
      if (response.redirected) throw new BookingTransportError('BOOKING_INVALID_RESPONSE')
      let body: unknown
      try { body = await response.json() }
      catch { throw new BookingTransportError('BOOKING_INVALID_RESPONSE') }
      const result = parseResult(body)
      if (!response.ok && result.success) throw new BookingTransportError('BOOKING_INVALID_RESPONSE')
      return result
    })(), timeoutMs, controller)
  } catch (error) {
    if (error instanceof BookingTransportError) throw error
    throw new BookingTransportError('BOOKING_REQUEST_FAILED')
  }
}

type RetryOptions = {
  attemptTimeoutMs?: number
  totalTimeoutMs?: number
  maxAttempts?: number
  pauseMs?: number
  onRetry?: (code: BookingTransportError['code'], attempt: number) => void
  shouldRetry?: () => boolean
}

/**
 * Resends the identical request after a transport failure. Safe because the server derives every
 * primary key from the correlation ID and reconciles before inserting: a resend of a committed
 * booking returns it, and concurrent copies race only on those keys. Any server answer is final.
 */
export async function createBookingWithRetry(request: BookingRequest, {
  attemptTimeoutMs = BOOKING_ATTEMPT_TIMEOUT_MS, totalTimeoutMs = BOOKING_TIMEOUT_MS,
  maxAttempts = BOOKING_MAX_ATTEMPTS, pauseMs = BOOKING_RETRY_PAUSE_MS, onRetry, shouldRetry,
}: RetryOptions = {}): Promise<CreateAppointmentResult> {
  const deadline = Date.now() + totalTimeoutMs
  for (let attempt = 1; ; attempt++) {
    const remaining = Math.max(0, deadline - Date.now())
    // The final attempt gets all remaining time so a slow but working network can still answer.
    const last = attempt >= maxAttempts || remaining <= attemptTimeoutMs
    try {
      return await requestBooking(request, 'create', last ? remaining : attemptTimeoutMs)
    } catch (error) {
      if (last || !(error instanceof BookingTransportError) || error.code === 'BOOKING_INVALID_RESPONSE'
        || (shouldRetry && !shouldRetry())) throw error
      onRetry?.(error.code, attempt)
      // A timeout has already waited; an immediate failure gets a brief pause before resending.
      if (error.code === 'BOOKING_REQUEST_FAILED') {
        await new Promise(resolve => setTimeout(resolve, Math.min(pauseMs, Math.max(0, deadline - Date.now()))))
      }
    }
  }
}
