import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../../../supabase/migrations/009_simplified_billing_credit_allocations.sql', import.meta.url),
  'utf8',
)

test('simplified billing migration records applied amounts and patient credit allocation', () => {
  assert.match(migration, /alter table public\.appointment_payments/i)
  assert.match(migration, /add column if not exists amount_applied/i)
  assert.match(migration, /create or replace function public\.allocate_patient_payment_credit/i)
  assert.match(migration, /sum\(appointment_payment_row\.amount_applied\)/i)
})

test('simplified billing migration tracks package sessions independently from payment rows', () => {
  assert.match(migration, /create table if not exists public\.package_session_allocations/i)
  assert.match(migration, /create or replace function public\.assign_patient_package_sessions/i)
  assert.match(migration, /alter table public\.packages/i)
  assert.match(migration, /add column if not exists per_session_amount/i)
})

test('simplified billing migration allocates sessions by date and time without month filtering', () => {
  assert.match(migration, /order by\s+appointment_row\.date,\s+appointment_row\.time/i)
  assert.doesNotMatch(migration, /date_trunc\('month'/i)
})
