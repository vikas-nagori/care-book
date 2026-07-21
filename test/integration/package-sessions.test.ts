// Integration guard for the package detail "sessions taken" list. The page reads the
// package_session_allocations ledger joined to the consuming appointments (admin-only via RLS). This
// verifies that join returns each consumed session's date/type/fee, and that an admin can read it
// while a staff member cannot (the ledger is admin-scoped).

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDatabase, dropDatabase, postgresAvailable, query, queryAsAuthenticated, seedUser,
} from './db.ts'

const DB = 'carebook_it_package_sessions'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let staffId = ''
let patientId = ''
let packageId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Package Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
  patientId = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Asha Rao', '1') returning id`)
  packageId = query(
    DB,
    `insert into packages (clinic_id, patient_id, name, total_sessions, used_sessions, total_amount, per_session_amount, paid_amount, payment_timing, status)
     values ('${clinicId}', '${patientId}', '10-Session Physiotherapy Package', 10, 0, 8000, 800, 8000, 'prepaid', 'active')
     returning id`,
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function typeId(name: string): string {
  return query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = '${name}'`)
}

// Booking a fee-matched session against the active prepaid package makes the billing trigger allocate
// it into package_session_allocations — the same ledger the detail page reads back.
function bookAndAllocate(dateSql: string, time: string, fee: number): string {
  return query(
    DB,
    `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee)
     values ('${clinicId}', '${patientId}', ${dateSql}, '${time}', '${typeId('Clinic')}', 'completed', ${fee})
     returning id`,
  )
}

test('lists each allocated session with its date, oldest first', { skip }, () => {
  bookAndAllocate(`date '2026-07-09'`, '11:00', 1000)
  bookAndAllocate(`date '2026-07-02'`, '09:00', 800)

  const json = query(
    DB,
    `select coalesce(json_agg(json_build_object('date', to_char(a.date, 'YYYY-MM-DD'), 'fee', a.fee) order by a.date), '[]')
     from package_session_allocations psa
     join appointments a on a.id = psa.appointment_id
     where psa.package_id = '${packageId}'`,
  )
  const sessions = JSON.parse(json) as { date: string; fee: number }[]

  assert.deepEqual(sessions, [
    { date: '2026-07-02', fee: 800 },
    { date: '2026-07-09', fee: 1000 },
  ])
})

test('the allocation ledger is readable by admins but not staff (RLS)', { skip }, () => {
  const seenByAdmin = queryAsAuthenticated(
    DB, adminId, `select count(*) from package_session_allocations where package_id = '${packageId}'`,
  )
  const seenByStaff = queryAsAuthenticated(
    DB, staffId, `select count(*) from package_session_allocations where package_id = '${packageId}'`,
  )
  assert.equal(seenByAdmin, '2', 'admin sees both allocations')
  assert.equal(seenByStaff, '0', 'staff cannot read the admin-only allocation ledger')
})
