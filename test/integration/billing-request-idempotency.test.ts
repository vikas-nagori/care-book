// Migration 20261124132000 (G-14): record_payment_v2 / record_billing_entry_v2 take a request id,
// and a resend with an id that already succeeded returns the first result instead of recording
// the receipt again. Calls go through the `authenticated` role so the new grants are exercised.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAsAuthenticated, seedUser } from './db.ts'

const DB = 'carebook_it_billing_request_ids'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let otherClinicId = ''
let adminId = ''
let otherAdminId = ''
let staffId = ''
let typeId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Idempotency Clinic') returning id`)
  otherClinicId = query(DB, `insert into clinics (name) values ('Other Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  otherAdminId = seedUser(DB, 'admin', otherClinicId)
  staffId = seedUser(DB, 'staff', clinicId)
  typeId = query(DB, `select id from appointment_types where clinic_id = '${clinicId}' order by sort_order limit 1`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function newPatient(label: string): string {
  return query(DB, `insert into patients (clinic_id, name) values ('${clinicId}', '${label}') returning id`)
}

function rpc(userId: string, expr: string): Record<string, unknown> {
  return JSON.parse(queryAsAuthenticated(DB, userId, `select ${expr}`))
}

const payment = (patient: string, amount: number, requestId: string | null) =>
  `public.record_payment_v2('${patient}', 'ordinary', null, ${amount}, 'upi', current_date, 'idempotency', ${requestId ? `'${requestId}'` : 'null'}::uuid)`

const packageEntry = (patient: string, requestId: string) =>
  `public.record_billing_entry_v2('${patient}', 'package_with_payment', 'Five pack', 5, 600, '${typeId}', current_date, 3000, 'cash', current_date, null, '${requestId}'::uuid)`

function count(sql: string): number {
  return Number(query(DB, sql))
}

test('a resent payment with the same request id records one payment and returns the first result', { skip }, () => {
  const patient = newPatient('Resend Payment')
  const requestId = query(DB, 'select gen_random_uuid()')

  const first = rpc(adminId, payment(patient, 515, requestId))
  assert.equal(first.success, true)
  const second = rpc(adminId, payment(patient, 515, requestId))
  assert.equal(second.success, true)
  assert.equal(second.paymentId, first.paymentId)
  assert.equal(second.replayed, true)

  assert.equal(count(`select count(*) from payments where patient_id = '${patient}'`), 1)
})

test('different request ids are different receipts', { skip }, () => {
  const patient = newPatient('Two Receipts')
  rpc(adminId, payment(patient, 100, query(DB, 'select gen_random_uuid()')))
  rpc(adminId, payment(patient, 100, query(DB, 'select gen_random_uuid()')))
  assert.equal(count(`select count(*) from payments where patient_id = '${patient}'`), 2)
})

test('a null request id behaves like the original function', { skip }, () => {
  const patient = newPatient('No Request Id')
  assert.equal(rpc(adminId, payment(patient, 200, null)).success, true)
  assert.equal(rpc(adminId, payment(patient, 200, null)).success, true)
  assert.equal(count(`select count(*) from payments where patient_id = '${patient}'`), 2)
})

test('a refused payment does not burn its request id', { skip }, () => {
  const patient = newPatient('Refused First')
  const requestId = query(DB, 'select gen_random_uuid()')
  const refused = rpc(adminId, `public.record_payment_v2('${patient}', 'ordinary', null, 0, 'upi', current_date, null, '${requestId}'::uuid)`)
  assert.equal(refused.success, false)
  assert.equal(refused.errorCode, '22023')
  assert.equal(rpc(adminId, payment(patient, 300, requestId)).success, true)
  assert.equal(count(`select count(*) from payments where patient_id = '${patient}'`), 1)
})

test('a request id cannot be replayed for another patient or from another clinic', { skip }, () => {
  const patient = newPatient('Owner')
  const otherPatient = newPatient('Someone Else')
  const requestId = query(DB, 'select gen_random_uuid()')
  assert.equal(rpc(adminId, payment(patient, 400, requestId)).success, true)

  const reused = rpc(adminId, payment(otherPatient, 400, requestId))
  assert.equal(reused.success, false)
  assert.equal(reused.errorCode, '22023')
  assert.equal(count(`select count(*) from payments where patient_id = '${otherPatient}'`), 0)

  const foreign = rpc(otherAdminId, payment(patient, 400, requestId))
  assert.equal(foreign.success, false)
  assert.equal(foreign.paymentId, undefined)
})

test('staff cannot use the request-id overloads', { skip }, () => {
  const patient = newPatient('Staff Blocked')
  const result = rpc(staffId, payment(patient, 100, query(DB, 'select gen_random_uuid()')))
  assert.equal(result.success, false)
  assert.equal(result.errorCode, '42501')
  assert.equal(count(`select count(*) from payments where patient_id = '${patient}'`), 0)
})

test('a resent package entry creates one package and one payment', { skip }, () => {
  const patient = newPatient('Resend Package')
  const requestId = query(DB, 'select gen_random_uuid()')
  const first = rpc(adminId, packageEntry(patient, requestId))
  assert.equal(first.success, true, JSON.stringify(first))
  const second = rpc(adminId, packageEntry(patient, requestId))
  assert.equal(second.success, true)
  assert.equal(second.packageId, first.packageId)
  assert.equal(second.paymentId, first.paymentId)

  assert.equal(count(`select count(*) from packages where patient_id = '${patient}'`), 1)
  assert.equal(count(`select count(*) from payments where patient_id = '${patient}'`), 1)
})

test('the request-key table is not reachable by app users', { skip }, () => {
  assert.throws(() => queryAsAuthenticated(DB, adminId, 'select count(*) from private.billing_request_keys'), /permission denied/)
})
