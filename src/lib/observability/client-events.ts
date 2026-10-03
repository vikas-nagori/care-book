const OPERATIONS = ['PatientForm/save', 'PatientForm/submit', 'AppointmentForm/save', 'App/errorBoundary'] as const
export type ClientOperation = typeof OPERATIONS[number]
export type ClientEvent = { operation: ClientOperation; correlationId: string }
export function parseClientEvent(value: unknown): ClientEvent | null {
  if (!value || typeof value !== 'object') return null
  const { operation, correlationId } = value as Record<string, unknown>
  if (!OPERATIONS.includes(operation as ClientOperation) || typeof correlationId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationId)) return null
  return { operation: operation as ClientOperation, correlationId }
}

export function createEventLimiter() {
  const windows = new Map<string, { until: number; count: number }>()
  return (key: string, now: number) => {
    for (const [id, window] of windows) if (window.until <= now) windows.delete(id)
    const window = windows.get(key)
    if (window) {
      if (window.count >= 5) return false
      window.count++
    } else {
      // Fail closed at capacity. This is a per-instance noise brake, not a global quota.
      if (windows.size >= 5_000) return false
      windows.set(key, { until: now + 60_000, count: 1 })
    }
    return true
  }
}
