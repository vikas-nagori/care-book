const OPERATIONS = ['PatientForm/save', 'PatientForm/submit', 'AppointmentForm/save', 'App/errorBoundary'] as const
export type ClientOperation = typeof OPERATIONS[number]
const BOOKING_PHASES = [
  'submit', 'request', 'confirmed', 'rejected', 'timeout', 'unconfirmed',
  'status_check', 'retry', 'preparation_failed', 'options_failed',
] as const
const BOOKING_ERROR_CODES = new Set([
  'BOOKING_TIMEOUT', 'BOOKING_REQUEST_FAILED', 'BOOKING_INVALID_RESPONSE',
  'BOOKING_PREPARATION_FAILED', 'BOOKING_OPTIONS_FAILED', 'BOOKING_NOT_FOUND',
  'BOOKING_UNCONFIRMED', 'BOOKING_INVALID_REQUEST', 'BOOKING_INTENT_MISMATCH',
  'SCHEDULE_UNAUTHORIZED', 'SCHEDULE_MISSING_FIELDS', 'SCHEDULE_INVALID_RECURRENCE',
  'SCHEDULE_MISSING_PATIENT', 'PATIENT_MISSING_FIELDS', 'PATIENT_CREATE_FAILED',
  'APPOINTMENT_CONFLICT', 'APPOINTMENT_CREATE_FAILED',
])

export type BookingPhase = typeof BOOKING_PHASES[number]
export type BookingEventInput = {
  correlationId: string
  phase: BookingPhase
  durationMs?: number
  errorCode?: string
}
export type BookingEvent = BookingEventInput & { operation: 'AppointmentForm/booking' }
export type ClientEvent = { operation: ClientOperation; correlationId: string } | BookingEvent

export function parseClientEvent(value: unknown): ClientEvent | null {
  if (!value || typeof value !== 'object') return null
  const { operation, correlationId } = value as Record<string, unknown>
  if (typeof correlationId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationId)) return null
  if (OPERATIONS.includes(operation as ClientOperation)) return { operation: operation as ClientOperation, correlationId }
  if (operation !== 'AppointmentForm/booking') return null
  const { phase, durationMs, errorCode } = value as Record<string, unknown>
  if (!BOOKING_PHASES.includes(phase as BookingPhase)) return null
  if (durationMs !== undefined && (typeof durationMs !== 'number'
    || !Number.isInteger(durationMs) || durationMs < 0 || durationMs > 600_000)) return null
  const safeErrorCode = typeof errorCode === 'string' && (
    BOOKING_ERROR_CODES.has(errorCode)
    || /^(?:[0-9][0-9A-Z]|HV|P0|XX)[0-9A-Z]{3}$/.test(errorCode)
    || /^PGRST[0-9]{3}$/.test(errorCode)
  ) ? errorCode : undefined
  return {
    operation, correlationId, phase: phase as BookingPhase,
    ...(durationMs !== undefined ? { durationMs: durationMs as number } : {}),
    ...(safeErrorCode ? { errorCode: safeErrorCode } : {}),
  }
}

export function createEventLimiter(limit = 5) {
  const windows = new Map<string, { until: number; count: number }>()
  return (key: string, now: number) => {
    for (const [id, window] of windows) if (window.until <= now) windows.delete(id)
    const window = windows.get(key)
    if (window) {
      if (window.count >= limit) return false
      window.count++
    } else {
      // Fail closed at capacity. This is a per-instance noise brake, not a global quota.
      if (windows.size >= 5_000) return false
      windows.set(key, { until: now + 60_000, count: 1 })
    }
    return true
  }
}
