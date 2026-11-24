import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createBookingStore } from './booking-supabase.ts'

/** Records every filter applied to the query builder. */
function recordingClient() {
  const calls: unknown[][] = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'neq', 'in']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder }
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
  const client = { from: (table: string) => { calls.push(['from', table]); return builder } }
  return { client: client as unknown as SupabaseClient, calls }
}

test('the booking conflict check ignores cancelled appointments (decision D4b)', async () => {
  const { client, calls } = recordingClient()
  const store = createBookingStore(client, 'clinic-1')
  await store.findConflicts('patient-1', '13:05', ['2026-12-01'])
  assert.deepEqual(calls, [
    ['from', 'appointments'],
    ['select', 'id,date'],
    ['eq', 'clinic_id', 'clinic-1'],
    ['eq', 'patient_id', 'patient-1'],
    ['eq', 'time', '13:05'],
    ['in', 'date', ['2026-12-01']],
    ['neq', 'status', 'cancelled'],
  ])
})
