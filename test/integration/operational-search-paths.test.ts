import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable, query, run } from './db.ts'

const DB = 'carebook_it_operational_paths'
const skip = !postgresAvailable()
before(() => {
  if (skip) return
  buildDatabaseThrough(DB, '045_patient_referral_google_patient_other.sql')
  // This operator-installed helper exists in production but not the historical repo schema.
  run(DB, `create function private.billing_fp_encode(p_value text) returns text language sql immutable parallel safe
    as $$ select case when p_value is null then '-1:' else octet_length(p_value)::text || ':' || p_value end $$;
    create function public.octet_length(text) returns integer language sql as $$ select 999 $$;`)
  applyMigrationsAfter(DB, '045_patient_referral_google_patient_other.sql')
})
after(() => { if (!skip) dropDatabase(DB) })
test('fingerprint encoding cannot resolve a caller-controlled shadow of a builtin', { skip }, () => {
  assert.equal(query(DB, `set search_path = public, pg_catalog; select private.billing_fp_encode('é')`), '2:é')
  assert.equal(query(DB, `select private.billing_fp_encode(null)`), '-1:')
  assert.equal(query(DB, `select private.billing_fp_encode('')`), '0:')
})
test('updated timestamp trigger pins its path and still updates records', { skip }, () => {
  assert.equal(query(DB, `select proconfig::text from pg_proc where oid = 'public.update_updated_at()'::regprocedure`), '{search_path=pg_catalog}')
  const clinic = query(DB, `insert into clinics(name) values ('Timestamp test') returning id`)
  const id = query(DB, `insert into patients(clinic_id,name,phone) values ('${clinic}','Timestamp patient','1') returning id`)
  run(DB, `update patients set updated_at='2000-01-01' where id='${id}'`)
  assert.equal(query(DB, `select (updated_at > '2026-01-01')::text from patients where id='${id}'`), 'true')
})
