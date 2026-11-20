import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  buildDatabase,
  dropDatabase,
  postgresAvailable,
  query,
  queryAsAuthenticated,
  seedUser,
} from './db.ts'

const DB = 'carebook_it_patient_access'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let otherClinicId = ''
let adminId = ''
let staffId = ''
let patientId = ''
let otherPatientId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Patient Access Clinic') returning id`)
  otherClinicId = query(DB, `insert into clinics (name) values ('Other Patient Access Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
  patientId = queryAsAuthenticated(DB, adminId,
    `insert into patients (name) values ('Admin-created patient') returning id`)
  otherPatientId = query(DB,
    `insert into patients (clinic_id, name) values ('${otherClinicId}', 'Other clinic patient') returning id`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('staff cannot directly delete a patient created by an admin', { skip }, () => {
  const id = queryAsAuthenticated(DB, adminId,
    `insert into patients (name) values ('Protected admin-created patient') returning id`)
  assert.equal(queryAsAuthenticated(DB, staffId,
    `delete from patients where id = '${id}' returning id`), '')
  assert.equal(query(DB, `select count(*) from patients where id = '${id}'`), '1')
})

test('staff cannot directly delete even a patient they created', { skip }, () => {
  const id = queryAsAuthenticated(DB, staffId,
    `insert into patients (name) values ('Staff-created patient') returning id`)
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.equal(query(DB, `select clinic_id from patients where id = '${id}'`), clinicId)
  assert.equal(queryAsAuthenticated(DB, staffId,
    `delete from patients where id = '${id}' returning id`), '')
  assert.equal(query(DB, `select count(*) from patients where id = '${id}'`), '1')
})

test('staff can view all clinic patients without any appointment assignments', { skip }, () => {
  const expected = query(DB,
    `select string_agg(id::text, ',' order by id) from patients where clinic_id = '${clinicId}'`)
  assert.equal(queryAsAuthenticated(DB, staffId,
    `select string_agg(id::text, ',' order by id) from patients`), expected)
  assert.equal(queryAsAuthenticated(DB, staffId,
    `select name from patients where id = '${patientId}'`), 'Admin-created patient')
})

test('staff can edit a patient created by an admin without any appointment assignment', { skip }, () => {
  assert.equal(queryAsAuthenticated(DB, staffId,
    `update patients set phone = '9876543210', medical_history = 'Updated history', notes = 'Staff update'
     where id = '${patientId}' returning id`), patientId)
  assert.equal(query(DB,
    `select phone || '/' || medical_history || '/' || notes from patients where id = '${patientId}'`),
  '9876543210/Updated history/Staff update')
})

test('admins can still edit their clinic patients', { skip }, () => {
  assert.equal(queryAsAuthenticated(DB, adminId,
    `update patients set notes = 'Admin update' where id = '${patientId}' returning notes`), 'Admin update')
})

test('admins can directly delete a clinic patient with no billing history', { skip }, () => {
  const id = queryAsAuthenticated(DB, adminId,
    `insert into patients (name) values ('Deletable patient') returning id`)
  assert.equal(queryAsAuthenticated(DB, adminId,
    `delete from patients where id = '${id}' returning id`), id)
  assert.equal(query(DB, `select count(*) from patients where id = '${id}'`), '0')
})

test('neither staff nor admins can view, edit or delete another clinic patient', { skip }, () => {
  for (const userId of [staffId, adminId]) {
    assert.equal(queryAsAuthenticated(DB, userId,
      `select id from patients where id = '${otherPatientId}'`), '')
    assert.equal(queryAsAuthenticated(DB, userId,
      `update patients set name = 'Cross-clinic edit' where id = '${otherPatientId}' returning id`), '')
    assert.equal(queryAsAuthenticated(DB, userId,
      `delete from patients where id = '${otherPatientId}' returning id`), '')
  }
  assert.equal(query(DB, `select name from patients where id = '${otherPatientId}'`), 'Other clinic patient')
})

test('neither staff nor admins can insert a patient into another clinic', { skip }, () => {
  for (const userId of [staffId, adminId]) {
    assert.throws(() => queryAsAuthenticated(DB, userId,
      `insert into patients (clinic_id, name) values ('${otherClinicId}', 'Cross-clinic insert')`),
    /row-level security/i)
  }
})

test('neither staff nor admins can move a patient into another clinic', { skip }, () => {
  for (const userId of [staffId, adminId]) {
    assert.throws(() => queryAsAuthenticated(DB, userId,
      `update patients set clinic_id = '${otherClinicId}' where id = '${patientId}'`),
    /row-level security/i)
  }
  assert.equal(query(DB, `select clinic_id from patients where id = '${patientId}'`), clinicId)
})

test('a blocked admin cannot delete clinic patients', { skip }, () => {
  const blockedAdmin = seedUser(DB, 'admin', clinicId)
  query(DB, `update profiles set status = 'blocked' where id = '${blockedAdmin}'`)
  assert.equal(queryAsAuthenticated(DB, blockedAdmin,
    `delete from patients where id = '${patientId}' returning id`), '')
  assert.equal(query(DB, `select count(*) from patients where id = '${patientId}'`), '1')
})
