import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/029_patient_appointment_history_index.sql',
)

test('patient history migration adds the deterministic pagination index', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  assert.match(
    sql,
    /create index if not exists appointments_patient_history_idx\s+on public\.appointments\s*\(patient_id, date desc, time desc, id desc\)/i,
  )
})
