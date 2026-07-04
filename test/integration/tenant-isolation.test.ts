import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDatabase,
  dropDatabase,
  postgresAvailable,
  query,
  queryAsAuthenticated,
  seedUser,
} from './db.ts'

const DB = 'carebook_it_tenants'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicA = ''
let clinicB = ''
let adminA = ''
let adminB = ''
let staffA = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)

  clinicA = query(DB, `insert into clinics (name) values ('Clinic A') returning id`)
  clinicB = query(DB, `insert into clinics (name) values ('Clinic B') returning id`)
  adminA = seedUser(DB, 'admin', clinicA, 'admin-a@example.com')
  adminB = seedUser(DB, 'admin', clinicB, 'admin-b@example.com')
  staffA = seedUser(DB, 'staff', clinicA, 'staff-a@example.com')
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('authenticated users only see their clinic data through RLS', { skip }, () => {
  query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicA}', 'Patient A', '1')`)
  query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicB}', 'Patient B', '2')`)

  assert.equal(
    queryAsAuthenticated(DB, adminA, `select string_agg(name, ', ' order by name) from patients`),
    'Patient A'
  )
  assert.equal(
    queryAsAuthenticated(DB, adminB, `select string_agg(name, ', ' order by name) from patients`),
    'Patient B'
  )
})

test('clinic admins cannot mutate another clinic patient', { skip }, () => {
  const patientB = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicB}', 'Protected B', '2') returning id`
  )

  queryAsAuthenticated(
    DB,
    adminA,
    `update patients set name = 'Leaked' where id = '${patientB}'`
  )

  assert.equal(query(DB, `select name from patients where id = '${patientB}'`), 'Protected B')
})

test('billing RPC rejects cross-clinic patients', { skip }, () => {
  const patientB = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicB}', 'Billing B', '2') returning id`
  )

  const result = JSON.parse(
    queryAsAuthenticated(
      DB,
      adminA,
      `select public.record_payment('${patientB}', null, 500, 'cash', current_date, null)`
    )
  )

  assert.equal(result.success, false)
  assert.equal(result.errorCode, '42501')
})

test('appointment visibility remains scoped within the clinic', { skip }, () => {
  const patientA = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicA}', 'Schedule A', '1') returning id`
  )
  const patientB = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicB}', 'Schedule B', '2') returning id`
  )

  query(
    DB,
    `insert into appointments (clinic_id, patient_id, date, time, type, status, created_by)
     values ('${clinicA}', '${patientA}', current_date, '09:00', 'clinic', 'scheduled', '${adminA}')`
  )
  query(
    DB,
    `insert into appointments (clinic_id, patient_id, date, time, type, status, created_by)
     values ('${clinicB}', '${patientB}', current_date, '10:00', 'clinic', 'scheduled', '${adminB}')`
  )

  assert.equal(queryAsAuthenticated(DB, staffA, `select count(*) from appointments`), '1')
})

test('platform onboarding approval and rejection mutate only onboarding tables', { skip }, () => {
  const requestToApprove = query(
    DB,
    `insert into clinic_onboarding_requests
      (clinic_name, owner_full_name, owner_email, owner_mobile_number)
     values ('New Clinic', 'Owner One', 'owner1@example.com', '999') returning id`
  )
  const requestToReject = query(
    DB,
    `insert into clinic_onboarding_requests
      (clinic_name, owner_full_name, owner_email, owner_mobile_number)
     values ('Rejected Clinic', 'Owner Two', 'owner2@example.com', '888') returning id`
  )

  const approvedClinic = query(
    DB,
    `select public.approve_clinic_onboarding_request('${requestToApprove}', '${adminA}')`
  )
  query(
    DB,
    `select public.reject_clinic_onboarding_request('${requestToReject}', '${adminA}', 'Outside service area')`
  )

  assert.equal(query(DB, `select count(*) from clinics where id = '${approvedClinic}'`), '1')
  assert.equal(
    query(DB, `select count(*) from global_settings where clinic_id = '${approvedClinic}'`),
    '1'
  )
  assert.equal(
    query(DB, `select count(*) from user_invites where clinic_id = '${approvedClinic}' and role = 'admin'`),
    '1'
  )
  assert.equal(
    query(DB, `select count(*) from clinics where name = 'Rejected Clinic'`),
    '0'
  )
})
