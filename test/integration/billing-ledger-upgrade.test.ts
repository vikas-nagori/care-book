import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMigrationsAfter,
  buildDatabaseThrough,
  dropDatabase,
  postgresAvailable,
  query,
} from './db.ts'

const DB = 'carebook_it_billing_upgrade'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let patientId = ''
let packageId = ''
let packagePaymentId = ''
let unpaidPackageId = ''
let cancelledPackageId = ''
let deletedTypePackageId = ''
let firstEligible = ''
let secondEligible = ''
let ordinaryPartialAppointmentId = ''
let ordinaryPartialPaymentId = ''
let isolatedPatientId = ''
let isolatedPartialAppointmentId = ''
let isolatedLaterAppointmentId = ''
let isolatedOrdinaryPaymentId = ''
let isolatedPackageId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabaseThrough(DB, '030_staff_appointment_payment_guard.sql')
  clinicId = query(DB, `insert into clinics (name) values ('Upgrade Clinic') returning id`)
  patientId = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Legacy Patient', '1') returning id`)
  const clinicTypeId = query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = 'Clinic'`)
  const homeTypeId = query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = 'Home'`)

  query(DB, `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee) values ('${clinicId}', '${patientId}', date '2026-07-31', '09:00', '${clinicTypeId}', 'completed', 100)`)
  ordinaryPartialAppointmentId = query(DB, `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee) values ('${clinicId}', '${patientId}', date '2026-08-01', '08:00', '${clinicTypeId}', 'completed', 100) returning id`)
  firstEligible = query(DB, `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee) values ('${clinicId}', '${patientId}', date '2026-08-01', '09:00', '${clinicTypeId}', 'completed', 100) returning id`)
  secondEligible = query(DB, `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee) values ('${clinicId}', '${patientId}', date '2026-08-02', '09:00', '${clinicTypeId}', 'scheduled', 100) returning id`)
  query(DB, `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee) values ('${clinicId}', '${patientId}', date '2026-08-03', '09:00', '${homeTypeId}', 'completed', 100)`)

  packageId = query(
    DB,
    `insert into packages (clinic_id, patient_id, name, total_sessions, used_sessions, total_amount, per_session_amount, paid_amount, payment_timing, status, created_at)
     values ('${clinicId}', '${patientId}', 'Legacy Package', 2, 2, 200, 100, 200, 'prepaid', 'active', timestamptz '2026-07-20 10:00:00+05:30') returning id`,
  )
  packagePaymentId = query(
    DB,
    `insert into payments (clinic_id, patient_id, package_id, amount, payment_method, date)
     values ('${clinicId}', '${patientId}', '${packageId}', 200, 'upi', date '2026-08-01') returning id`,
  )
  unpaidPackageId = query(
    DB,
    `insert into packages (clinic_id, patient_id, name, total_sessions, used_sessions, total_amount, per_session_amount, paid_amount, payment_timing, status, created_at)
     values ('${clinicId}', '${patientId}', 'Legacy No Receipt', 1, 0, 100, 100, 0, 'prepaid', 'active', timestamptz '2026-07-25 10:00:00+05:30') returning id`,
  )
  cancelledPackageId = query(
    DB,
    `insert into packages (clinic_id, patient_id, name, total_sessions, used_sessions, total_amount, per_session_amount, paid_amount, payment_timing, status, created_at)
     values ('${clinicId}', '${patientId}', 'Legacy Cancelled', 1, 0, 100, 100, 0, 'prepaid', 'cancelled', timestamptz '2026-07-26 10:00:00+05:30') returning id`,
  )

  // Clinics may rename their seeded logical Clinic type before this migration.
  query(DB, `update appointment_types set name = 'Renamed Clinic' where id = '${clinicTypeId}'`)

  const deletedTypeClinicId = query(DB, `insert into clinics (name) values ('Deleted Type Clinic') returning id`)
  const deletedTypePatientId = query(DB, `insert into patients (clinic_id, name, phone) values ('${deletedTypeClinicId}', 'Deleted Type Patient', '2') returning id`)
  query(DB, `insert into global_settings (clinic_id, clinic_fee) values ('${deletedTypeClinicId}', 650)`)
  query(DB, `delete from appointment_types where clinic_id = '${deletedTypeClinicId}' and name = 'Clinic'`)
  deletedTypePackageId = query(
    DB,
    `insert into packages (clinic_id, patient_id, name, total_sessions, used_sessions, total_amount, per_session_amount, paid_amount, payment_timing, status, created_at)
     values ('${deletedTypeClinicId}', '${deletedTypePatientId}', 'Deleted Clinic Type', 1, 0, 100, 100, 0, 'prepaid', 'active', timestamptz '2026-07-27 10:00:00+05:30') returning id`,
  )

  isolatedPatientId = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Isolated Legacy Partial', '3') returning id`)
  query(DB, `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee) values ('${clinicId}', '${isolatedPatientId}', date '2026-07-31', '09:00', '${clinicTypeId}', 'completed', 100)`)
  isolatedPartialAppointmentId = query(DB, `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee) values ('${clinicId}', '${isolatedPatientId}', date '2026-08-01', '09:00', '${clinicTypeId}', 'completed', 100) returning id`)
  isolatedLaterAppointmentId = query(DB, `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee) values ('${clinicId}', '${isolatedPatientId}', date '2026-08-02', '09:00', '${clinicTypeId}', 'scheduled', 100) returning id`)
  isolatedPackageId = query(
    DB,
    `insert into packages (clinic_id, patient_id, name, total_sessions, used_sessions, total_amount, per_session_amount, paid_amount, payment_timing, status, created_at)
     values ('${clinicId}', '${isolatedPatientId}', 'Isolated Overlap', 1, 0, 100, 100, 100, 'prepaid', 'active', timestamptz '2026-07-20 10:00:00+05:30') returning id`,
  )
  query(DB, `insert into payments (clinic_id, patient_id, package_id, amount, payment_method, date) values ('${clinicId}', '${isolatedPatientId}', '${isolatedPackageId}', 100, 'upi', date '2026-08-01')`)

  // Seed this last so no legacy allocator trigger can normalize away the partial link
  // before the v2 migration has a chance to preserve it.
  ordinaryPartialPaymentId = query(
    DB,
    `insert into payments (clinic_id, patient_id, amount, payment_method, date)
     values ('${clinicId}', '${patientId}', 40, 'cash', date '2026-08-01') returning id`,
  )
  query(
    DB,
    `insert into appointment_payments (payment_id, appointment_id, amount_applied, created_at)
     values ('${ordinaryPartialPaymentId}', '${ordinaryPartialAppointmentId}', 40, timestamptz '2026-08-01 12:00:00+05:30')`,
  )
  assert.equal(
    query(DB, `select amount_applied from appointment_payments where payment_id = '${ordinaryPartialPaymentId}' and appointment_id = '${ordinaryPartialAppointmentId}'`),
    '40.00',
  )
  isolatedOrdinaryPaymentId = query(
    DB,
    `insert into payments (clinic_id, patient_id, amount, payment_method, date)
     values ('${clinicId}', '${isolatedPatientId}', 40, 'cash', date '2026-08-01') returning id`,
  )
  query(
    DB,
    `insert into appointment_payments (payment_id, appointment_id, amount_applied, created_at)
     values ('${isolatedOrdinaryPaymentId}', '${isolatedPartialAppointmentId}', 40, timestamptz '2026-08-01 13:00:00+05:30')`,
  )
  query(
    DB,
    `insert into appointment_payments (payment_id, appointment_id, amount_applied, created_at)
     values ('${isolatedOrdinaryPaymentId}', '${isolatedLaterAppointmentId}', 40, timestamptz '2026-08-01 14:00:00+05:30')`,
  )
  assert.equal(
    query(DB, `select count(*) || '/' || sum(amount_applied) from appointment_payments where payment_id = '${isolatedOrdinaryPaymentId}'`),
    '2/80.00',
    'the legacy schema permits aggregate applications above receipt capacity',
  )

  applyMigrationsAfter(DB, '030_staff_appointment_payment_guard.sql')
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('legacy packages are backfilled and reconciled without stranding package money', { skip }, () => {
  assert.equal(
    query(
      DB,
      `select at.name || '/' || p.starts_on || '/' || p.billing_version
       from packages p join appointment_types at on at.id = p.appointment_type_id
       where p.id = '${packageId}'`,
    ),
    'Renamed Clinic/2026-08-01/2',
  )
  assert.equal(
    query(DB, `select string_agg(appointment_id::text, ',' order by appointment_id::text) from package_session_allocations where package_id = '${packageId}' and lifecycle <> 'released'`),
    [firstEligible, secondEligible].sort().join(','),
  )
  assert.equal(query(DB, `select coalesce(sum(amount), 0) from payment_applications where payment_id = '${packagePaymentId}' and status = 'active'`), '200.00')
  assert.equal(query(DB, `select net_received || '/' || applied_amount || '/' || due_amount || '/' || refundable_credit from package_billing_balances_v2 where package_id = '${packageId}'`), '200.00/200.00/0.00/0.00')
  assert.deepEqual(
    JSON.parse(query(DB, `select json_object_agg(appointment_id, amount_applied) from appointment_payments where payment_id = '${packagePaymentId}'`)),
    { [firstEligible]: 100, [secondEligible]: 100 },
    'legacy reads mirror the authoritative v2 applications through UI cutover',
  )
  assert.equal(
    query(DB, `select count(*) from package_session_allocations where appointment_reference_id = '${ordinaryPartialAppointmentId}' and lifecycle <> 'released'`),
    '0',
    'a legacy ordinary partial application must prevent package claiming during the first v2 reconciliation',
  )
  assert.equal(
    query(DB, `select funding_scope || '/' || amount || '/' || status || '/' || allocation_origin from payment_applications where payment_id = '${ordinaryPartialPaymentId}' order by applied_at desc limit 1`),
    'ordinary/40.00/active/legacy_import',
  )
  assert.equal(
    query(DB, `select count(*) || '/' || bool_and(applied_at = timestamptz '2026-08-01 12:00:00+05:30')::text from payment_applications where payment_id = '${ordinaryPartialPaymentId}'`),
    '1/true',
    'the immutable application is migrated once with its original timestamp',
  )
  assert.equal(query(DB, `select payment_status from appointments where id = '${ordinaryPartialAppointmentId}'`), 'partially_paid')
  assert.equal(
    query(DB, `select count(*) from payment_applications application join appointment_charges charge on charge.id = application.charge_id where charge.appointment_reference_id = '${ordinaryPartialAppointmentId}' and application.funding_scope = 'package' and application.status = 'active'`),
    '0',
    'package receipts must not cross-fund the ordinary-partially-paid appointment',
  )
  const beforeRepeat = query(
    DB,
    `select (select count(*) from payment_applications where patient_id = '${patientId}') || '/'
      || (select count(*) from package_session_allocations where patient_id = '${patientId}')`,
  )
  query(DB, `select private.reconcile_patient_billing_v2('${patientId}')`)
  assert.equal(
    query(
      DB,
      `select (select count(*) from payment_applications where patient_id = '${patientId}') || '/'
        || (select count(*) from package_session_allocations where patient_id = '${patientId}')`,
    ),
    beforeRepeat,
    'repeat reconciliation must not destroy or duplicate the migrated ordinary application',
  )
  assert.equal(
    query(DB, `select appointment_reference_id from package_session_allocations where package_id = '${isolatedPackageId}' and lifecycle <> 'released'`),
    isolatedLaterAppointmentId,
  )
  assert.equal(
    query(DB, `select charge.appointment_reference_id || '/' || application.amount from payment_applications application join appointment_charges charge on charge.id = application.charge_id where application.payment_id = '${isolatedOrdinaryPaymentId}' and application.status = 'active'`),
    `${isolatedPartialAppointmentId}/40.00`,
  )
  const isolatedBeforeRepeat = query(
    DB,
    `select jsonb_build_object(
       'applications', (select jsonb_agg(jsonb_build_array(payment_id, charge_id, amount, status, allocation_origin) order by payment_id, charge_id, applied_at) from payment_applications where patient_id = '${isolatedPatientId}'),
       'allocations', (select jsonb_agg(jsonb_build_array(package_id, appointment_reference_id, lifecycle) order by package_id, appointment_reference_id, created_at) from package_session_allocations where patient_id = '${isolatedPatientId}')
     )`,
  )
  query(DB, `select private.reconcile_patient_billing_v2('${isolatedPatientId}')`)
  assert.equal(
    query(
      DB,
      `select jsonb_build_object(
         'applications', (select jsonb_agg(jsonb_build_array(payment_id, charge_id, amount, status, allocation_origin) order by payment_id, charge_id, applied_at) from payment_applications where patient_id = '${isolatedPatientId}'),
         'allocations', (select jsonb_agg(jsonb_build_array(package_id, appointment_reference_id, lifecycle) order by package_id, appointment_reference_id, created_at) from package_session_allocations where patient_id = '${isolatedPatientId}')
       )`,
    ),
    isolatedBeforeRepeat,
    'the migrated mappings, not merely row counts, must be a reconciliation fixed point',
  )
  assert.equal(query(DB, `select starts_on || '/' || billing_version from packages where id = '${unpaidPackageId}'`), '2026-07-25/2')
  assert.equal(
    query(DB, `select starts_on || '/' || billing_version || '/' || (cancelled_at::date = current_date)::text || '/' || cancellation_reason from packages where id = '${cancelledPackageId}'`),
    '2026-07-26/2/true/Legacy cancelled package migrated to v2',
  )
  assert.equal(
    query(DB, `select count(*) from billing_events where entity_id = '${cancelledPackageId}' and event_type = 'legacy_package_cancellation_migrated'`),
    '1',
  )
  assert.equal(
    query(DB, `select appointment_type.name || '/' || appointment_type.session_rate || '/' || package.billing_version from packages package join appointment_types appointment_type on appointment_type.id = package.appointment_type_id where package.id = '${deletedTypePackageId}'`),
    'Clinic/650.00/2',
  )
})
