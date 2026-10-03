// Patient creation flows, mirroring the inline patient creation in the appointment form and the
// patient form (both do a direct insert into `patients`).

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query } from './db.ts'

const DB = 'carebook_it_patient'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Patient Clinic') returning id`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('a patient with name and phone is created', { skip }, () => {
  const id = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Asha', '9876543210') returning id`)
  assert.match(id, /^[0-9a-f-]{36}$/, 'should return a uuid')
})

test('phone is optional (migration 010_home_visit_assignment_visibility, merged make_phone_optional)', { skip }, () => {
  // buildPatientInsertData converts a blank phone to null; the column must allow it.
  const id = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'No Phone', null) returning id`)
  assert.match(id, /^[0-9a-f-]{36}$/)
})

test('name is required', { skip }, () => {
  assert.throws(
    () => query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', null, '9876543210')`),
    /not-null|null value/i,
    'a null name should violate the not-null constraint'
  )
})

test('updated_at is bumped on update', { skip }, () => {
  const id = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Bump', '1') returning id`)
  // Force an older timestamp, then update and confirm the trigger advanced it.
  query(DB, `update patients set updated_at = now() - interval '1 day' where id = '${id}'`)
  const before = query(DB, `select updated_at from patients where id = '${id}'`)
  query(DB, `update patients set notes = 'touched' where id = '${id}'`)
  const after = query(DB, `select updated_at from patients where id = '${id}'`)
  assert.ok(after > before, 'updated_at should advance on update')
})

// Migration 045: Google-page and existing-patient referrals, and typed "Other" detail.
test('referral sources include google and patient alongside the original three', { skip }, () => {
  for (const source of ['walk_in', 'doctor', 'google', 'patient', 'other']) {
    const id = query(DB, `insert into patients (clinic_id, name, referral_source) values ('${clinicId}', 'Source ${source}', '${source}') returning id`)
    assert.match(id, /^[0-9a-f-]{36}$/, `${source} should be accepted`)
  }
  assert.throws(
    () => query(DB, `insert into patients (clinic_id, name, referral_source) values ('${clinicId}', 'Bad source', 'instagram')`),
    /patients_referral_source_check/,
  )
})

test('a patient can be referred by an existing patient of the same clinic', { skip }, () => {
  const referrer = query(DB, `insert into patients (clinic_id, name) values ('${clinicId}', 'Referrer') returning id`)
  const referred = query(
    DB,
    `insert into patients (clinic_id, name, referral_source, referred_by_patient_id)
     values ('${clinicId}', 'Referred', 'patient', '${referrer}') returning id`,
  )
  assert.equal(query(DB, `select referred_by_patient_id from patients where id = '${referred}'`), referrer)

  // Deleting the referrer must not delete or block the referred patient; the link just clears.
  query(DB, `delete from patients where id = '${referrer}'`)
  assert.equal(query(DB, `select coalesce(referred_by_patient_id::text, 'null') || '/' || referral_source from patients where id = '${referred}'`), 'null/patient')
})

test('a referring patient must belong to the same clinic and cannot be the patient themself', { skip }, () => {
  const otherClinic = query(DB, `insert into clinics (name) values ('Other Referral Clinic') returning id`)
  const outsider = query(DB, `insert into patients (clinic_id, name) values ('${otherClinic}', 'Outsider') returning id`)
  assert.throws(
    () => query(DB, `insert into patients (clinic_id, name, referral_source, referred_by_patient_id) values ('${clinicId}', 'Cross clinic', 'patient', '${outsider}')`),
    /same clinic/i,
  )

  const self = query(DB, `insert into patients (clinic_id, name) values ('${clinicId}', 'Self') returning id`)
  assert.throws(
    () => query(DB, `update patients set referral_source = 'patient', referred_by_patient_id = id where id = '${self}'`),
    /patients_referred_by_patient_not_self/,
  )
})

test('referral detail columns only carry values for their own source', { skip }, () => {
  const referrer = query(DB, `insert into patients (clinic_id, name) values ('${clinicId}', 'Detail Referrer') returning id`)
  assert.throws(
    () => query(DB, `insert into patients (clinic_id, name, referral_source, referred_by_patient_id) values ('${clinicId}', 'Wrong source', 'google', '${referrer}')`),
    /patients_referred_by_patient_source/,
  )
  assert.throws(
    () => query(DB, `insert into patients (clinic_id, name, referral_source, referral_other) values ('${clinicId}', 'Wrong other', 'walk_in', 'Instagram')`),
    /patients_referral_other_source/,
  )

  const id = query(DB, `insert into patients (clinic_id, name, referral_source, referral_other) values ('${clinicId}', 'Other typed', 'other', 'Instagram ad') returning id`)
  assert.equal(query(DB, `select referral_other from patients where id = '${id}'`), 'Instagram ad')
})
