import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import {
  applyMigrationsAfter,
  buildDatabaseThrough,
  dropDatabase,
  postgresAvailable,
  query,
  queryAs,
  seedUser,
} from './db.ts'

const DB = 'carebook_billing_creation_audit_test'
const available = postgresAvailable()
let clinicId = ''
let otherClinicId = ''
let adminId = ''
let staffId = ''
let patientId = ''
let otherPatientId = ''
let clinicTypeId = ''
let legacyPackageId = ''
let legacyPaymentId = ''

function rpc(actorId: string, sql: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, actorId, `select ${sql}`)) as Record<string, unknown>
}

before(() => {
  if (!available) return
  buildDatabaseThrough(DB, '033_soft_delete_user_profiles.sql')
  clinicId = query(DB, `insert into clinics (name) values ('Creation Audit') returning id`)
  otherClinicId = query(DB, `insert into clinics (name) values ('Other Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId, 'creation-admin@test.local')
  staffId = seedUser(DB, 'staff', clinicId, 'creation-staff@test.local')
  patientId = query(DB, `insert into patients (clinic_id,name,phone) values ('${clinicId}','Patient','1') returning id`)
  otherPatientId = query(DB, `insert into patients (clinic_id,name,phone) values ('${otherClinicId}','Other','2') returning id`)
  clinicTypeId = query(DB, `select id from appointment_types where clinic_id='${clinicId}' and name='Clinic'`)
  legacyPackageId = query(DB, `insert into packages (
      clinic_id,patient_id,name,total_sessions,total_amount,per_session_amount,paid_amount,
      appointment_type_id,starts_on,billing_version
    ) values ('${clinicId}','${patientId}','Legacy',1,100,100,100,'${clinicTypeId}',current_date,2)
    returning id`)
  legacyPaymentId = query(DB, `insert into payments (
      clinic_id,patient_id,package_id,amount,payment_method,date,funding_scope,status,billing_version
    ) values ('${clinicId}','${patientId}','${legacyPackageId}',100,'cash',current_date,'package','posted',2)
    returning id`)
  applyMigrationsAfter(DB, '033_soft_delete_user_profiles.sql')
})

after(() => { if (available) dropDatabase(DB) })

test('legacy package and receipt creation have explicit unknown-origin semantics', { skip: !available }, () => {
  assert.equal(query(DB, `select creation_origin || '/' || coalesce(created_by::text,'unknown') from packages where id='${legacyPackageId}'`), 'legacy_unknown/unknown')
  assert.equal(query(DB, `select creation_origin || '/' || coalesce(created_by::text,'unknown') from payments where id='${legacyPaymentId}'`), 'legacy_unknown/unknown')
})

test('new actorless database inserts use audited system origin instead of legacy origin', { skip: !available }, () => {
  const packageId = query(DB, `insert into packages (
      clinic_id,patient_id,name,total_sessions,total_amount,per_session_amount,paid_amount,
      appointment_type_id,starts_on,billing_version
    ) values ('${clinicId}','${patientId}','System package',1,75,75,0,'${clinicTypeId}',current_date,2)
    returning id`)
  const paymentId = query(DB, `insert into payments (
      clinic_id,patient_id,amount,payment_method,date,funding_scope,status,billing_version
    ) values ('${clinicId}','${patientId}',25,'cash',current_date,'ordinary','posted',2)
    returning id`)

  assert.equal(query(DB, `select creation_origin || '/' || coalesce(created_by::text,'unknown') from packages where id='${packageId}'`), 'system/unknown')
  assert.equal(query(DB, `select creation_origin || '/' || coalesce(created_by::text,'unknown') from payments where id='${paymentId}'`), 'system/unknown')
  assert.equal(query(DB, `select count(*) from billing_events where actor_id is null and event_type='package_created' and entity_id='${packageId}' and details->>'creationOrigin'='system'`), '1')
  assert.equal(query(DB, `select count(*) from billing_events where actor_id is null and event_type='payment_recorded' and entity_id='${paymentId}' and details->>'creationOrigin'='system'`), '1')
})

test('standalone and package receipt RPCs capture actor and append immutable creation events', { skip: !available }, () => {
  const standalone = rpc(adminId, `public.record_payment_v2('${patientId}','ordinary',null,25,'cash',current_date,'standalone')`)
  assert.equal(standalone.success, true)
  const packageEntry = rpc(adminId, `public.record_billing_entry_v2(
    '${patientId}','package_with_payment','Audited package',2,100,'${clinicTypeId}',current_date,
    200,'upi',current_date,'package path')`)
  assert.equal(packageEntry.success, true)

  assert.equal(query(DB, `select created_by || '/' || creation_origin from payments where id='${standalone.paymentId}'`), `${adminId}/rpc`)
  assert.equal(query(DB, `select created_by || '/' || creation_origin from packages where id='${packageEntry.packageId}'`), `${adminId}/rpc`)
  assert.equal(query(DB, `select created_by || '/' || creation_origin from payments where id='${packageEntry.paymentId}'`), `${adminId}/rpc`)
  assert.equal(query(DB, `select count(*) from billing_events where actor_id='${adminId}' and event_type='payment_recorded' and entity_id in ('${standalone.paymentId}','${packageEntry.paymentId}')`), '2')
  assert.equal(query(DB, `select count(*) from billing_events where actor_id='${adminId}' and event_type='package_created' and entity_id='${packageEntry.packageId}' and details->>'appointmentTypeId'='${clinicTypeId}' and (details->>'totalSessions')::int=2`), '1')

  assert.throws(() => query(DB, `update payments set created_by='${staffId}' where id='${standalone.paymentId}'`), /creation audit metadata is immutable/i)
  assert.throws(() => query(DB, `update packages set creation_origin='legacy_unknown' where id='${packageEntry.packageId}'`), /creation audit metadata is immutable/i)
})

test('creation auditing does not weaken staff or cross-clinic RPC rejection', { skip: !available }, () => {
  assert.equal(rpc(staffId, `public.record_payment_v2('${patientId}','ordinary',null,10,'cash',current_date,null)`).success, false)
  assert.equal(rpc(adminId, `public.record_payment_v2('${otherPatientId}','ordinary',null,10,'cash',current_date,null)`).success, false)
  assert.throws(
    () => query(DB, `insert into payments (
      clinic_id,patient_id,amount,payment_method,date,funding_scope,status,billing_version,created_by,creation_origin
    ) values ('${clinicId}','${patientId}',10,'cash',current_date,'ordinary','posted',2,'${staffId}','rpc')`),
    /creation actor can only be captured by an authenticated billing RPC/i,
  )
})

test('soft deletion retains receipt/package creators and their event actor', { skip: !available }, () => {
  const created = rpc(adminId, `public.record_billing_entry_v2(
    '${patientId}','package_with_payment','Retained actor',1,100,'${clinicTypeId}',current_date,
    100,'cash',current_date,null)`)
  const deleterId = seedUser(DB, 'admin', clinicId, 'deleter@test.local')
  query(DB, `set request.jwt.claim.role='service_role'; update profiles set status='deleted', deleted_at=now(), deleted_by='${deleterId}', deletion_reason='left clinic' where id='${adminId}'; reset request.jwt.claim.role`)

  assert.equal(query(DB, `select created_by from packages where id='${created.packageId}'`), adminId)
  assert.equal(query(DB, `select created_by from payments where id='${created.paymentId}'`), adminId)
  assert.equal(query(DB, `select actor_id from billing_events where event_type='package_created' and entity_id='${created.packageId}'`), adminId)
  assert.throws(() => query(DB, `delete from auth.users where id='${adminId}'`), /cannot be hard-deleted|history|foreign key/i)
})
