import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDatabase,
  dropDatabase,
  postgresAvailable,
  query,
  queryAs,
  queryAsAuthenticated,
  seedUser,
} from './db.ts'

const DB = 'carebook_it_billing_ledger_v2'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let otherClinicId = ''
let adminId = ''
let staffId = ''
let otherAdminId = ''
let clinicTypeId = ''
let homeTypeId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Ledger Clinic') returning id`)
  otherClinicId = query(DB, `insert into clinics (name) values ('Other Ledger Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
  otherAdminId = seedUser(DB, 'admin', otherClinicId)
  clinicTypeId = query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = 'Clinic'`)
  homeTypeId = query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = 'Home'`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function patient(label: string, targetClinic = clinicId): string {
  return query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${targetClinic}', '${label}', '1') returning id`,
  )
}

function appointment(
  patientId: string,
  date: string,
  typeId = clinicTypeId,
  status: 'scheduled' | 'completed' = 'scheduled',
  fee = 100,
): string {
  return query(
    DB,
    `insert into appointments (clinic_id, patient_id, date, time, appointment_type_id, status, fee)
     values ('${clinicId}', '${patientId}', date '${date}', '09:00', '${typeId}', '${status}', ${fee})
     returning id`,
  )
}

function rpc(userId: string, expression: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, userId, `select ${expression}`))
}

function createPackage(
  patientId: string,
  name: string,
  sessions: number,
  rate: number,
  typeId: string,
  startsOn: string,
  amount = sessions * rate,
): Record<string, unknown> {
  return rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patientId}', 'package_with_payment', '${name}', ${sessions}, ${rate},
      '${typeId}', date '${startsOn}', ${amount}, 'cash', date '${startsOn}', null
    )`,
  )
}

function recordPayment(
  patientId: string,
  scope: 'ordinary' | 'package',
  amount: number,
  packageId: string | null = null,
): Record<string, unknown> {
  return rpc(
    adminId,
    `public.record_payment_v2(
      '${patientId}', '${scope}', ${packageId ? `'${packageId}'` : 'null'},
      ${amount}, 'cash', current_date, null
    )`,
  )
}

test('the single reconciler derives charges, scoped partial applications, and lifecycle state', { skip }, () => {
  const patientId = patient('Direct Reconciler')
  const first = appointment(patientId, '2026-08-01', clinicTypeId, 'scheduled', 120)
  const second = appointment(patientId, '2026-08-02', clinicTypeId, 'scheduled', 100)
  const packageId = query(
    DB,
    `insert into packages (
       clinic_id, patient_id, name, total_sessions, used_sessions, total_amount, per_session_amount,
       paid_amount, payment_timing, status, appointment_type_id, starts_on, billing_version
     ) values (
       '${clinicId}', '${patientId}', 'Direct package', 1, 0, 100, 100,
       0, 'prepaid', 'active', '${clinicTypeId}', date '2026-08-01', 2
     ) returning id`,
  )
  query(
    DB,
    `insert into payments (
       clinic_id, patient_id, package_id, amount, payment_method, date, funding_scope, status, billing_version
     ) values ('${clinicId}', '${patientId}', '${packageId}', 100, 'cash', date '2026-08-01', 'package', 'posted', 2)`,
  )

  assert.equal(query(DB, `select status from appointment_charges where appointment_id = '${first}'`), 'pending')
  assert.equal(query(DB, `select payment_status from appointments where id = '${first}'`), 'partially_prepaid')
  assert.equal(query(DB, `select lifecycle from package_session_allocations where appointment_id = '${first}' and lifecycle <> 'released'`), 'scheduled')
  assert.equal(query(DB, `select count(*) from package_session_allocations where appointment_id = '${second}' and lifecycle <> 'released'`), '0')

  query(DB, `update appointments set status = 'completed' where id = '${first}'`)
  assert.equal(query(DB, `select status from packages where id = '${packageId}'`), 'completed')
  query(DB, `update appointments set status = 'cancelled' where id = '${first}'`)
  assert.equal(query(DB, `select status from packages where id = '${packageId}'`), 'active')
  assert.equal(query(DB, `select lifecycle from package_session_allocations where appointment_id = '${second}' and lifecycle <> 'released'`), 'scheduled')

  const countsBefore = query(
    DB,
    `select (select count(*) from payment_applications where patient_id = '${patientId}') || '/'
      || (select count(*) from package_session_allocations where patient_id = '${patientId}')`,
  )
  assert.equal(rpc(adminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, true)
  assert.equal(
    query(
      DB,
      `select (select count(*) from payment_applications where patient_id = '${patientId}') || '/'
        || (select count(*) from package_session_allocations where patient_id = '${patientId}')`,
    ),
    countsBefore,
  )
})

test('v2 package creation requires an exact appointment type and independent start date', { skip }, () => {
  const patientId = patient('Required Package Fields')

  const missingType = rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patientId}', 'package_with_payment', 'Missing type', 1, 100,
      null, date '2026-08-01', 100, 'cash', date '2026-08-01', null
    )`,
  )
  const missingStart = rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patientId}', 'package_with_payment', 'Missing start', 1, 100,
      '${clinicTypeId}', null, 100, 'cash', date '2026-08-01', null
    )`,
  )

  assert.equal(missingType.success, false)
  assert.equal(missingStart.success, false)
  assert.equal(query(DB, `select count(*) from packages where patient_id = '${patientId}'`), '0')
})

test('packages claim only exact-type, on-or-after-start appointments in created-first order', { skip }, () => {
  const patientId = patient('Eligibility and Overlap')
  const beforeStart = appointment(patientId, '2026-07-31')
  const firstEligible = appointment(patientId, '2026-08-01')
  const secondEligible = appointment(patientId, '2026-08-02')
  const wrongType = appointment(patientId, '2026-08-03', homeTypeId)

  const first = createPackage(patientId, 'First', 1, 100, clinicTypeId, '2026-08-01')
  const second = createPackage(patientId, 'Second', 2, 100, clinicTypeId, '2026-08-01')

  assert.equal(first.success, true)
  assert.equal(second.success, true)
  const allocation = JSON.parse(query(
    DB,
    `select json_object_agg(a.appointment_id, a.package_id)
     from package_session_allocations a where a.patient_id = '${patientId}' and a.lifecycle <> 'released'`,
  )) as Record<string, string>
  assert.equal(allocation[firstEligible], first.packageId)
  assert.equal(allocation[secondEligible], second.packageId)
  assert.equal(allocation[beforeStart], undefined)
  assert.equal(allocation[wrongType], undefined)
})

test('an active partial ordinary application prevents later package claiming', { skip }, () => {
  const patientId = patient('Ordinary Partial Skip')
  const apptId = appointment(patientId, '2026-08-05', clinicTypeId, 'completed', 100)

  const payment = recordPayment(patientId, 'ordinary', 40)
  assert.equal(payment.success, true)
  assert.equal(query(DB, `select payment_status from appointments where id = '${apptId}'`), 'partially_paid')

  createPackage(patientId, 'Cannot steal', 1, 100, clinicTypeId, '2026-08-01')
  assert.equal(
    query(DB, `select count(*) from package_session_allocations where appointment_id = '${apptId}' and lifecycle <> 'released'`),
    '0',
  )
})

test('package and ordinary scopes apply separately, FIFO, and allow package due', { skip }, () => {
  const patientId = patient('Separate Scope FIFO')
  const packageAppt = appointment(patientId, '2026-08-06', clinicTypeId, 'completed', 120)
  const ordinaryAppt = appointment(patientId, '2026-08-07', homeTypeId, 'completed', 100)
  const packageEntry = createPackage(patientId, 'Short package', 1, 100, clinicTypeId, '2026-08-01', 100)
  const ordinaryPayment = recordPayment(patientId, 'ordinary', 60)

  assert.equal(packageEntry.success, true)
  assert.equal(ordinaryPayment.success, true)
  assert.equal(query(DB, `select payment_status from appointments where id = '${packageAppt}'`), 'partially_prepaid')
  assert.equal(query(DB, `select payment_status from appointments where id = '${ordinaryAppt}'`), 'partially_paid')
  assert.equal(
    query(DB, `select due_amount from package_billing_balances_v2 where package_id = '${packageEntry.packageId}'`),
    '20.00',
  )
  assert.equal(
    query(DB, `select count(*) from payment_applications pa join payments p on p.id = pa.payment_id where pa.charge_id = (select id from appointment_charges where appointment_id = '${packageAppt}') and p.funding_scope = 'ordinary' and pa.status = 'active'`),
    '0',
    'ordinary money must never cover a package shortage',
  )
})

test('ordinary receipts distribute FIFO across multiple charges with exact partial amounts', { skip }, () => {
  const patientId = patient('Ordinary FIFO')
  const firstCharge = appointment(patientId, '2026-08-01', clinicTypeId, 'completed', 100)
  const secondCharge = appointment(patientId, '2026-08-02', clinicTypeId, 'completed', 100)
  const firstReceipt = recordPayment(patientId, 'ordinary', 150)
  const secondReceipt = recordPayment(patientId, 'ordinary', 75)

  assert.deepEqual(
    JSON.parse(query(
      DB,
      `select json_agg(json_build_object('payment', payment_id, 'appointment', c.appointment_id, 'amount', pa.amount) order by p.date, p.created_at, a.date, a.time)
       from payment_applications pa
       join payments p on p.id = pa.payment_id
       join appointment_charges c on c.id = pa.charge_id
       join appointments a on a.id = c.appointment_id
       where pa.patient_id = '${patientId}' and pa.status = 'active'`,
    )),
    [
      { payment: firstReceipt.paymentId, appointment: firstCharge, amount: 100 },
      { payment: firstReceipt.paymentId, appointment: secondCharge, amount: 50 },
      { payment: secondReceipt.paymentId, appointment: secondCharge, amount: 50 },
    ],
  )
  assert.equal(query(DB, `select payment_status from appointments where id = '${secondCharge}'`), 'paid')
})

test('package receipts distribute FIFO only within their package with exact partial amounts', { skip }, () => {
  const patientId = patient('Package FIFO')
  const firstCharge = appointment(patientId, '2026-08-01', clinicTypeId, 'completed', 120)
  const secondCharge = appointment(patientId, '2026-08-02', clinicTypeId, 'completed', 80)
  const entry = createPackage(patientId, 'Package FIFO', 2, 100, clinicTypeId, '2026-08-01', 100)
  const secondReceipt = recordPayment(patientId, 'package', 100, entry.packageId as string)

  assert.deepEqual(
    JSON.parse(query(
      DB,
      `select json_agg(json_build_object('payment', payment_id, 'appointment', c.appointment_id, 'amount', pa.amount) order by p.date, p.created_at, a.date, a.time)
       from payment_applications pa
       join payments p on p.id = pa.payment_id
       join appointment_charges c on c.id = pa.charge_id
       join appointments a on a.id = c.appointment_id
       where pa.patient_id = '${patientId}' and pa.status = 'active'`,
    )),
    [
      { payment: entry.paymentId, appointment: firstCharge, amount: 100 },
      { payment: secondReceipt.paymentId, appointment: firstCharge, amount: 20 },
      { payment: secondReceipt.paymentId, appointment: secondCharge, amount: 80 },
    ],
  )
  assert.equal(query(DB, `select count(*) from payment_applications where patient_id = '${patientId}' and funding_scope = 'ordinary'`), '0')
})

test('scheduled reservations become availed, complete and reopen, then release and reassign', { skip }, () => {
  const patientId = patient('Allocation Lifecycle')
  const reserved = appointment(patientId, '2026-08-08')
  const next = appointment(patientId, '2026-08-09')
  const entry = createPackage(patientId, 'One session', 1, 100, clinicTypeId, '2026-08-01')
  const packageId = entry.packageId as string

  assert.equal(query(DB, `select lifecycle from package_session_allocations where appointment_id = '${reserved}' and lifecycle <> 'released'`), 'scheduled')
  assert.equal(query(DB, `select scheduled_sessions || '/' || availed_sessions from package_billing_balances_v2 where package_id = '${packageId}'`), '1/0')

  query(DB, `update appointments set status = 'completed' where id = '${reserved}'`)
  assert.equal(query(DB, `select status from packages where id = '${packageId}'`), 'completed')
  assert.equal(query(DB, `select completed_at is not null from packages where id = '${packageId}'`), 't')

  query(DB, `update appointments set status = 'scheduled' where id = '${reserved}'`)
  assert.equal(query(DB, `select status from packages where id = '${packageId}'`), 'active')
  assert.equal(query(DB, `select completed_at is null from packages where id = '${packageId}'`), 't')

  query(DB, `update appointments set status = 'cancelled' where id = '${reserved}'`)
  assert.equal(query(DB, `select lifecycle from package_session_allocations where appointment_id = '${next}' and lifecycle <> 'released'`), 'scheduled')
  assert.equal(
    query(DB, `select count(*) from package_session_allocations where appointment_reference_id = '${reserved}' and lifecycle = 'released'`),
    '3',
    'scheduled → availed → scheduled → cancelled retains every released lifecycle transition',
  )
})

test('refunds, voids, package cancellation, and fee adjustments require reasons and retain audit rows', { skip }, () => {
  const patientId = patient('Audited Mutations')
  const apptId = appointment(patientId, '2026-08-10', clinicTypeId, 'completed', 100)
  const payment = recordPayment(patientId, 'ordinary', 100)
  const paymentId = payment.paymentId as string

  assert.equal(rpc(adminId, `public.record_refund('${paymentId}', 20, '')`).success, false)
  assert.equal(rpc(adminId, `public.void_payment('${paymentId}', '')`).success, false)
  assert.equal(rpc(adminId, `public.adjust_appointment_fee('${apptId}', 120, '')`).success, false)

  assert.equal(rpc(adminId, `public.record_refund('${paymentId}', 20, 'duplicate collection')`).success, true)
  assert.equal(rpc(adminId, `public.adjust_appointment_fee('${apptId}', 120, 'corrected actual fee')`).success, true)
  assert.equal(query(DB, `select count(*) from refunds where payment_id = '${paymentId}'`), '1')
  assert.equal(query(DB, `select count(*) from appointment_charge_adjustments where appointment_id = '${apptId}'`), '1')
  assert.equal(query(DB, `select payment_status from appointments where id = '${apptId}'`), 'partially_paid')

  const voidablePayment = recordPayment(patientId, 'ordinary', 10)
  assert.equal(rpc(adminId, `public.void_payment('${voidablePayment.paymentId}', 'entered against wrong patient')`).success, true)
  assert.equal(query(DB, `select status from payments where id = '${voidablePayment.paymentId}'`), 'voided')
  assert.equal(query(DB, `select count(*) from billing_events where patient_id = '${patientId}'`), '3')
})

test('package cancellation is audited, releases reservations, and retains receipts', { skip }, () => {
  const patientId = patient('Cancelled Package')
  const apptId = appointment(patientId, '2026-08-10')
  const entry = createPackage(patientId, 'Cancelled package', 1, 100, clinicTypeId, '2026-08-01')
  const packageId = entry.packageId as string
  const paymentId = entry.paymentId as string

  assert.equal(rpc(adminId, `public.cancel_package('${packageId}', '')`).success, false)
  assert.equal(rpc(adminId, `public.cancel_package('${packageId}', 'created in error')`).success, true)
  assert.equal(query(DB, `select status from packages where id = '${packageId}'`), 'cancelled')
  assert.equal(query(DB, `select count(*) from payments where id = '${paymentId}'`), '1')
  assert.equal(query(DB, `select lifecycle from package_session_allocations where appointment_id = '${apptId}' order by created_at desc limit 1`), 'released')
  assert.equal(query(DB, `select count(*) from billing_events where entity_id = '${packageId}' and event_type = 'package_cancelled'`), '1')
})

test('cancelling the older of two overlapping packages reassigns the earliest appointment', { skip }, () => {
  const patientId = patient('Overlapping Cancellation')
  const earliest = appointment(patientId, '2026-08-01')
  const later = appointment(patientId, '2026-08-02')
  const older = createPackage(patientId, 'Older', 1, 100, clinicTypeId, '2026-08-01')
  const newer = createPackage(patientId, 'Newer', 1, 100, clinicTypeId, '2026-08-01')

  assert.equal(query(DB, `select package_id from package_session_allocations where appointment_id = '${earliest}' and lifecycle <> 'released'`), older.packageId)
  assert.equal(query(DB, `select package_id from package_session_allocations where appointment_id = '${later}' and lifecycle <> 'released'`), newer.packageId)
  assert.equal(rpc(adminId, `public.cancel_package('${older.packageId}', 'replace overlapping package')`).success, true)
  assert.equal(query(DB, `select package_id from package_session_allocations where appointment_id = '${earliest}' and lifecycle <> 'released'`), newer.packageId)
  assert.equal(query(DB, `select count(*) from package_session_allocations where appointment_id = '${later}' and lifecycle <> 'released'`), '0')
})

test('dated refunds persist their method/date, enforce capacity, and prevent later voids', { skip }, () => {
  const patientId = patient('Refund Capacity')
  appointment(patientId, '2026-08-10', clinicTypeId, 'completed', 100)
  const payment = recordPayment(patientId, 'ordinary', 100)
  const paymentId = payment.paymentId as string

  const refund = rpc(adminId, `public.record_refund('${paymentId}', 20, 'upi', date '2026-07-30', 'approved correction')`)
  assert.equal(refund.success, true)
  assert.equal(query(DB, `select amount || '/' || refund_method || '/' || refund_date from refunds where id = '${refund.refundId}'`), '20.00/upi/2026-07-30')
  assert.equal(query(DB, `select coalesce(sum(amount), 0) from payment_applications where payment_id = '${paymentId}' and status = 'active'`), '80.00')
  assert.equal(
    query(DB, `select net_received || '/' || applied_amount || '/' || due_amount || '/' || refundable_credit from patient_billing_balances_v2 where patient_id = '${patientId}'`),
    '80.00/80.00/20.00/0.00',
    'the v2 balance surface stays net of refunds for UI cutover',
  )
  assert.equal(rpc(adminId, `public.record_refund('${paymentId}', 81, 'upi', date '2026-07-31', 'too much')`).success, false)
  assert.equal(rpc(adminId, `public.void_payment('${paymentId}', 'cannot void refunded receipt')`).success, false)
  assert.equal(query(DB, `select status from payments where id = '${paymentId}'`), 'posted')
})

test('one refund reconciliation normalizes imported commitments before package eligibility', { skip }, () => {
  const patientId = patient('Runtime Legacy Commitment Cap')
  const older = appointment(patientId, '2026-07-31', clinicTypeId, 'completed', 100)
  const protectedAppointment = appointment(patientId, '2026-08-01', clinicTypeId, 'completed', 100)
  const releasedAppointment = appointment(patientId, '2026-08-02', clinicTypeId, 'scheduled', 100)
  const ordinaryPayment = recordPayment(patientId, 'ordinary', 80)
  const paymentId = ordinaryPayment.paymentId as string

  query(
    DB,
    `update payment_applications
     set status = 'reversed', reversed_at = now(), reversal_reason = 'runtime legacy fixture'
     where payment_id = '${paymentId}' and status = 'active'`,
  )
  const protectedChargeId = query(DB, `select id from appointment_charges where appointment_id = '${protectedAppointment}'`)
  const releasedChargeId = query(DB, `select id from appointment_charges where appointment_id = '${releasedAppointment}'`)
  query(
    DB,
    `insert into payment_applications (
       clinic_id, patient_id, payment_id, charge_id, funding_scope, amount,
       allocation_origin, applied_at
     ) values
       ('${clinicId}', '${patientId}', '${paymentId}', '${protectedChargeId}', 'ordinary', 40, 'legacy_import', timestamptz '2026-08-01 12:00:00+05:30'),
       ('${clinicId}', '${patientId}', '${paymentId}', '${releasedChargeId}', 'ordinary', 40, 'legacy_import', timestamptz '2026-08-01 13:00:00+05:30')`,
  )

  const packageResult = createPackage(patientId, 'Runtime overlap', 1, 100, clinicTypeId, '2026-08-01')
  assert.equal(packageResult.success, true)
  assert.equal(query(DB, `select count(*) from package_session_allocations where package_id = '${packageResult.packageId}' and lifecycle <> 'released'`), '0')

  const refund = rpc(adminId, `public.record_refund('${paymentId}', 50, 'upi', current_date, 'reduce imported capacity')`)
  assert.equal(refund.success, true)
  assert.equal(
    query(DB, `select charge.appointment_reference_id || '/' || application.amount || '/' || application.allocation_origin from payment_applications application join appointment_charges charge on charge.id = application.charge_id where application.payment_id = '${paymentId}' and application.status = 'active'`),
    `${protectedAppointment}/30.00/legacy_import`,
  )
  assert.equal(
    query(DB, `select appointment_reference_id from package_session_allocations where package_id = '${packageResult.packageId}' and lifecycle <> 'released'`),
    releasedAppointment,
    'the same refund-triggered reconcile must claim the appointment whose commitment was released',
  )
  assert.equal(query(DB, `select payment_status from appointments where id = '${protectedAppointment}'`), 'partially_paid')
  assert.equal(query(DB, `select payment_status from appointments where id = '${releasedAppointment}'`), 'prepaid')
  assert.equal(query(DB, `select payment_status from appointments where id = '${older}'`), 'unpaid')

  const beforeRepeat = query(
    DB,
    `select jsonb_build_object(
       'applications', (select jsonb_agg(to_jsonb(application) order by application.id) from payment_applications application where application.patient_id = '${patientId}'),
       'allocations', (select jsonb_agg(to_jsonb(allocation) order by allocation.id) from package_session_allocations allocation where allocation.patient_id = '${patientId}')
     )`,
  )
  assert.equal(rpc(adminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, true)
  assert.equal(
    query(
      DB,
      `select jsonb_build_object(
         'applications', (select jsonb_agg(to_jsonb(application) order by application.id) from payment_applications application where application.patient_id = '${patientId}'),
         'allocations', (select jsonb_agg(to_jsonb(allocation) order by allocation.id) from package_session_allocations allocation where allocation.patient_id = '${patientId}')
       )`,
    ),
    beforeRepeat,
    'a second reconcile must preserve every row identity, state, and timestamp',
  )
})

test('legacy delete RPCs preserve rows by converting deletion to audited void and cancellation', { skip }, () => {
  const patientId = patient('Legacy Delete Compatibility')
  appointment(patientId, '2026-08-10')
  const entry = createPackage(patientId, 'Legacy package', 1, 100, clinicTypeId, '2026-08-01')
  const packageId = entry.packageId as string
  const paymentId = entry.paymentId as string

  assert.equal(rpc(adminId, `public.delete_payment('${paymentId}')`).success, true)
  assert.equal(query(DB, `select status from payments where id = '${paymentId}'`), 'voided')
  assert.equal(query(DB, `select count(*) from payments where id = '${paymentId}'`), '1')
  assert.throws(() => query(DB, `delete from payments where id = '${paymentId}'`), /immutable/i)

  assert.equal(rpc(adminId, `public.delete_package('${packageId}')`).success, true)
  assert.equal(query(DB, `select status from packages where id = '${packageId}'`), 'cancelled')
  assert.equal(query(DB, `select count(*) from packages where id = '${packageId}'`), '1')
  assert.throws(() => query(DB, `delete from packages where id = '${packageId}'`), /immutable/i)
})

test('deleting a scheduled appointment preserves a reconstructable released ledger history', { skip }, () => {
  const patientId = patient('Appointment History')
  const apptId = appointment(patientId, '2026-08-10')
  createPackage(patientId, 'History package', 1, 100, clinicTypeId, '2026-08-01')
  const chargeId = query(DB, `select id from appointment_charges where appointment_id = '${apptId}'`)
  const allocationId = query(DB, `select id from package_session_allocations where appointment_id = '${apptId}' and lifecycle <> 'released'`)

  query(DB, `delete from appointments where id = '${apptId}'`)

  assert.equal(query(DB, `select status || '/' || (appointment_id is null)::text || '/' || (appointment_reference_id = '${apptId}')::text from appointment_charges where id = '${chargeId}'`), 'voided/true/true')
  assert.equal(query(DB, `select lifecycle || '/' || (appointment_id is null)::text || '/' || (appointment_reference_id = '${apptId}')::text from package_session_allocations where id = '${allocationId}'`), 'released/true/true')
  assert.equal(query(DB, `select count(*) from billing_events where entity_id = '${apptId}' and event_type = 'appointment_deleted'`), '1')
})

test('completed appointment fees can change only through the audited adjustment RPC', { skip }, () => {
  const patientId = patient('Fee Guard')
  const apptId = appointment(patientId, '2026-08-10', clinicTypeId, 'completed', 100)

  assert.throws(() => query(DB, `update appointments set fee = 120 where id = '${apptId}'`), /adjust_appointment_fee/i)
  assert.equal(rpc(adminId, `public.adjust_appointment_fee('${apptId}', 120, 'correct actual fee')`).success, true)
  assert.equal(query(DB, `select fee from appointments where id = '${apptId}'`), '120.00')
  assert.equal(query(DB, `select adjusted_amount from appointment_charge_adjustments where appointment_id = '${apptId}'`), '120.00')
})

test('reconciliation is idempotent and does not append duplicate active ledger rows', { skip }, () => {
  const patientId = patient('Idempotent')
  appointment(patientId, '2026-08-11', clinicTypeId, 'completed', 100)
  recordPayment(patientId, 'ordinary', 50)
  const before = query(DB, `select count(*) || '/' || (select count(*) from billing_events where patient_id = '${patientId}') from payment_applications where patient_id = '${patientId}'`)

  assert.equal(rpc(adminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, true)
  assert.equal(rpc(adminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, true)

  const afterCount = query(DB, `select count(*) || '/' || (select count(*) from billing_events where patient_id = '${patientId}') from payment_applications where patient_id = '${patientId}'`)
  assert.equal(afterCount, before)
})

test('authenticated admins cannot directly rewrite receipt, package, or ledger priority fields', { skip }, () => {
  const patientId = patient('Immutable Direct Writes')
  const otherPatientId = patient('Immutable Direct Writes Other')
  const apptId = appointment(patientId, '2026-08-11', clinicTypeId, 'completed', 100)
  const entry = createPackage(patientId, 'Immutable package', 1, 100, clinicTypeId, '2026-08-01')
  const packageId = entry.packageId as string
  const paymentId = entry.paymentId as string

  assert.throws(() => query(DB, `update payments set date = date '2020-01-01' where id = '${paymentId}'`), /immutable/i)
  assert.throws(() => query(DB, `update packages set starts_on = date '2020-01-01' where id = '${packageId}'`), /immutable/i)

  for (const statement of [
    `insert into payments (clinic_id, patient_id, amount, payment_method, date, funding_scope, status, billing_version) values ('${clinicId}', '${patientId}', 10, 'cash', current_date, 'ordinary', 'posted', 2)`,
    `update payments set amount = 999 where id = '${paymentId}'`,
    `update payments set date = date '2020-01-01' where id = '${paymentId}'`,
    `update payments set payment_method = 'upi' where id = '${paymentId}'`,
    `update payments set patient_id = '${otherPatientId}' where id = '${paymentId}'`,
    `update payments set funding_scope = 'ordinary', package_id = null where id = '${paymentId}'`,
    `delete from payments where id = '${paymentId}'`,
    `insert into packages (clinic_id, patient_id, name, total_sessions, total_amount, per_session_amount, payment_timing, status, appointment_type_id, starts_on, billing_version) values ('${clinicId}', '${patientId}', 'forged', 1, 100, 100, 'prepaid', 'active', '${clinicTypeId}', current_date, 2)`,
    `update packages set appointment_type_id = '${homeTypeId}' where id = '${packageId}'`,
    `update packages set starts_on = date '2020-01-01' where id = '${packageId}'`,
    `update packages set created_at = timestamptz '2020-01-01 00:00:00+00' where id = '${packageId}'`,
    `update packages set total_sessions = 99 where id = '${packageId}'`,
    `delete from packages where id = '${packageId}'`,
  ]) {
    assert.throws(() => queryAsAuthenticated(DB, adminId, statement), /permission denied|row-level security/i)
  }

  const refund = rpc(adminId, `public.record_refund('${paymentId}', 10, 'upi', current_date, 'immutability fixture')`)
  const adjustment = rpc(adminId, `public.adjust_appointment_fee('${apptId}', 110, 'immutability fixture')`)
  assert.equal(refund.success, true)
  assert.equal(adjustment.success, true)
  const chargeId = query(DB, `select id from appointment_charges where appointment_id = '${apptId}'`)
  const applicationId = query(DB, `select id from payment_applications where charge_id = '${chargeId}' and status = 'active'`)
  const allocationId = query(DB, `select id from package_session_allocations where appointment_id = '${apptId}' and lifecycle <> 'released'`)
  const eventId = query(DB, `select id from billing_events where patient_id = '${patientId}' order by created_at limit 1`)
  for (const statement of [
    `update appointment_charges set amount = 999 where id = '${chargeId}'`,
    `delete from appointment_charges where id = '${chargeId}'`,
    `update appointment_charge_adjustments set reason = 'forged' where id = '${adjustment.adjustmentId}'`,
    `delete from appointment_charge_adjustments where id = '${adjustment.adjustmentId}'`,
    `update refunds set amount = 1 where id = '${refund.refundId}'`,
    `delete from refunds where id = '${refund.refundId}'`,
    `update payment_applications set amount = 999 where id = '${applicationId}'`,
    `delete from payment_applications where id = '${applicationId}'`,
    `update package_session_allocations set lifecycle = 'released' where id = '${allocationId}'`,
    `delete from package_session_allocations where id = '${allocationId}'`,
    `update billing_events set reason = 'forged' where id = '${eventId}'`,
    `delete from billing_events where id = '${eventId}'`,
    `insert into billing_events (clinic_id, patient_id, event_type, entity_type, entity_id) values ('${clinicId}', '${patientId}', 'forged', 'patient', '${patientId}')`,
  ]) {
    assert.throws(() => queryAsAuthenticated(DB, adminId, statement), /permission denied|row-level security/i)
  }
})

test('deleting an auth actor preserves immutable package, payment, and event history', { skip }, () => {
  const actorId = seedUser(DB, 'admin', clinicId)
  const patientId = patient('Deleted Audit Actor')
  const packageResult = rpc(
    actorId,
    `public.record_billing_entry_v2(
      '${patientId}', 'package_with_payment', 'Actor package', 1, 100,
      '${clinicTypeId}', date '2026-08-01', 100, 'cash', date '2026-08-01', null
    )`,
  )
  const ordinaryPayment = rpc(
    actorId,
    `public.record_payment_v2('${patientId}', 'ordinary', null, 25, 'cash', current_date, null)`,
  )
  assert.equal(rpc(actorId, `public.cancel_package('${packageResult.packageId}', 'actor fixture')`).success, true)
  assert.equal(rpc(actorId, `public.void_payment('${ordinaryPayment.paymentId}', 'actor fixture')`).success, true)

  query(DB, `delete from auth.users where id = '${actorId}'`)

  assert.equal(query(DB, `select (cancelled_by is null)::text from packages where id = '${packageResult.packageId}'`), 'true')
  assert.equal(query(DB, `select (voided_by is null)::text from payments where id = '${ordinaryPayment.paymentId}'`), 'true')
  assert.equal(query(DB, `select count(*) from billing_events where patient_id = '${patientId}' and actor_id is null`), '2')
})

test('billing ledger RLS and RPCs isolate clinics and block staff', { skip }, () => {
  const patientId = patient('Tenant Ledger')
  appointment(patientId, '2026-08-12', clinicTypeId, 'completed', 100)
  recordPayment(patientId, 'ordinary', 100)

  assert.equal(queryAsAuthenticated(DB, adminId, `select count(*) from payments where patient_id = '${patientId}'`), '1')
  assert.equal(queryAsAuthenticated(DB, staffId, `select count(*) from payments where patient_id = '${patientId}'`), '0')
  assert.equal(queryAsAuthenticated(DB, otherAdminId, `select count(*) from payments where patient_id = '${patientId}'`), '0')
  assert.equal(rpc(staffId, `public.reconcile_patient_billing_v2('${patientId}')`).success, false)
  assert.equal(rpc(otherAdminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, false)
  assert.equal(rpc(otherAdminId, `public.preview_billing_allocation_v2('${patientId}')`).success, false)

  const expectedAdminRows: Record<string, string> = {
    appointment_charges: '1',
    appointment_charge_adjustments: '0',
    refunds: '0',
    payment_applications: '1',
    package_session_allocations: '0',
    billing_events: '0',
  }
  for (const table of Object.keys(expectedAdminRows)) {
    assert.equal(queryAsAuthenticated(DB, adminId, `select count(*) from ${table} where patient_id = '${patientId}'`), expectedAdminRows[table])
    assert.equal(queryAsAuthenticated(DB, staffId, `select count(*) from ${table} where patient_id = '${patientId}'`), '0')
    assert.equal(queryAsAuthenticated(DB, otherAdminId, `select count(*) from ${table} where patient_id = '${patientId}'`), '0')
  }
  for (const table of ['packages', 'payments', 'appointment_payments', ...Object.keys(expectedAdminRows)]) {
    assert.throws(
      () => query(DB, `set role anon; select count(*) from ${table}; reset role`),
      /permission denied/i,
      `anonymous must not read ${table}`,
    )
  }
  assert.throws(
    () => queryAsAuthenticated(DB, adminId, `insert into billing_events (clinic_id, patient_id, event_type, entity_type, entity_id) values ('${clinicId}', '${patientId}', 'forged', 'patient', '${patientId}') returning id`),
    /permission denied|row-level security/i,
  )

  for (const signature of [
    'record_billing_entry_v2(uuid,text,text,integer,numeric,uuid,date,numeric,text,date,text)',
    'record_payment_v2(uuid,text,uuid,numeric,text,date,text)',
    'record_refund(uuid,numeric,text,date,text)',
    'record_refund(uuid,numeric,text)',
    'void_payment(uuid,text)',
    'cancel_package(uuid,text)',
    'adjust_appointment_fee(uuid,numeric,text)',
    'reconcile_patient_billing_v2(uuid)',
    'preview_billing_allocation_v2(uuid)',
  ]) {
    assert.equal(query(DB, `select has_function_privilege('anon', 'public.${signature}', 'execute')`), 'f')
    assert.equal(query(DB, `select has_function_privilege('authenticated', 'public.${signature}', 'execute')`), 't')
  }

  const packageEntry = createPackage(patientId, 'RPC isolation', 1, 100, clinicTypeId, '2026-08-01')
  const packageId = packageEntry.packageId as string
  const paymentId = packageEntry.paymentId as string
  const apptId = appointment(patientId, '2026-08-13', clinicTypeId, 'completed', 100)
  for (const [userId, expressions] of [
    [staffId, [
      `public.record_billing_entry_v2('${patientId}', 'package_with_payment', 'blocked', 1, 100, '${clinicTypeId}', date '2026-08-01', 100, 'cash', current_date, null)`,
      `public.record_payment_v2('${patientId}', 'ordinary', null, 10, 'cash', current_date, null)`,
      `public.record_refund('${paymentId}', 1, 'blocked')`,
      `public.record_refund('${paymentId}', 1, 'cash', current_date, 'blocked')`,
      `public.void_payment('${paymentId}', 'blocked')`,
      `public.cancel_package('${packageId}', 'blocked')`,
      `public.adjust_appointment_fee('${apptId}', 110, 'blocked')`,
    ]],
    [otherAdminId, [
      `public.record_billing_entry_v2('${patientId}', 'package_with_payment', 'cross clinic', 1, 100, '${clinicTypeId}', date '2026-08-01', 100, 'cash', current_date, null)`,
      `public.record_payment_v2('${patientId}', 'ordinary', null, 10, 'cash', current_date, null)`,
      `public.record_refund('${paymentId}', 1, 'cross clinic')`,
      `public.record_refund('${paymentId}', 1, 'cash', current_date, 'cross clinic')`,
      `public.void_payment('${paymentId}', 'cross clinic')`,
      `public.cancel_package('${packageId}', 'cross clinic')`,
      `public.adjust_appointment_fee('${apptId}', 110, 'cross clinic')`,
    ]],
  ] as const) {
    for (const expression of expressions) assert.equal(rpc(userId, expression).success, false)
  }
  assert.throws(
    () => query(DB, `set role anon; select public.record_payment_v2('${patientId}', 'ordinary', null, 10, 'cash', current_date, null); reset role`),
    /permission denied/i,
  )
})
