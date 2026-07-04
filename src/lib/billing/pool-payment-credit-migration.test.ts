import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/014_pool_payment_credit.sql'
)

test('pool-credit migration drops the one-payment-per-appointment index and pools FIFO', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  // A session may now be funded by more than one payment.
  assert.match(sql, /drop index if exists public\.appointment_payments_one_payment_per_appointment_idx/i)

  // allocate_patient_payment_credit is rebuilt around a pooled FIFO balance.
  assert.match(sql, /create or replace function public\.allocate_patient_payment_credit/i)
  assert.match(sql, /pool_total/i)
  // Coverage stays all-or-nothing per session: a session is skipped when its fee exceeds the pool.
  assert.match(sql, /exit when appointment_row\.fee > pool_total/i)
  // A session's fee is drawn across payments (one row per contributing payment).
  assert.match(sql, /draw := least\(payment_remaining\[i\], needed\)/i)
  assert.match(sql, /on conflict \(payment_id, appointment_id\) do nothing/i)
  // Both completed (paid) and upcoming (prepaid) passes are preserved.
  assert.match(sql, /set payment_status = 'paid'/i)
  assert.match(sql, /set payment_status = 'prepaid'/i)
})
