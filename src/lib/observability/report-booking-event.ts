import { parseClientEvent, type BookingEventInput } from './client-events.ts'

export function reportBookingEvent(input: BookingEventInput): void {
  // This request bypasses the router action queue and never delays the booking.
  // Reporting can fail offline, after sign-out, or during navigation; do not retry or recurse.
  try {
    const event = parseClientEvent({ ...input, operation: 'AppointmentForm/booking' })
    if (!event || typeof fetch !== 'function') return
    void fetch('/api/telemetry', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event), keepalive: true,
    }).catch(() => {})
  } catch { /* Telemetry must not interrupt the original operation. */ }
}
