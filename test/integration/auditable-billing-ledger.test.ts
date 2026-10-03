import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
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

function concurrentSql(sql: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'psql',
      ['-d', DB, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-c', sql],
      { encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }))
        else resolve({ stdout, stderr })
      },
    )
  })
}

async function waitForPatientBillingLock(patientId: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (query(DB, `select private.try_lock_patient_billing_v2('${patientId}')`) === 'f') return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`patient billing lock was not observed for ${patientId}`)
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

test('v2 package creation rejects a receipt that does not cover the package in full', { skip }, () => {
  const patientId = patient('Prepaid Package Guard')

  const partial = rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patientId}', 'package_with_payment', 'Partial receipt', 4, 100,
      '${clinicTypeId}', date '2026-08-01', 250, 'cash', date '2026-08-01', null
    )`,
  )
  const overpaid = rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patientId}', 'package_with_payment', 'Overpaid receipt', 4, 100,
      '${clinicTypeId}', date '2026-08-01', 450, 'cash', date '2026-08-01', null
    )`,
  )
  const exact = rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patientId}', 'package_with_payment', 'Exact receipt', 4, 100,
      '${clinicTypeId}', date '2026-08-01', 400, 'cash', date '2026-08-01', null
    )`,
  )

  assert.equal(partial.success, false)
  assert.equal(overpaid.success, false)
  assert.equal(exact.success, true)
  // Neither rejected attempt may leave a package or a receipt behind.
  assert.equal(query(DB, `select count(*) from packages where patient_id = '${patientId}'`), '1')
  assert.equal(query(DB, `select count(*) from payments where patient_id = '${patientId}'`), '1')
  // No sessions exist yet, so the accepted package holds its whole receipt as package credit
  // and carries no due — the state a partial receipt could never reach.
  assert.equal(
    query(DB, `select due_amount || '/' || refundable_credit from package_billing_balances_v2 where package_id = '${exact.packageId as string}'`),
    '0.00/400.00',
  )
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

test('inserting an earlier charge recomputes reconciled ordinary applications by FIFO', { skip }, () => {
  const patientId = patient('Inserted Earlier Ordinary FIFO')
  const later = appointment(patientId, '2026-08-10', homeTypeId, 'completed', 100)
  recordPayment(patientId, 'ordinary', 100)
  const earlier = appointment(patientId, '2026-08-09', homeTypeId, 'completed', 100)

  assert.equal(query(DB, `select payment_status from appointments where id = '${earlier}'`), 'paid')
  assert.equal(query(DB, `select payment_status from appointments where id = '${later}'`), 'unpaid')
  assert.equal(
    query(DB, `select charge.appointment_reference_id from payment_applications application join appointment_charges charge on charge.id = application.charge_id where application.patient_id = '${patientId}' and application.status = 'active' and application.funding_scope = 'ordinary'`),
    earlier,
  )

  const activeBefore = query(DB, `select jsonb_agg(to_jsonb(application) order by application.id) from payment_applications application where application.patient_id = '${patientId}' and application.status = 'active'`)
  const historyCountBefore = query(DB, `select count(*) from payment_applications where patient_id = '${patientId}'`)
  assert.equal(rpc(adminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, true)
  assert.equal(query(DB, `select jsonb_agg(to_jsonb(application) order by application.id) from payment_applications application where application.patient_id = '${patientId}' and application.status = 'active'`), activeBefore)
  assert.equal(query(DB, `select count(*) from payment_applications where patient_id = '${patientId}'`), historyCountBefore)
})

test('redating a funded charge earlier recomputes reconciled ordinary FIFO', { skip }, () => {
  const patientId = patient('Redated Ordinary FIFO')
  const previouslyEarlier = appointment(patientId, '2026-08-10', homeTypeId, 'completed', 100)
  const redatedEarlier = appointment(patientId, '2026-08-11', homeTypeId, 'completed', 100)
  recordPayment(patientId, 'ordinary', 100)

  query(DB, `update appointments set date = date '2026-08-09' where id = '${redatedEarlier}'`)

  assert.equal(query(DB, `select payment_status from appointments where id = '${redatedEarlier}'`), 'paid')
  assert.equal(query(DB, `select payment_status from appointments where id = '${previouslyEarlier}'`), 'unpaid')
  assert.equal(
    query(DB, `select charge.appointment_reference_id from payment_applications application join appointment_charges charge on charge.id = application.charge_id where application.patient_id = '${patientId}' and application.status = 'active' and application.funding_scope = 'ordinary'`),
    redatedEarlier,
  )

  const activeBefore = query(DB, `select jsonb_agg(to_jsonb(application) order by application.id) from payment_applications application where application.patient_id = '${patientId}' and application.status = 'active'`)
  const historyCountBefore = query(DB, `select count(*) from payment_applications where patient_id = '${patientId}'`)
  assert.equal(rpc(adminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, true)
  assert.equal(query(DB, `select jsonb_agg(to_jsonb(application) order by application.id) from payment_applications application where application.patient_id = '${patientId}' and application.status = 'active'`), activeBefore)
  assert.equal(query(DB, `select count(*) from payment_applications where patient_id = '${patientId}'`), historyCountBefore)
})

test('a partial legacy commitment does not pin its reconciled remainder', { skip }, () => {
  const patientId = patient('Partial Legacy and Reconciled Split')
  const later = appointment(patientId, '2026-08-10', homeTypeId, 'completed', 100)
  const payment = recordPayment(patientId, 'ordinary', 100)
  const paymentId = payment.paymentId as string
  const laterChargeId = query(DB, `select id from appointment_charges where appointment_id = '${later}'`)

  query(
    DB,
    `update payment_applications
     set status = 'reversed', reversed_at = now(), reversal_reason = 'partial legacy split fixture'
     where payment_id = '${paymentId}' and status = 'active'`,
  )
  query(
    DB,
    `insert into payment_applications (
       clinic_id, patient_id, payment_id, charge_id, funding_scope, amount,
       allocation_origin, applied_at
     ) values (
       '${clinicId}', '${patientId}', '${paymentId}', '${laterChargeId}', 'ordinary', 40,
       'legacy_import', timestamptz '2026-08-01 12:00:00+05:30'
     )`,
  )
  assert.equal(rpc(adminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, true)
  assert.equal(
    query(DB, `select string_agg(allocation_origin || ':' || amount, ',' order by allocation_origin) from payment_applications where payment_id = '${paymentId}' and status = 'active'`),
    'legacy_import:40.00,reconciled:60.00',
  )

  const earlier = appointment(patientId, '2026-08-09', homeTypeId, 'completed', 60)
  assert.equal(
    query(DB, `select charge.appointment_reference_id || ':' || application.amount || ':' || application.allocation_origin from payment_applications application join appointment_charges charge on charge.id = application.charge_id where application.payment_id = '${paymentId}' and application.status = 'active' order by charge.appointment_reference_id = '${earlier}' desc`),
    `${earlier}:60.00:reconciled\n${later}:40.00:legacy_import`,
  )
  assert.equal(query(DB, `select payment_status from appointments where id = '${earlier}'`), 'paid')
  assert.equal(query(DB, `select payment_status from appointments where id = '${later}'`), 'partially_paid')

  const historyBefore = query(DB, `select jsonb_agg(to_jsonb(application) order by application.id) from payment_applications application where application.patient_id = '${patientId}'`)
  assert.equal(rpc(adminId, `public.reconcile_patient_billing_v2('${patientId}')`).success, true)
  assert.equal(query(DB, `select jsonb_agg(to_jsonb(application) order by application.id) from payment_applications application where application.patient_id = '${patientId}'`), historyBefore)
})

test('package receipts distribute FIFO only within their package with exact partial amounts', { skip }, () => {
  const patientId = patient('Package FIFO')
  const firstCharge = appointment(patientId, '2026-08-01', clinicTypeId, 'completed', 120)
  const secondCharge = appointment(patientId, '2026-08-02', clinicTypeId, 'completed', 80)
  // Priced 2 x 50 so the creation receipt covers the package in full (packages are prepaid);
  // the two 100 receipts and the charges under test are unchanged.
  const entry = createPackage(patientId, 'Package FIFO', 2, 50, clinicTypeId, '2026-08-01')
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
  assert.equal(
    query(DB, `select string_agg(event_type, ',' order by event_type) from billing_events where patient_id = '${patientId}'`),
    'appointment_fee_adjusted,payment_recorded,payment_recorded,payment_refunded,payment_voided',
  )
})

test('package cancellation is audited, releases reservations, and voids its receipts', { skip }, () => {
  const patientId = patient('Cancelled Package')
  const apptId = appointment(patientId, '2026-08-10')
  const entry = createPackage(patientId, 'Cancelled package', 1, 100, clinicTypeId, '2026-08-01')
  const packageId = entry.packageId as string
  const paymentId = entry.paymentId as string

  assert.equal(rpc(adminId, `public.cancel_package('${packageId}', '')`).success, false)
  assert.equal(query(DB, `select status from payments where id = '${paymentId}'`), 'posted')
  assert.equal(rpc(adminId, `public.cancel_package('${packageId}', 'created in error')`).success, true)
  assert.equal(query(DB, `select status from packages where id = '${packageId}'`), 'cancelled')
  // Voided, not deleted: the receipt row and its audit trail survive the cancellation.
  assert.equal(query(DB, `select status || '/' || void_reason || '/' || (voided_by = '${adminId}') from payments where id = '${paymentId}'`), 'voided/created in error/true')
  assert.equal(query(DB, `select lifecycle from package_session_allocations where appointment_id = '${apptId}' order by created_at desc limit 1`), 'released')
  assert.equal(query(DB, `select count(*) from billing_events where entity_id = '${packageId}' and event_type = 'package_cancelled'`), '1')
  assert.equal(query(DB, `select count(*) from billing_events where entity_id = '${paymentId}' and event_type = 'payment_voided' and reason = 'created in error'`), '1')
  assert.equal(
    query(DB, `select net_received || '/' || refundable_credit from patient_billing_balances_v2 where patient_id = '${patientId}'`),
    '0.00/0.00',
  )
})

test('sessions a cancelled package had used fall back to their own fee', { skip }, () => {
  const patientId = patient('Cancelled Used Package')
  const usedId = appointment(patientId, '2026-08-10', clinicTypeId, 'completed', 100)
  const entry = createPackage(patientId, 'Used package', 2, 100, clinicTypeId, '2026-08-01')
  assert.equal(query(DB, `select payment_status from appointments where id = '${usedId}'`), 'prepaid')

  assert.equal(rpc(adminId, `public.cancel_package('${entry.packageId}', 'package entered by mistake')`).success, true)
  assert.equal(query(DB, `select payment_status from appointments where id = '${usedId}'`), 'unpaid')
  assert.equal(
    query(DB, `select net_received || '/' || due_amount || '/' || refundable_credit from patient_billing_balances_v2 where patient_id = '${patientId}'`),
    '0.00/100.00/0.00',
  )
})

test('a package whose receipt is partly refunded cannot be cancelled until the refund is reversed', { skip }, () => {
  const patientId = patient('Refunded Package')
  const entry = createPackage(patientId, 'Refunded package', 2, 100, clinicTypeId, '2026-08-01')
  const refund = rpc(adminId, `public.record_refund('${entry.paymentId}', 50, 'cash', date '2026-08-02', 'partial refund')`)
  assert.equal(refund.success, true)

  const blocked = rpc(adminId, `public.cancel_package('${entry.packageId}', 'cancel refunded package')`)
  assert.equal(blocked.success, false)
  assert.match(String(blocked.message), /refund/i)
  // All-or-nothing: neither the package nor its receipt changed.
  assert.equal(query(DB, `select status from packages where id = '${entry.packageId}'`), 'active')
  assert.equal(query(DB, `select status from payments where id = '${entry.paymentId}'`), 'posted')
  assert.equal(query(DB, `select count(*) from billing_events where entity_id = '${entry.packageId}' and event_type = 'package_cancelled'`), '0')

  assert.equal(rpc(adminId, `public.void_refund('${refund.refundId}', 'refund entered in error')`).success, true)
  assert.equal(rpc(adminId, `public.cancel_package('${entry.packageId}', 'cancel refunded package')`).success, true)
  assert.equal(query(DB, `select status from payments where id = '${entry.paymentId}'`), 'voided')
})

test('cancelling a package leaves an already-voided receipt and its original reason untouched', { skip }, () => {
  const patientId = patient('Prevoided Package')
  const entry = createPackage(patientId, 'Prevoided package', 1, 100, clinicTypeId, '2026-08-01')
  assert.equal(rpc(adminId, `public.void_payment('${entry.paymentId}', 'Wrong entry')`).success, true)

  assert.equal(rpc(adminId, `public.cancel_package('${entry.packageId}', 'Duplicate package')`).success, true)
  assert.equal(query(DB, `select void_reason from payments where id = '${entry.paymentId}'`), 'Wrong entry')
  assert.equal(query(DB, `select count(*) from billing_events where entity_id = '${entry.paymentId}' and event_type = 'payment_voided'`), '1')
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

test('deleting a fee-adjusted appointment preserves its immutable adjustment history', { skip }, () => {
  const patientId = patient('Adjusted Appointment History')
  const apptId = appointment(patientId, '2026-08-10', clinicTypeId, 'completed', 100)
  const adjustment = rpc(adminId, `public.adjust_appointment_fee('${apptId}', 120, 'correct completed fee')`)
  assert.equal(adjustment.success, true)
  assert.throws(
    () => query(DB, `update appointment_charge_adjustments set appointment_id = null where id = '${adjustment.adjustmentId}'`),
    /immutable/i,
    'a direct update cannot spoof the narrow FK-nulling exception while the appointment exists',
  )

  query(DB, `delete from appointments where id = '${apptId}'`)

  assert.equal(
    query(DB, `select (appointment_id is null)::text || '/' || (appointment_reference_id = '${apptId}')::text || '/' || previous_amount || '/' || adjusted_amount || '/' || reason from appointment_charge_adjustments where id = '${adjustment.adjustmentId}'`),
    'true/true/100.00/120.00/correct completed fee',
  )
  assert.equal(query(DB, `select count(*) from billing_events where entity_id = '${apptId}' and event_type = 'appointment_fee_adjusted'`), '1')
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

test('privileged direct DML cannot rewrite or reactivate append-only allocation history', { skip }, () => {
  const patientId = patient('Privileged Ledger Guard')
  const apptId = appointment(patientId, '2026-08-14', clinicTypeId, 'completed', 100)
  const payment = recordPayment(patientId, 'ordinary', 100)
  const applicationId = query(DB, `select id from payment_applications where payment_id = '${payment.paymentId}' and status = 'active'`)
  const packageEntry = createPackage(patientId, 'Guarded allocation', 1, 100, clinicTypeId, '2026-08-15')
  const scheduledId = appointment(patientId, '2026-08-15', clinicTypeId, 'scheduled', 100)
  const allocationId = query(DB, `select id from package_session_allocations where package_id = '${packageEntry.packageId}' and appointment_id = '${scheduledId}' and lifecycle = 'scheduled'`)

  for (const statement of [
    `update payment_applications set amount = 1 where id = '${applicationId}'`,
    `update payment_applications set charge_id = (select id from appointment_charges where appointment_id = '${scheduledId}') where id = '${applicationId}'`,
    `update payment_applications set applied_at = timestamptz '2000-01-01 00:00:00+00' where id = '${applicationId}'`,
    `update package_session_allocations set package_id = '${packageEntry.packageId}' where id = '${allocationId}'`,
    `update package_session_allocations set appointment_reference_id = '${apptId}' where id = '${allocationId}'`,
    `update package_session_allocations set created_at = timestamptz '2000-01-01 00:00:00+00' where id = '${allocationId}'`,
  ]) {
    assert.throws(() => query(DB, `begin; ${statement}; rollback`), /immutable|transition/i)
  }

  assert.equal(rpc(adminId, `public.void_payment('${payment.paymentId}', 'exercise valid reversal')`).success, true)
  assert.equal(query(DB, `select status from payment_applications where id = '${applicationId}'`), 'reversed')
  assert.throws(
    () => query(DB, `begin; update payment_applications set status = 'active', reversed_at = null, reversal_reason = null where id = '${applicationId}'; rollback`),
    /immutable|transition/i,
  )

  assert.equal(rpc(adminId, `public.cancel_package('${packageEntry.packageId}', 'exercise valid release')`).success, true)
  assert.equal(query(DB, `select lifecycle from package_session_allocations where id = '${allocationId}'`), 'released')
  assert.throws(
    () => query(DB, `begin; update package_session_allocations set lifecycle = 'scheduled', released_at = null, release_reason = null where id = '${allocationId}'; rollback`),
    /immutable|transition/i,
  )
})

test('a mistaken refund can be reversed once without rewriting the receipt', { skip }, () => {
  const patientId = patient('Refund Reversal')
  const apptId = appointment(patientId, '2026-08-16', homeTypeId, 'completed', 100)
  const payment = recordPayment(patientId, 'ordinary', 100)
  const refund = rpc(adminId, `public.record_refund('${payment.paymentId}', 40, 'upi', date '2026-08-15', 'wrong refund')`)
  assert.equal(refund.success, true)
  const originalRefund = query(DB, `select to_jsonb(refund) from refunds refund where id = '${refund.refundId}'`)
  assert.equal(query(DB, `select payment_status from appointments where id = '${apptId}'`), 'partially_paid')

  const reversal = rpc(adminId, `public.void_refund('${refund.refundId}', 'refund entered in error')`)
  assert.equal(reversal.success, true)
  assert.equal(query(DB, `select to_jsonb(refund) from refunds refund where id = '${refund.refundId}'`), originalRefund)
  assert.equal(query(DB, `select payment_status from appointments where id = '${apptId}'`), 'paid')
  assert.equal(
    query(DB, `select net_received || '/' || applied_amount || '/' || due_amount || '/' || refundable_credit from patient_billing_balances_v2 where patient_id = '${patientId}'`),
    '100.00/100.00/0.00/0.00',
  )
  assert.equal(query(DB, `select count(*) from refund_reversals where refund_id = '${refund.refundId}'`), '1')
  assert.equal(query(DB, `select count(*) from billing_events where entity_id = '${refund.refundId}' and event_type = 'refund_reversed'`), '1')
  assert.throws(() => query(DB, `update refund_reversals set reason = 'forged' where refund_id = '${refund.refundId}'`), /immutable/i)
  assert.throws(() => query(DB, `delete from refund_reversals where refund_id = '${refund.refundId}'`), /immutable/i)
  assert.equal(rpc(adminId, `public.void_refund('${refund.refundId}', 'repeat reversal')`).success, false)
  assert.equal(rpc(adminId, `public.void_payment('${payment.paymentId}', 'all refunds are reversed')`).success, true)
})

test('concurrent patient billing operations avoid deadlocks and converge after retry', { skip }, async () => {
  const patientId = patient('Concurrent Billing Lock')
  const apptId = appointment(patientId, '2026-08-17', clinicTypeId, 'completed', 100)
  const packageEntry = createPackage(patientId, 'Concurrent package', 1, 100, clinicTypeId, '2026-08-17')
  recordPayment(patientId, 'ordinary', 120)

  const lockHolder = concurrentSql(
    `begin;
     set local deadlock_timeout = '100ms';
     set local lock_timeout = '2s';
     select private.lock_patient_billing_v2('${patientId}');
     select pg_sleep(0.25);
     set local request.jwt.claim.sub = '${adminId}';
     -- Ordinary scope: this fixture exists to hold private.lock_patient_billing_v2, which is
     -- taken before any funding-scope branching. A 50 package receipt against a 100 package
     -- would now be rejected by the full-total guard (migration 038), for reasons unrelated to
     -- what this test is about.
     select public.record_payment_v2('${patientId}', 'ordinary', null, 50, 'cash', current_date, 'concurrency fixture');
     commit;`,
  )
  await waitForPatientBillingLock(patientId)
  const contenders = await Promise.allSettled([
    concurrentSql(
      `set deadlock_timeout = '100ms'; set lock_timeout = '2s'; set request.jwt.claim.sub = '${adminId}';
       select public.cancel_package('${packageEntry.packageId}', 'concurrent cancellation');`,
    ),
    concurrentSql(
      `set deadlock_timeout = '100ms'; set lock_timeout = '2s'; set request.jwt.claim.sub = '${adminId}';
       select public.adjust_appointment_fee('${apptId}', 120, 'concurrent fee correction');`,
    ),
    concurrentSql(
      `set deadlock_timeout = '100ms'; set lock_timeout = '2s';
       update appointments set date = date '2026-08-16' where id = '${apptId}';`,
    ),
  ])
  const holderResult = await lockHolder
  assert.doesNotMatch(holderResult.stderr, /40P01|deadlock detected/i)
  assert.match(holderResult.stdout, /"success": true/)
  for (const result of contenders) {
    const diagnostic = result.status === 'fulfilled' ? result.value.stderr : String((result.reason as { stderr?: string }).stderr ?? result.reason)
    assert.doesNotMatch(diagnostic, /40P01|deadlock detected/i)
  }
  const directUpdate = contenders[2]
  assert.equal(directUpdate.status, 'rejected')
  assert.match(String((directUpdate as PromiseRejectedResult).reason.stderr), /Concurrent billing update|40001/i)
  for (const rpcResult of contenders.slice(0, 2)) {
    assert.equal(rpcResult.status, 'fulfilled')
    assert.match((rpcResult as PromiseFulfilledResult<{ stdout: string }>).value.stdout, /"success": true/)
  }

  query(DB, `update appointments set date = date '2026-08-16' where id = '${apptId}'`)
  assert.equal(query(DB, `select status from packages where id = '${packageEntry.packageId}'`), 'cancelled')
  assert.equal(query(DB, `select fee || '/' || payment_status || '/' || date from appointments where id = '${apptId}'`), '120.00/paid/2026-08-16')
  assert.equal(query(DB, `select count(*) from package_session_allocations where package_id = '${packageEntry.packageId}' and lifecycle <> 'released'`), '0')
  assert.equal(query(DB, `select coalesce(sum(amount), 0) from payment_applications where patient_id = '${patientId}' and funding_scope = 'ordinary' and status = 'active'`), '120.00')
})

test('concurrent appointment deletion fails before child-ledger locks instead of deadlocking', { skip }, async () => {
  const patientId = patient('Concurrent Appointment Delete')
  const apptId = appointment(patientId, '2026-08-18', clinicTypeId, 'scheduled', 100)
  createPackage(patientId, 'Delete lock package', 1, 100, clinicTypeId, '2026-08-18')
  const chargeId = query(DB, `select id from appointment_charges where appointment_id = '${apptId}'`)

  const lockHolder = concurrentSql(
    `begin;
     set local deadlock_timeout = '100ms';
     set local lock_timeout = '2s';
     select private.lock_patient_billing_v2('${patientId}');
     select id from appointment_charges where id = '${chargeId}' for update;
     select pg_sleep(0.25);
     update appointments set time = '10:00' where id = '${apptId}';
     commit;`,
  )
  await waitForPatientBillingLock(patientId)
  const deletion = await Promise.allSettled([
    concurrentSql(
      `set deadlock_timeout = '100ms'; set lock_timeout = '2s';
       delete from appointments where id = '${apptId}';`,
    ),
  ])
  const holderResult = await lockHolder
  assert.doesNotMatch(holderResult.stderr, /40P01|deadlock detected/i)
  assert.equal(deletion[0].status, 'rejected')
  const diagnostic = String((deletion[0] as PromiseRejectedResult).reason.stderr)
  assert.doesNotMatch(diagnostic, /40P01|deadlock detected/i)
  assert.match(diagnostic, /Concurrent billing update|40001/i)

  query(DB, `delete from appointments where id = '${apptId}'`)
  assert.equal(query(DB, `select status || '/' || (appointment_id is null)::text from appointment_charges where id = '${chargeId}'`), 'voided/true')
})

test('soft-deleting an auth actor preserves immutable package, payment, and event history', { skip }, () => {
  const actorId = seedUser(DB, 'admin', clinicId, 'billing-actor@carebook.test')
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

  query(
    DB,
    `set request.jwt.claim.role = 'service_role';
     update profiles
     set status = 'deleted', deleted_at = now(), deleted_by = '${adminId}', deletion_reason = 'actor fixture'
     where id = '${actorId}';
     reset request.jwt.claim.role`,
  )

  assert.equal(query(DB, `select count(*) from auth.users where id = '${actorId}'`), '1')
  assert.equal(query(DB, `select status from profiles where id = '${actorId}'`), 'deleted')
  assert.equal(query(DB, `select cancelled_by from packages where id = '${packageResult.packageId}'`), actorId)
  assert.equal(query(DB, `select voided_by from payments where id = '${ordinaryPayment.paymentId}'`), actorId)
  assert.equal(query(DB, `select created_by from packages where id = '${packageResult.packageId}'`), actorId)
  assert.equal(query(DB, `select created_by from payments where id in ('${packageResult.paymentId}','${ordinaryPayment.paymentId}') group by created_by`), actorId)
  assert.equal(query(DB, `select voided_by from payments where id = '${packageResult.paymentId}'`), actorId)
  // package_created + 2 × payment_recorded + package_cancelled + the package receipt's
  // payment_voided (cancelling voids it) + the ordinary payment_voided.
  assert.equal(query(DB, `select count(*) from billing_events where patient_id = '${patientId}' and actor_id = '${actorId}'`), '6')
  assert.throws(
    () => query(
      DB,
      `set role supabase_auth_admin;
       update auth.users
       set raw_app_meta_data = jsonb_build_object(
         'carebook_e2e_cleanup', jsonb_build_object('state', 'requested', 'reason', 'attempted actor cleanup')
       )
       where id = '${actorId}';
       delete from auth.users where id = '${actorId}';
       reset role`,
    ),
    /audit history|cannot be hard-deleted/i,
  )
  assert.equal(query(DB, `select cancelled_by from packages where id = '${packageResult.packageId}'`), actorId)
  assert.equal(query(DB, `select voided_by from payments where id = '${ordinaryPayment.paymentId}'`), actorId)
  assert.equal(query(DB, `select count(*) from billing_events where patient_id = '${patientId}' and actor_id = '${actorId}'`), '6')
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
    refund_reversals: '0',
    payment_applications: '1',
    package_session_allocations: '0',
    billing_events: '1',
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
    'void_refund(uuid,text)',
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
  const isolationRefund = rpc(adminId, `public.record_refund('${paymentId}', 1, 'cash', current_date, 'RPC isolation fixture')`)
  assert.equal(isolationRefund.success, true)
  for (const [userId, expressions] of [
    [staffId, [
      `public.record_billing_entry_v2('${patientId}', 'package_with_payment', 'blocked', 1, 100, '${clinicTypeId}', date '2026-08-01', 100, 'cash', current_date, null)`,
      `public.record_payment_v2('${patientId}', 'ordinary', null, 10, 'cash', current_date, null)`,
      `public.record_refund('${paymentId}', 1, 'blocked')`,
      `public.record_refund('${paymentId}', 1, 'cash', current_date, 'blocked')`,
      `public.void_refund('${isolationRefund.refundId}', 'blocked')`,
      `public.void_payment('${paymentId}', 'blocked')`,
      `public.cancel_package('${packageId}', 'blocked')`,
      `public.adjust_appointment_fee('${apptId}', 110, 'blocked')`,
    ]],
    [otherAdminId, [
      `public.record_billing_entry_v2('${patientId}', 'package_with_payment', 'cross clinic', 1, 100, '${clinicTypeId}', date '2026-08-01', 100, 'cash', current_date, null)`,
      `public.record_payment_v2('${patientId}', 'ordinary', null, 10, 'cash', current_date, null)`,
      `public.record_refund('${paymentId}', 1, 'cross clinic')`,
      `public.record_refund('${paymentId}', 1, 'cash', current_date, 'cross clinic')`,
      `public.void_refund('${isolationRefund.refundId}', 'cross clinic')`,
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
