import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/011_resync_billing_on_appointment_delete.sql'
)

test('delete re-sync migration wires sync_patient_billing_allocations to appointment deletes', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /after delete on public\.appointments/i)
  assert.match(sql, /for each row execute function public\.sync_patient_billing_allocations/i)
  assert.match(sql, /drop trigger if exists appointments_delete_sync_billing on public\.appointments/i)
  assert.match(sql, /create trigger appointments_delete_sync_billing/i)
})
