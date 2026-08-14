import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable, query, run } from './db.ts'
import { buildLiveDatabaseFingerprint } from '../../src/lib/billing/live-db-fingerprint.ts'

const DB = 'carebook_billing_ops_gate_test'
const available = postgresAvailable()
const prepareScript = join(import.meta.dirname, '..', '..', 'ops', 'billing', 'prepare-write-pause.sql')
const resumeScript = join(import.meta.dirname, '..', '..', 'ops', 'billing', 'resume-billing-writes.sql')
const TOKEN = 'test-only-ops-bypass-token-32-bytes'
const SOURCE = 'source-fingerprint'
const PLAN = 'plan-fingerprint'
const REPORT = 'report-checksum'

function psqlFile(file: string, variables: Record<string, string>): string {
  const args = ['-d', DB, '-X', '-q', '-v', 'ON_ERROR_STOP=1']
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`)
  args.push('-f', file)
  return execFileSync('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function fingerprint(): string {
  return query(DB, `select private.billing_source_fingerprint_v1()`)
}

function restLikeSource(): Record<string, Record<string, unknown>[]> {
  return JSON.parse(query(DB, `select jsonb_build_object(
    'clinics', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from clinics row),
    'patients', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from patients row),
    'appointment_types', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from appointment_types row),
    'global_settings', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from global_settings row),
    'package_templates', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from package_templates row),
    'appointments', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from appointments row),
    'packages', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from packages row),
    'payments', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from payments row),
    'appointment_payments', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from appointment_payments row),
    'package_session_allocations', (select coalesce(jsonb_agg(to_jsonb(row) order by id),'[]') from package_session_allocations row)
  )`))
}

function prepare(expected: string): void {
  psqlFile(prepareScript, {
    expected_live_db_fingerprint: expected,
    source_row_counts: query(DB, `select jsonb_build_object(
      'clinics',(select count(*) from clinics),'patients',(select count(*) from patients),
      'appointment_types',(select count(*) from appointment_types),'global_settings',(select count(*) from global_settings),
      'package_templates',(select count(*) from package_templates),'appointments',(select count(*) from appointments),
      'packages',(select count(*) from packages),'payments',(select count(*) from payments),
      'appointment_payments',(select count(*) from appointment_payments),
      'package_session_allocations',(select count(*) from package_session_allocations))`),
    source_fingerprint: SOURCE,
    plan_fingerprint: PLAN,
    report_checksum: REPORT,
    bypass_token: TOKEN,
  })
}

function forceResumeFixture(): void {
  run(DB, `
    update private.billing_ops_gate set status='resumed', resumed_at=now() where id=true;
    do $do$ begin execute format('alter role %I in database %I reset carebook.ops.bypass_token', session_user, current_database()); end $do$;
  `)
}

before(() => {
  if (!available) return
  buildDatabaseThrough(DB, '029_patient_appointment_history_index.sql')
  run(DB, `
    insert into public.clinics (id,name) values ('10000000-0000-4000-8000-000000000001','Amruta');
    insert into public.patients (id,clinic_id,name,phone) values
      ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Target','1'),
      ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Unrelated','2');
  `)
})

after(() => { if (available) dropDatabase(DB) })

test('preflight persists a pause when unrelated live data drift mismatches the GET-derived fingerprint', { skip: !available }, () => {
  // Bootstrap once to expose the canonical SQL fingerprint function, then resume the fixture gate.
  assert.throws(() => prepare('0'.repeat(64)), /database fingerprint\/count mismatch/i)
  assert.equal(query(DB, `select status from private.billing_ops_gate where id = true`), 'paused_mismatch')
  assert.equal(buildLiveDatabaseFingerprint(restLikeSource()), fingerprint(), 'GET-row mirror exactly matches SQL canonical fingerprint')
  assert.throws(
    () => run(DB, `update public.patients set name='Operator must remain blocked' where id='20000000-0000-4000-8000-000000000002'`),
    /billing writes are paused/i,
    'the persisted operator token must not bypass a mismatched gate in a fresh connection',
  )
  assert.throws(() => run(DB, `set role authenticated; update public.patients set name='Blocked' where id='20000000-0000-4000-8000-000000000002'`), /billing writes are paused/i)

  forceResumeFixture()
  const beforeDrift = fingerprint()
  run(DB, `insert into public.payments (clinic_id,patient_id,amount,payment_method,date)
    values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',100,'cash','2026-08-15')`)
  assert.notEqual(fingerprint(), beforeDrift)
  assert.throws(() => prepare(beforeDrift), /database fingerprint\/count mismatch/i)
  assert.equal(query(DB, `select status from private.billing_ops_gate where id = true`), 'paused_mismatch')
})

test('installed guards fail closed when the durable gate row is missing', { skip: !available }, () => {
  run(DB, `delete from private.billing_ops_gate where id=true`)
  assert.throws(
    () => run(DB, `set role authenticated; update public.patients set name='Normal blocked without gate' where id='20000000-0000-4000-8000-000000000002'`),
    /write-pause gate is missing/i,
  )
  assert.throws(
    () => run(DB, `set carebook.ops.bypass_token='${TOKEN}'; update public.patients set name='Operator blocked without gate' where id='20000000-0000-4000-8000-000000000002'`),
    /write-pause gate is missing/i,
  )
  prepare(fingerprint())
})

test('verified pause blocks normal writes and permits only logged token-authorized migration writes', { skip: !available }, () => {
  forceResumeFixture()
  prepare(fingerprint())
  assert.equal(query(DB, `select status from private.billing_ops_gate where id = true`), 'paused_verified')
  assert.throws(() => run(DB, `set role authenticated; update public.appointments set fee=999`), /billing writes are paused/i)
  assert.throws(() => run(DB, `set role authenticated; update public.payments set amount=101 where patient_id='20000000-0000-4000-8000-000000000002'`), /billing writes are paused/i)

  run(DB, `set carebook.ops.bypass_token = '${TOKEN}'; update public.payments set amount=101 where patient_id='20000000-0000-4000-8000-000000000002'`)
  assert.equal(query(DB, `select count(*) from private.billing_ops_bypass_log where relation_name='payments'`), '1')

  applyMigrationsAfter(DB, '029_patient_appointment_history_index.sql')
  assert.equal(query(DB, `select to_regclass('public.billing_events') is not null`), 't')
})

test('resume refuses missing/stale/unsuccessful gates', { skip: !available }, () => {
  run(DB, `update private.billing_ops_gate set paused_at = now() - interval '25 hours', status='paused_verified' where id=true`)
  assert.throws(
    () => run(DB, `update public.patients set name='Blocked by stale verified gate' where id='20000000-0000-4000-8000-000000000002'`),
    /billing writes are paused/i,
  )
  run(DB, `update private.billing_ops_gate set status='corrections_applied' where id=true`)
  assert.throws(
    () => run(DB, `update public.patients set name='Blocked by stale corrected gate' where id='20000000-0000-4000-8000-000000000002'`),
    /billing writes are paused/i,
  )
  assert.throws(() => psqlFile(resumeScript, { bypass_token: TOKEN }), /stale|corrections have not completed/i)
  assert.notEqual(query(DB, `select status from private.billing_ops_gate where id=true`), 'resumed')
})
