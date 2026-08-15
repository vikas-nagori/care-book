import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const manifestPath = join(process.cwd(), 'scripts/verify-migrations-030-034.sql')

test('migration proof manifest exists and emits one sanitized deterministic JSON document', () => {
  assert.equal(
    existsSync(manifestPath),
    true,
    'expected the read-only migration proof manifest to exist'
  )

  const sql = readFileSync(manifestPath, 'utf8')

  assert.match(sql, /jsonb_build_object/i)
  assert.match(sql, /jsonb_agg\(.+order by/i)
  assert.match(sql, /pg_get_functiondef|digest\(/i)
  assert.match(sql, /information_schema\.columns/i)
  assert.match(sql, /pg_constraint/i)
  assert.match(sql, /pg_indexes|pg_index/i)
  assert.match(sql, /pg_trigger/i)
  assert.match(sql, /pg_policies/i)
  assert.match(sql, /aclexplode|relacl|proacl/i)
  assert.match(sql, /count\(\*\)|sum\(/i)
  assert.match(sql, /appointments_sync_patient_billing_allocations/i)
  assert.match(sql, /packages_sync_patient_billing_allocations/i)
  assert.match(sql, /payments_sync_patient_billing_allocations/i)
  assert.match(sql, /appointments_delete_sync_billing/i)
  assert.match(sql, /packages_tenant_admin_access/i)
  assert.match(sql, /package_session_allocations_admin_access/i)
  assert.match(sql, /sync_patient_billing_allocations/i)
  assert.match(sql, /acldefault\('n'/i)
  assert.match(sql, /appointment_type_bootstrap/i)
  assert.match(sql, /charge_application_materialization/i)
  assert.match(sql, /appointment_reference_backfill/i)
  assert.match(sql, /creation_event_append_only/i)
  assert.doesNotMatch(sql, /\bselect\s+\*\s+from\s+public\.(?:appointments|packages|payments|patients|profiles)\b/i)
})
