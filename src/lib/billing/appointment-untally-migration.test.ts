import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/008_untally_cancelled_appointments.sql'
)

test('untally migration unlinks cancelled appointments from billing', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /create or replace function public\.untally_cancelled_appointment_billing/i)
  assert.match(sql, /new\.status = 'cancelled'/i)
  assert.match(sql, /delete from public\.appointment_payments/i)
  assert.match(sql, /set payment_status = 'unpaid'/i)
  assert.match(sql, /before update of status on public\.appointments/i)
  assert.match(sql, /where status = 'cancelled'/i)
})
