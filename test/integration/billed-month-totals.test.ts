// Integration guard for get_billed_month_totals_v1 (migration 043) — the server-side aggregation
// behind the monthly billed trend. Exercises the real function against Postgres and feeds its rows
// through the same pure builder the page uses.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, run, seedUser } from './db.ts'
import { buildMonthlyBilledSeries, type BilledMonthBucket } from '../../src/lib/billing/monthly-billed-series.ts'

const DB = 'carebook_it_billed_month_totals'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let patientId = ''
let adminId = ''
let staffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Totals Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
  patientId = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Asha Rao', '1') returning id`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function typeId(name: string): string {
  return query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = '${name}'`)
}

function book(date: string, fee: number, typeName = 'Clinic', status = 'completed') {
  run(
    DB,
    `insert into appointments (patient_id, date, time, appointment_type_id, status, fee)
     values ('${patientId}', date '${date}', '09:00', '${typeId(typeName)}', '${status}', ${fee})`,
  )
}

function totals(userId: string, tillDay: number | null = null): BilledMonthBucket[] {
  const arg = tillDay === null ? 'null' : String(tillDay)
  const json = queryAs(
    userId === adminId ? DB : DB,
    userId,
    `select coalesce(json_agg(json_build_object(
       'month', month, 'type', appointment_type, 'amount', amount, 'sessionCount', session_count
     ) order by month, appointment_type), '[]')
     from public.get_billed_month_totals_v1(${arg})`,
  )
  return JSON.parse(json) as BilledMonthBucket[]
}

test('aggregates completed sessions per month and appointment type', { skip }, () => {
  book('2026-03-10', 800, 'Clinic')
  book('2026-03-20', 1000, 'Home')
  book('2026-03-21', 600, 'Home')
  // Skip April entirely — the builder must still emit it at 0.
  book('2026-05-05', 500, 'Clinic')
  // A scheduled session must not contribute to billed totals.
  book('2026-05-06', 900, 'Clinic', 'scheduled')

  const series = buildMonthlyBilledSeries(totals(adminId), '2026-05')

  assert.deepEqual(
    series.map((point) => ({ month: point.month, amount: point.amount })),
    [
      { month: '2026-03', amount: 2400 },
      { month: '2026-04', amount: 0 },
      { month: '2026-05', amount: 500 },
    ],
  )
  assert.deepEqual(series[0].breakdown, [
    { type: 'Home', amount: 1600, count: 2 },
    { type: 'Clinic', amount: 800, count: 1 },
  ])
})

test('p_till_day counts only the first N days of every month', { skip }, () => {
  const buckets = totals(adminId, 19)
  const march = buckets.filter((bucket) => bucket.month === '2026-03')

  // 10 Mar (₹800 Clinic) is inside the window; 20 and 21 Mar (₹1600 Home) are not.
  assert.deepEqual(march, [{ month: '2026-03', type: 'Clinic', amount: 800, sessionCount: 1 }])
})

test('p_till_day keeps a session falling exactly on the cutoff day', { skip }, () => {
  book('2026-06-19', 450, 'Clinic')

  const june = totals(adminId, 19).filter((bucket) => bucket.month === '2026-06')

  assert.equal(june.length, 1)
  assert.equal(Number(june[0].amount), 450)
})

test('returns nothing to a non-admin', { skip }, () => {
  assert.deepEqual(totals(staffId), [])
})
