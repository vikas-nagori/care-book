import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDatabase,
  dropDatabase,
  postgresAvailable,
  query,
  queryAsAuthenticated,
  run,
  seedUser,
} from './db.ts'

const DB = 'carebook_it_mcp_patient_fuzzy_search'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let otherClinicId = ''
let adminId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Fuzzy Clinic') returning id`)
  otherClinicId = query(DB, `insert into clinics (name) values ('Other Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)

  run(
    DB,
    `insert into patients (clinic_id, name, phone) values
       ('${clinicId}', 'Aadi', '9990000001'),
       ('${clinicId}', 'Aadi dadi', '9990000002'),
       ('${clinicId}', 'Prajakta Kulkarni', '9990000003'),
       ('${otherClinicId}', 'Aadi Elsewhere', '9990000004');`
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function search(term: string): Array<{ name: string; score: number }> {
  const raw = queryAsAuthenticated(
    DB,
    adminId,
    `select coalesce(string_agg(name || '=' || round(match_score::numeric, 3), '|' order by match_score desc, name), '')
     from public.search_patients_fuzzy('${term}', 20)`
  )
  if (!raw) return []
  return raw.split('|').map((entry) => {
    const [name, score] = entry.split('=')
    return { name, score: Number(score) }
  })
}

test('an exact name returns every other patient that also matches', { skip }, () => {
  const names = search('Aadi').map((row) => row.name)

  // The Aadi regression: both records must come back so the tool layer can insist on a choice.
  assert.ok(names.includes('Aadi'), `expected "Aadi" in ${JSON.stringify(names)}`)
  assert.ok(names.includes('Aadi dadi'), `expected "Aadi dadi" in ${JSON.stringify(names)}`)
})

test('the exact match outranks the merely similar one', { skip }, () => {
  const rows = search('Aadi')
  assert.equal(rows[0]?.name, 'Aadi')
  assert.ok(rows[0].score > rows[1].score, `expected the exact match to outrank ${JSON.stringify(rows)}`)
})

test('a shortened name still finds the patient', { skip }, () => {
  // A bare ilike '%Adi%' cannot match "Aadi" at all; trigram similarity can.
  const names = search('Adi').map((row) => row.name)
  assert.ok(names.includes('Aadi'), `expected "Aadi" for a shortened search, got ${JSON.stringify(names)}`)
})

test('a typo still finds the patient', { skip }, () => {
  const names = search('Prajkta').map((row) => row.name)
  assert.ok(names.includes('Prajakta Kulkarni'), `expected a typo to match, got ${JSON.stringify(names)}`)
})

test('an unrelated term matches nothing', { skip }, () => {
  assert.deepEqual(search('Zzzzzzz'), [])
})

test('search stays inside the caller clinic', { skip }, () => {
  // SECURITY INVOKER means the caller's RLS still decides visibility; ranking must not leak tenants.
  const names = search('Aadi').map((row) => row.name)
  assert.ok(!names.includes('Aadi Elsewhere'), `another clinic's patient leaked: ${JSON.stringify(names)}`)
})
