// Admin-configurable appointment types (migration 028). Every clinic is seeded with the two
// defaults; a booked appointment denormalizes its type's name + is_shared; visibility keys off
// is_shared (shared = all staff, restricted = creator/assignee); and renaming/retoggling a type
// propagates to existing appointments.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAsAuthenticated, seedUser } from './db.ts'

const DB = 'carebook_it_appt_types'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let staffId = ''
let otherStaffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Types Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
  otherStaffId = seedUser(DB, 'staff', clinicId)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function newPatient(label: string): string {
  return query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', '${label}', '1') returning id`)
}

function typeId(name: string): string {
  return query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = '${name}'`)
}

test('every clinic is seeded with the two default types', { skip }, () => {
  assert.equal(query(DB, `select count(*) from appointment_types where clinic_id = '${clinicId}'`), '2')
  assert.equal(query(DB, `select is_shared from appointment_types where clinic_id = '${clinicId}' and name = 'Clinic'`), 't')
  assert.equal(query(DB, `select is_shared from appointment_types where clinic_id = '${clinicId}' and name = 'Home'`), 'f')
})

test('booking with a type id denormalizes name and visibility', { skip }, () => {
  const patient = newPatient('Denorm')
  const apptId = query(
    DB,
    `insert into appointments (patient_id, date, time, appointment_type_id, status, fee)
     values ('${patient}', current_date + 1, '09:00', '${typeId('Clinic')}', 'scheduled', 500)
     returning id`
  )
  assert.equal(query(DB, `select type from appointments where id = '${apptId}'`), 'Clinic')
  assert.equal(query(DB, `select type_is_shared from appointments where id = '${apptId}'`), 't')
})

test('a restricted custom type hides the appointment from unrelated staff', { skip }, () => {
  // Admin adds a custom staff-restricted type.
  const customId = query(
    DB,
    `insert into appointment_types (clinic_id, name, session_rate, is_shared, sort_order)
     values ('${clinicId}', 'Tele Consult', 400, false, 2) returning id`
  )
  const patient = newPatient('Restricted')
  const apptId = query(
    DB,
    `insert into appointments (patient_id, date, time, appointment_type_id, status, fee, assigned_to)
     values ('${patient}', current_date + 1, '10:00', '${customId}', 'scheduled', 400, '${staffId}')
     returning id`
  )

  const seenBySelf = queryAsAuthenticated(DB, staffId, `select count(*) from appointments where id = '${apptId}'`)
  const seenByOther = queryAsAuthenticated(DB, otherStaffId, `select count(*) from appointments where id = '${apptId}'`)
  const seenByAdmin = queryAsAuthenticated(DB, adminId, `select count(*) from appointments where id = '${apptId}'`)
  assert.equal(seenBySelf, '1', 'the assigned staff can see it')
  assert.equal(seenByOther, '0', 'unrelated staff cannot see a restricted appointment')
  assert.equal(seenByAdmin, '1', 'admins see everything')
})

test('toggling a type to shared propagates and clears assignees', { skip }, () => {
  const customId = typeId('Tele Consult')
  const patient = newPatient('Propagate')
  const apptId = query(
    DB,
    `insert into appointments (patient_id, date, time, appointment_type_id, status, fee, assigned_to)
     values ('${patient}', current_date + 1, '11:00', '${customId}', 'scheduled', 400, '${staffId}')
     returning id`
  )
  assert.equal(query(DB, `select type_is_shared from appointments where id = '${apptId}'`), 'f')

  // Admin renames it and flips it to shared.
  query(DB, `update appointment_types set name = 'Video Visit', is_shared = true where id = '${customId}'`)

  assert.equal(query(DB, `select type from appointments where id = '${apptId}'`), 'Video Visit', 'rename propagates')
  assert.equal(query(DB, `select type_is_shared from appointments where id = '${apptId}'`), 't', 'visibility propagates')
  assert.equal(query(DB, `select assigned_to from appointments where id = '${apptId}'`), '', 'assignee cleared when shared')
  // Now every staff member can see it.
  assert.equal(queryAsAuthenticated(DB, otherStaffId, `select count(*) from appointments where id = '${apptId}'`), '1')
})

test('a type in use cannot be deleted', { skip }, () => {
  const clinicVisit = typeId('Clinic')
  const patient = newPatient('In Use')
  query(
    DB,
    `insert into appointments (patient_id, date, time, appointment_type_id, status, fee)
     values ('${patient}', current_date + 1, '12:00', '${clinicVisit}', 'scheduled', 500)`
  )

  let rejected = ''
  try {
    query(DB, `delete from appointment_types where id = '${clinicVisit}'`)
  } catch (err) {
    rejected = (err as { stderr?: string }).stderr ?? (err as Error).message
  }
  assert.match(rejected, /foreign key|violates/i, 'a referenced type is protected by the FK')
})
