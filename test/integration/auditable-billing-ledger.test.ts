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

  assert.equal(rpc(adminId, `public.void_payment('${paymentId}', 'entered against wrong patient')`).success, true)
  assert.equal(query(DB, `select status from payments where id = '${paymentId}'`), 'voided')
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
  }
  assert.throws(
    () => queryAsAuthenticated(DB, adminId, `insert into billing_events (clinic_id, patient_id, event_type, entity_type, entity_id) values ('${clinicId}', '${patientId}', 'forged', 'patient', '${patientId}') returning id`),
    /permission denied|row-level security/i,
  )

  for (const signature of [
    'record_billing_entry_v2(uuid,text,text,integer,numeric,uuid,date,numeric,text,date,text)',
    'record_payment_v2(uuid,text,uuid,numeric,text,date,text)',
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
})
