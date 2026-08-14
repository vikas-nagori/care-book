import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDatabaseThrough,
  dropDatabase,
  postgresAvailable,
  query,
} from './db.ts'

const DB = 'carebook_it_billing_boundary'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

before(() => {
  if (hasPostgres) buildDatabaseThrough(DB, '031_auditable_billing_ledger_v2.sql')
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('migration 031 is an atomic secured billing boundary on its own', { skip }, () => {
  assert.equal(query(DB, `select has_function_privilege('anon', 'private.reconcile_patient_billing_v2(uuid)', 'execute')`), 'f')
  assert.equal(query(DB, `select has_function_privilege('authenticated', 'private.reconcile_patient_billing_v2(uuid)', 'execute')`), 'f')
  for (const signature of [
    'private.assign_patient_package_sessions(uuid)',
    'private.allocate_patient_payment_credit(uuid)',
    'private.reconcile_package_usage(uuid)',
    'private.sync_patient_billing_allocations()',
  ]) {
    assert.equal(query(DB, `select has_function_privilege('authenticated', '${signature}', 'execute')`), 'f')
    assert.equal(query(DB, `select has_function_privilege('anon', '${signature}', 'execute')`), 'f')
  }
  assert.equal(query(DB, `select has_table_privilege('authenticated', 'public.payment_applications', 'insert')`), 'f')
  assert.equal(query(DB, `select has_table_privilege('authenticated', 'public.packages', 'update')`), 'f')
  assert.equal(query(DB, `select count(*) from pg_policies where schemaname = 'public' and tablename in ('packages', 'payments') and cmd <> 'SELECT'`), '0')
  assert.equal(query(DB, `select count(*) from pg_trigger where tgname in ('payments_no_hard_delete_v2', 'packages_no_hard_delete_v2', 'payment_applications_no_delete', 'package_session_allocations_no_delete') and not tgisinternal`), '4')
})
