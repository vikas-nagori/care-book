import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, queryAsAuthenticated, seedUser } from './db.ts'

const DB = 'carebook_it_payment_statement_source'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicA = ''
let clinicB = ''
let adminA = ''
let staffA = ''
let adminB = ''
let patientA = ''
let patientB = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicA = query(DB, `insert into clinics (name) values ('Statement Clinic A') returning id`)
  clinicB = query(DB, `insert into clinics (name) values ('Statement Clinic B') returning id`)
  adminA = seedUser(DB, 'admin', clinicA, 'statement-admin-a@example.com')
  staffA = seedUser(DB, 'staff', clinicA, 'statement-staff-a@example.com')
  adminB = seedUser(DB, 'admin', clinicB, 'statement-admin-b@example.com')
  patientA = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicA}', 'Statement Patient A', '1') returning id`)
  patientB = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicB}', 'Statement Patient B', '2') returning id`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function addCompletedCharge(patientId: string, date: string, fee: number) {
  const appointmentId = query(DB, `
    insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee)
    values ('${clinicA}', '${patientId}', date '${date}', '09:00',
      (select id from appointment_types where clinic_id = '${clinicA}' order by sort_order, id limit 1),
      'completed', ${fee}) returning id`)
  query(DB, `insert into appointment_charges (clinic_id, patient_id, appointment_id, amount, status) values ('${clinicA}', '${patientId}', '${appointmentId}', ${fee}, 'posted') on conflict (appointment_id) do update set amount = excluded.amount, status = excluded.status`)
  return appointmentId
}

test('returns one complete source snapshot without duplicate application sums', { skip }, () => {
  addCompletedCharge(patientA, '2026-08-01', 800)
  const appointmentId = addCompletedCharge(patientA, '2026-08-02', 900)
  const paymentId = query(DB, `insert into payments (clinic_id, patient_id, amount, payment_method, date, funding_scope, status) values ('${clinicA}', '${patientA}', 300, 'cash', date '2026-08-03', 'ordinary', 'posted') returning id`)
  const chargeId = query(DB, `select id from appointment_charges where appointment_id = '${appointmentId}'`)
  query(DB, `insert into payment_applications (clinic_id, patient_id, payment_id, charge_id, funding_scope, amount, status) values ('${clinicA}', '${patientA}', '${paymentId}', '${chargeId}', 'ordinary', 300, 'active')`)

  const snapshot = JSON.parse(queryAsAuthenticated(DB, adminA, `select public.get_payment_due_statement_source_v1('${patientA}')`)) as {
    patient: { name: string }
    appointments: { id: string; chargeAmount: string; applications: { amount: string }[] }[]
  }

  assert.equal(snapshot.patient.name, 'Statement Patient A')
  assert.equal(snapshot.appointments.length, 2)
  assert.equal(snapshot.appointments.find((row) => row.id === appointmentId)?.applications.length, 1)
  assert.equal(snapshot.appointments.find((row) => row.id === appointmentId)?.applications[0]?.amount, '300.00')
})

test('does not disclose a statement to staff, foreign-clinic admins, or anonymous callers', { skip }, () => {
  const staffResult = queryAsAuthenticated(DB, staffA, `select public.get_payment_due_statement_source_v1('${patientA}') is null`)
  const foreignResult = queryAsAuthenticated(DB, adminB, `select public.get_payment_due_statement_source_v1('${patientA}') is null`)
  const anonymousResult = queryAs(DB, '', `select public.get_payment_due_statement_source_v1('${patientA}') is null`)
  assert.equal(staffResult, 't')
  assert.equal(foreignResult, 't')
  assert.equal(anonymousResult, 't')
})

test('does not disclose a foreign patient even when the caller knows its id', { skip }, () => {
  const result = queryAsAuthenticated(DB, adminA, `select public.get_payment_due_statement_source_v1('${patientB}') is null`)
  assert.equal(result, 't')
})
