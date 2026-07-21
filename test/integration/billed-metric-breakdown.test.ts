// Integration guard for the "Total billed" drill-down breakdown. The metric page selects completed
// sessions in a month window (each with its denormalized `type` + `fee`) and groups them per type.
// This exercises that exact data path against real Postgres — the completed-only + month-window
// filter, the appointment_type_id -> type denormalization trigger, and the pure breakdown grouping —
// so a schema/trigger change that breaks the strip's inputs is caught here, not just in the JS unit test.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, run, seedUser } from './db.ts'
import { buildAppointmentTypeBreakdown, type BilledSession } from '../../src/lib/billing/appointment-type-breakdown.ts'

const DB = 'carebook_it_billed_breakdown'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let patientId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Breakdown Clinic') returning id`)
  seedUser(DB, 'admin', clinicId)
  patientId = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Asha Rao', '1') returning id`,
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function typeId(name: string): string {
  return query(DB, `select id from appointment_types where clinic_id = '${clinicId}' and name = '${name}'`)
}

function book(type: string, opts: { fee: number; status: string; date: string; time: string }) {
  run(
    DB,
    `insert into appointments (patient_id, date, time, appointment_type_id, status, fee)
     values ('${patientId}', ${opts.date}, '${opts.time}', '${typeId(type)}', '${opts.status}', ${opts.fee})`,
  )
}

/** Mirror of the metric page query: completed sessions in the current calendar month, as {type, fee}. */
function billedSessionsThisMonth(): BilledSession[] {
  const json = query(
    DB,
    `select coalesce(json_agg(json_build_object('type', type, 'fee', fee)), '[]')
     from appointments
     where status = 'completed'
       and date >= date_trunc('month', current_date)::date
       and date <= (date_trunc('month', current_date) + interval '1 month - 1 day')::date`,
  )
  return JSON.parse(json) as BilledSession[]
}

test('the denormalization trigger populates `type` from appointment_type_id', { skip }, () => {
  book('Clinic', { fee: 800, status: 'completed', date: 'current_date', time: '09:00' })
  const rows = billedSessionsThisMonth()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].type, 'Clinic')
  assert.equal(Number(rows[0].fee), 800)
})

test('breakdown groups completed in-month sessions by type', { skip }, () => {
  // On top of the Clinic/800 above: another Clinic and two Home sessions this month.
  book('Clinic', { fee: 800, status: 'completed', date: 'current_date', time: '10:00' })
  book('Home', { fee: 1000, status: 'completed', date: 'current_date', time: '11:00' })
  book('Home', { fee: 1000, status: 'completed', date: 'current_date', time: '12:00' })

  const breakdown = buildAppointmentTypeBreakdown(billedSessionsThisMonth())

  // Sorted by amount descending: Home (2000) before Clinic (1600).
  assert.deepEqual(breakdown, [
    { type: 'Home', amount: 2000, count: 2 },
    { type: 'Clinic', amount: 1600, count: 2 },
  ])
})

test('breakdown excludes non-completed and out-of-month sessions', { skip }, () => {
  // A scheduled session (not billed yet) and a completed session from two months ago.
  book('Clinic', { fee: 800, status: 'scheduled', date: 'current_date', time: '13:00' })
  book('Home', {
    fee: 1000,
    status: 'completed',
    date: `(date_trunc('month', current_date) - interval '2 months')::date`,
    time: '09:00',
  })

  const breakdown = buildAppointmentTypeBreakdown(billedSessionsThisMonth())

  // Same as before — the excluded rows must not shift the totals.
  // Sorted by amount descending: Home (2000) before Clinic (1600).
  assert.deepEqual(breakdown, [
    { type: 'Home', amount: 2000, count: 2 },
    { type: 'Clinic', amount: 1600, count: 2 },
  ])
})
