import { parseClientEvent } from './client-events.ts'

const lastSent = new Map<string, number>()

export function reportClientError(operation: string): void {
  if (typeof window === 'undefined' || typeof crypto.randomUUID !== 'function') return
  const event = parseClientEvent({ operation, correlationId: crypto.randomUUID() })
  if (!event) return
  const now = Date.now()
  if (now - (lastSent.get(operation) ?? 0) < 60_000) return
  lastSent.set(operation, now)
  // Fixed payload only: no exception messages, patient/form data, URL or user identifier.
  void fetch('/api/telemetry', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event), keepalive: true,
  }).catch(() => { /* Reporting must never interrupt the user's operation or recurse. */ })
}
