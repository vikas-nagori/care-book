// Payments + billing flows through the real Postgres RPCs the app calls (record_payment,
// record_billing_entry). Both are admin-only and return a {success, ...} JSON envelope rather than
// throwing, so tests act as an admin user via the auth.uid() claim and assert on that envelope plus
// the resulting allocation state (payment_status, appointment_payments, package usage).

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_payments'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let staffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Payments Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function newPatient(label: string): string {
  return query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', '${label}', '1') returning id`)
}

/** Call an RPC as the given user and parse the JSON envelope. */
function rpc(userId: string, expr: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, userId, `select ${expr}`))
}

test('record_payment is rejected for non-admin users', { skip }, () => {
  const patient = newPatient('Staff Blocked')
  const res = rpc(staffId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '42501', 'should fail authorization')
})

test('record_payment rejects a non-positive amount', { skip }, () => {
  const patient = newPatient('Bad Amount')
  const res = rpc(adminId, `public.record_payment('${patient}', null, 0, 'cash', current_date, null)`)
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '22023')
})

test('a payment settles a completed unpaid session', { skip }, () => {
  const patient = newPatient('Settle Completed')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 500) returning id`
  )

  const res = rpc(adminId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(res.success, true)

  assert.equal(query(DB, `select payment_status from appointments where id = '${appt}'`), 'paid')
  assert.equal(
    query(DB, `select count(*) from payment_applications pa join appointment_charges c on c.id = pa.charge_id where c.appointment_reference_id = '${appt}' and pa.status = 'active'`),
    '1'
  )
})

test('credit pools across payments to cover one session', { skip }, () => {
  const patient = newPatient('Pooled')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 150) returning id`
  )

  // Partial applications are visible immediately.
  rpc(adminId, `public.record_payment('${patient}', null, 100, 'cash', current_date, null)`)
  assert.equal(query(DB, `select payment_status from appointments where id = '${appt}'`), 'partially_paid')

  // Second ₹100 lifts the pool to ₹200; the session is now drawn across both payments.
  rpc(adminId, `public.record_payment('${patient}', null, 100, 'cash', current_date, null)`)
  assert.equal(query(DB, `select payment_status from appointments where id = '${appt}'`), 'paid')
  assert.equal(
    query(DB, `select count(*) from payment_applications pa join appointment_charges c on c.id = pa.charge_id where c.appointment_reference_id = '${appt}' and pa.status = 'active'`),
    '2',
    'the fee should be funded by both payments'
  )
})

test('record_billing_entry creates a package, claims a booked session, and records the payment', { skip }, () => {
  const patient = newPatient('Package Entry')
  // A matching ₹800 session is booked first so the new package can claim it.
  query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 1, '10:00', 'home_visit', 'scheduled', 800)`
  )

  const res = rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patient}', 'package_with_payment', '10-pack', 10, 800,
      (select id from appointment_types where clinic_id = '${clinicId}' and name = 'Home'),
      current_date, 8000, 'cash', current_date, null
    )`
  )
  assert.equal(res.success, true)

  const pkg = query(
    DB,
    `select used_sessions || '/' || total_sessions || ' scheduled=' ||
       (select count(*) from package_session_allocations psa where psa.package_id = packages.id and psa.lifecycle = 'scheduled') ||
       ' paid=' || paid_amount
     from packages where patient_id = '${patient}'`
  )
  assert.equal(pkg, '0/10 scheduled=1 paid=8000.00', 'package should reserve the booked session without counting it as availed')
})

test('record_billing_entry rejects a postpaid package (packages are prepaid only)', { skip }, () => {
  const patient = newPatient('Postpaid Blocked')
  const res = rpc(
    adminId,
    `public.record_billing_entry('${patient}', 'package_with_payment', 'late-pack', 2, 950, 'postpaid', 100, 'cash', current_date, null)`
  )
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '22023')
  assert.equal(query(DB, `select count(*) from packages where patient_id = '${patient}'`), '0')
})

test('record_billing_entry rejects a package with a zero payment amount', { skip }, () => {
  const patient = newPatient('Zero Amount Package')
  const res = rpc(
    adminId,
    `public.record_billing_entry('${patient}', 'package_with_payment', 'free-pack', 2, 950, 'prepaid', 0, 'cash', current_date, null)`
  )
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '22023')
  assert.equal(query(DB, `select count(*) from packages where patient_id = '${patient}'`), '0')
})
