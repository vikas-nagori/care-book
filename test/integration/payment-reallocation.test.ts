// Re-deriving a patient's billing when a *paid* session changes. The allocation trigger fires on
// `after update of fee/status on appointments`, but historically it only ever paid off sessions still
// flagged `unpaid` — it never un-tied money from an already-paid session. So editing the fee of a
// paid session left the due/credit totals frozen. Migration 023 makes allocate_patient_payment_credit
// idempotent (clear the patient's non-cancelled ties, reset to unpaid, re-run FIFO from current
// state), so any fee/status edit re-derives correctly. These tests pin that behaviour.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_realloc'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Realloc Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function newPatient(label: string): string {
  return query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', '${label}', '1') returning id`)
}

function rpc(userId: string, expr: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, userId, `select ${expr}`))
}

/** A patient's unspent ordinary credit = posted receipts − refunds − active applications. */
function unspentCredit(patient: string): number {
  return Number(
    query(
      DB,
      `select coalesce((
                select sum(p.amount - coalesce((select sum(r.amount) from refunds r where r.payment_id = p.id), 0))
                from payments p where p.patient_id = '${patient}' and p.status = 'posted'
              ), 0)
            - coalesce((
                select sum(pa.amount)
                from payment_applications pa
                where pa.patient_id = '${patient}' and pa.status = 'active'
              ), 0)`
    )
  )
}

function paymentStatus(appt: string): string {
  return query(DB, `select payment_status from appointments where id = '${appt}'`)
}

function appliedTo(appt: string): number {
  return Number(query(DB, `select coalesce(sum(pa.amount), 0) from payment_applications pa join appointment_charges c on c.id = pa.charge_id where c.appointment_reference_id = '${appt}' and pa.status = 'active'`))
}

test('raising a paid session fee re-opens the balance', { skip }, () => {
  const patient = newPatient('Raise Fee')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 500) returning id`
  )
  rpc(adminId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(paymentStatus(appt), 'paid', 'precondition: ₹500 pays the ₹500 session')

  // The session was actually ₹700. The v2 ledger applies the ₹500 partially and leaves ₹200 due.
  assert.equal(rpc(adminId, `public.adjust_appointment_fee('${appt}', 700, 'correct actual fee')`).success, true)

  assert.equal(paymentStatus(appt), 'partially_paid', 'the session should expose its partial payment')
  assert.equal(appliedTo(appt), 500, 'available ordinary money remains applied')
  assert.equal(unspentCredit(patient), 0, 'the receipt is fully applied, with ₹200 due')
})

test('lowering a paid session fee releases the overpayment as credit', { skip }, () => {
  const patient = newPatient('Lower Fee')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 500) returning id`
  )
  rpc(adminId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(paymentStatus(appt), 'paid')

  // The session was actually ₹300 — the ₹200 overpayment must be freed as credit.
  assert.equal(rpc(adminId, `public.adjust_appointment_fee('${appt}', 300, 'correct actual fee')`).success, true)

  assert.equal(paymentStatus(appt), 'paid', 'the ₹500 still covers the ₹300 session')
  assert.equal(appliedTo(appt), 300, 'only the current ₹300 fee should stay tied to the session')
  assert.equal(unspentCredit(patient), 200, 'the ₹200 overpayment should surface as credit')
})

test('re-deriving money does not disturb a scheduled package reservation', { skip }, () => {
  const patient = newPatient('Package Usage')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 1, '10:00', 'home_visit', 'scheduled', 800) returning id`
  )
  rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patient}', 'package_with_payment', '10-pack', 10, 800,
      (select id from appointment_types where clinic_id = '${clinicId}' and name = 'Home'),
      current_date, 8000, 'cash', current_date, null
    )`
  )
  const usedBefore = query(DB, `select used_sessions from packages where patient_id = '${patient}'`)
  assert.equal(usedBefore, '0', 'scheduled reservations do not count as availed')
  assert.equal(query(DB, `select count(*) from package_session_allocations where appointment_id = '${appt}' and lifecycle = 'scheduled'`), '1')

  // Editing the session fee triggers a money rebuild; the package quota counter must be untouched.
  query(DB, `update appointments set fee = 900 where id = '${appt}'`)
  const usedAfter = query(DB, `select used_sessions from packages where patient_id = '${patient}'`)
  assert.equal(usedAfter, usedBefore, 'used_sessions counts availed sessions only')
  assert.equal(query(DB, `select count(*) from package_session_allocations where appointment_id = '${appt}' and lifecycle = 'scheduled'`), '1')
})

test('allocate_patient_payment_credit is idempotent', { skip }, () => {
  const patient = newPatient('Idempotent')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 400) returning id`
  )
  rpc(adminId, `public.record_payment('${patient}', null, 400, 'cash', current_date, null)`)

  const firstStatus = paymentStatus(appt)
  const firstApplied = appliedTo(appt)
  // Migration 022 moved the live allocation function into the private schema.
  query(DB, `select private.allocate_patient_payment_credit('${patient}')`)
  query(DB, `select private.allocate_patient_payment_credit('${patient}')`)

  assert.equal(paymentStatus(appt), firstStatus, 'status stable across repeated runs')
  assert.equal(appliedTo(appt), firstApplied, 'applied amount stable across repeated runs')
  assert.equal(query(DB, `select count(*) from payment_applications pa join appointment_charges c on c.id = pa.charge_id where c.appointment_reference_id = '${appt}' and pa.status = 'active'`), '1', 'no duplicate active applications accumulate')
})
