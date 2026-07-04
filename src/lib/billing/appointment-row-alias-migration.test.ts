import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/015_fix_appointment_row_alias_collision.sql'
)

test('alias-collision fix rebuilds both allocation functions', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /create or replace function public\.assign_patient_package_sessions/i)
  assert.match(sql, /create or replace function public\.allocate_patient_payment_credit/i)
})

test('appointments is never aliased as the appointment_row record variable', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  // The bug was reusing `appointment_row` as both a PL/pgSQL record variable and the
  // public.appointments table alias. The alias must now be distinct (e.g. `appt`).
  assert.doesNotMatch(sql, /appointments\s+appointment_row/i)

  // `appointment_row` survives only as the declared record/loop variable.
  assert.match(sql, /appointment_row record;/i)
  assert.match(sql, /from public\.appointments appt/i)
})
