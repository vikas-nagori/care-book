// Migration 039: a session with no fee is settled, not perpetually 'unpaid'.
//
// The bug was reported as "a ₹0 session shows in unpaid sessions". Root cause was the
// payment_status CASE in private.reconcile_patient_billing_v2: every branch that can reach
// 'paid' or 'prepaid' is guarded by `charge.amount > 0`, so a zero-value charge fell through
// to `else 'unpaid'` and stayed there through every reconcile.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_zero_value_sessions'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let clinicTypeId = ''
let adminId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Zero Value Clinic') returning id`)
  clinicTypeId = query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = 'Clinic'`)
  adminId = seedUser(DB, 'admin', clinicId)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function patient(label: string): string {
  return query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', '${label}', '1') returning id`)
}

function appointment(patientId: string, date: string, fee: number, status: 'scheduled' | 'completed'): string {
  return query(
    DB,
    `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee)
     values ('${clinicId}', '${patientId}', date '${date}', '09:00', '${clinicTypeId}', '${status}', ${fee})
     returning id`,
  )
}

function paymentStatus(appointmentId: string): string {
  return query(DB, `select payment_status from appointments where id = '${appointmentId}'`)
}

test('a completed zero-fee session settles instead of reading as unpaid', { skip }, () => {
  const patientId = patient('Zero Fee Completed')
  const free = appointment(patientId, '2026-07-22', 0, 'completed')

  assert.equal(paymentStatus(free), 'paid')
})

test('a scheduled zero-fee session settles too', { skip }, () => {
  const patientId = patient('Zero Fee Scheduled')
  const free = appointment(patientId, '2026-09-01', 0, 'scheduled')

  assert.equal(paymentStatus(free), 'paid')
})

test('a zero-fee session contributes nothing to the due and leaves paid sessions alone', { skip }, () => {
  const patientId = patient('Zero Fee Mixed')
  const free = appointment(patientId, '2026-07-22', 0, 'completed')
  const charged = appointment(patientId, '2026-08-07', 650, 'completed')

  assert.equal(paymentStatus(free), 'paid')
  assert.equal(paymentStatus(charged), 'unpaid', 'a real charge still reads as unpaid until paid')

  const due = query(DB, `select due_amount from patient_billing_balances_v2 where patient_id = '${patientId}'`)
  assert.equal(Number(due), 650, 'the free session adds nothing to the due')
})

test('a completed session cannot be waived to zero after the fact', { skip }, () => {
  // Documents a real limitation rather than a wish: a completed appointment's fee is guarded and
  // can only move through adjust_appointment_fee, which rejects zero. So a zero-value completed
  // session can only originate at booking — there is no "waive this session" path today.
  const patientId = patient('Zero Fee Waived')
  const target = appointment(patientId, '2026-08-12', 650, 'completed')
  assert.equal(paymentStatus(target), 'unpaid')

  const result = queryAs(
    DB,
    adminId,
    `select adjust_appointment_fee('${target}'::uuid, 0::numeric, 'Waived as goodwill')`,
  )
  assert.match(result, /"success"\s*:\s*false/)
  assert.match(result, /greater than zero/i)
  assert.equal(paymentStatus(target), 'unpaid', 'the rejected adjustment changed nothing')
})

test('a scheduled session zeroed then re-priced flips settled and back', { skip }, () => {
  const patientId = patient('Zero Fee Corrected')
  const target = appointment(patientId, '2026-09-15', 650, 'scheduled')
  assert.equal(paymentStatus(target), 'unpaid')

  query(DB, `update appointments set fee = 0 where id = '${target}'`)
  assert.equal(paymentStatus(target), 'paid', 'waiving the fee settles the session')

  query(DB, `update appointments set fee = 400 where id = '${target}'`)
  assert.equal(paymentStatus(target), 'unpaid', 'restoring a fee makes it collectable again')
})

test('the backfill left no zero-value charge stamped unpaid', { skip }, () => {
  const patientId = patient('Zero Fee Sweep')
  appointment(patientId, '2026-07-01', 0, 'completed')
  appointment(patientId, '2026-07-02', 0, 'scheduled')

  const stragglers = query(
    DB,
    `select count(*) from appointments a
     join appointment_charges c on c.appointment_id = a.id
     where c.amount <= 0 and a.payment_status <> 'paid'`,
  )
  assert.equal(Number(stragglers), 0)
})
