// Integration guard for the "Billed last month" trendline. The trend page selects every completed
// session's date + fee for the clinic and groups them into a month-by-month series. This exercises
// that real query path against Postgres and feeds it through the same pure builder the page uses.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, run, seedUser } from './db.ts'
import { buildMonthlyBilledSeries, type BilledSessionDate } from '../../src/lib/billing/monthly-billed-series.ts'

const DB = 'carebook_it_billed_trend'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let patientId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Trend Clinic') returning id`)
  seedUser(DB, 'admin', clinicId)
  patientId = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Asha Rao', '1') returning id`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function typeId(name: string): string {
  return query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = '${name}'`)
}

function book(dateSql: string, fee: number, status = 'completed') {
  run(
    DB,
    `insert into appointments (patient_id, date, time, appointment_type_id, status, fee)
     values ('${patientId}', ${dateSql}, '09:00', '${typeId('Clinic')}', '${status}', ${fee})`,
  )
}

/** Mirror of the trend page query: every completed session's date + fee, ascending. */
function completedSessions(): BilledSessionDate[] {
  const json = query(
    DB,
    `select coalesce(json_agg(json_build_object('date', to_char(date, 'YYYY-MM-DD'), 'fee', fee) order by date), '[]')
     from appointments where status = 'completed'`,
  )
  return JSON.parse(json) as BilledSessionDate[]
}

test('builds a gap-free monthly billed series from completed sessions', { skip }, () => {
  book(`date '2026-03-10'`, 800)
  book(`date '2026-03-20'`, 1000)
  // Skip April (no sessions) — the series must still include it at 0.
  book(`date '2026-05-05'`, 500)
  // A scheduled session must not contribute to billed totals.
  book(`date '2026-05-06'`, 900, 'scheduled')

  const series = buildMonthlyBilledSeries(completedSessions(), '2026-05')

  assert.deepEqual(
    series.map((point) => ({ month: point.month, amount: point.amount })),
    [
      { month: '2026-03', amount: 1800 },
      { month: '2026-04', amount: 0 },
      { month: '2026-05', amount: 500 },
    ],
  )
})
