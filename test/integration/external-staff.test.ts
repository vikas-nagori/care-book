import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_external_staff'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let patientId = ''
let externalStaffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('External Staff Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  patientId = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'External Staff Patient', '1') returning id`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('external staff requires name and phone but email is optional', { skip }, () => {
  assert.throws(() => {
    queryAs(DB, adminId, `insert into external_staff (name, phone) values ('', '999') returning id`)
  }, /external_staff_name_present/)

  assert.throws(() => {
    queryAs(DB, adminId, `insert into external_staff (name, phone) values ('Dr Temp', '') returning id`)
  }, /external_staff_phone_present/)

  externalStaffId = queryAs(
    DB,
    adminId,
    `insert into external_staff (name, phone) values ('Dr Temp', '999') returning id`
  )

  assert.ok(externalStaffId)
})

test('appointment cannot be assigned to both internal and external staff', { skip }, () => {
  assert.throws(() => {
    queryAs(
      DB,
      adminId,
      `insert into appointments (patient_id, date, time, type, status, fee, assigned_to, external_staff_id)
       values ('${patientId}', current_date, '09:00', 'home_visit', 'scheduled', 500, '${adminId}', '${externalStaffId}')`
    )
  }, /Appointment cannot be assigned to both internal and external staff/)
})

test('clinic appointments clear external assignment', { skip }, () => {
  const appointmentId = queryAs(
    DB,
    adminId,
    `insert into appointments (patient_id, date, time, type, status, fee, external_staff_id)
     values ('${patientId}', current_date, '10:00', 'clinic', 'scheduled', 500, '${externalStaffId}')
     returning id`
  )

  const externalStaff = query(DB, `select coalesce(external_staff_id::text, 'null') from appointments where id = '${appointmentId}'`)
  assert.equal(externalStaff, 'null')
})

test('accepted invite can link an external staff record to the profile', { skip }, () => {
  const inviteId = queryAs(
    DB,
    adminId,
    `insert into user_invites (clinic_id, email, role, status, invited_by, external_staff_id)
     values ('${clinicId}', 'external.staff@test.local', 'staff', 'pending', '${adminId}', '${externalStaffId}')
     returning id`
  )

  queryAs(
    DB,
    adminId,
    `update user_invites set status = 'accepted', auth_user_id = '${adminId}' where id = '${inviteId}'`
  )
  queryAs(
    DB,
    adminId,
    `update external_staff set status = 'onboarded', linked_profile_id = '${adminId}' where id = '${externalStaffId}'`
  )

  const linked = query(DB, `select status || ':' || linked_profile_id from external_staff where id = '${externalStaffId}'`)
  assert.equal(linked, `onboarded:${adminId}`)
})
