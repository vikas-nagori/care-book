import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/012_record_payment_drop_unused_params.sql'
)

test('record_payment migration drops the unused appointment-ids and timing params', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  // Old 8-arg signature is dropped before recreation.
  assert.match(
    sql,
    /drop function if exists public\.record_payment\(uuid, uuid, numeric, text, date, text, text, uuid\[\]\)/i
  )
  // Recreated with exactly the trimmed 6-arg signature (no p_appointment_ids / p_payment_timing).
  assert.match(
    sql,
    /create or replace function public\.record_payment\(\s*p_patient_id uuid,\s*p_package_id uuid,\s*p_amount numeric,\s*p_payment_method text,\s*p_payment_date date,\s*p_notes text\s*\)/i
  )
  // ...and re-granted with the matching 6-arg signature.
  assert.match(sql, /grant execute on function public\.record_payment\(uuid, uuid, numeric, text, date, text\)/i)
  // Allocation is still delegated to the patient-wide credit allocator.
  assert.match(sql, /perform public\.allocate_patient_payment_credit\(p_patient_id\)/i)
})
