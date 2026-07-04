import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/013_package_prefer_fee_matched_sessions.sql'
)

test('package allocation migration prefers fee-matched appointments before date order', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /create or replace function public\.assign_patient_package_sessions/i)
  // Fee-matched appointments sort ahead of mismatched ones, then fall back to date/time/id.
  assert.match(
    sql,
    /case when appointment_row\.fee = package_row\.per_session_amount then 0 else 1 end,\s*appointment_row\.date,\s*appointment_row\.time,\s*appointment_row\.id/i
  )
})
