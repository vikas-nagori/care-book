import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { buildDatabase, dropDatabase, postgresAvailable, query, run, seedUser } from './db.ts'

const DB = 'care_book_historical_corrections_test'
const available = postgresAvailable()
const script = join(import.meta.dirname, '..', '..', 'ops', 'billing', 'apply-approved-historical-corrections.sql')
const prepareScript = join(import.meta.dirname, '..', '..', 'ops', 'billing', 'prepare-write-pause.sql')
const resumeScript = join(import.meta.dirname, '..', '..', 'ops', 'billing', 'resume-billing-writes.sql')
const TOKEN = 'historical-correction-test-token-32-bytes'
const SOURCE = '8cb41a69c363db81ef421f7676a6dc1fc678d436674d25844145abfce9417145'
const PLAN = 'ebed6813ce50f371c851c50e265ba0832b2b4daf33ded38d6cd39469ad62a2b8'
const REPORT = 'e3f381edd342de136387315c671c9d0df950c13e52cd912f2051da293e0591b9'
let actorId = ''
let liveDbFingerprint = ''

function appointmentValues(patientId: string, typeId: string, rows: Array<[string, string, string, number]>) {
  return rows.map(([id, date, status, fee], index) =>
    `('${id}','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','${patientId}','${date}','${String(8 + index).padStart(2, '0')}:00','${typeId}','${status}',${fee})`).join(',')
}

function psqlFile(file: string, variables: Record<string, string>): void {
  const args = ['-d', DB, '-X', '-q', '-v', 'ON_ERROR_STOP=1']
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`)
  args.push('-f', file)
  execFileSync('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function apply(fingerprint: string): void {
  psqlFile(script, {
    source_fingerprint: fingerprint, plan_fingerprint: PLAN, report_checksum: REPORT,
    live_db_fingerprint: liveDbFingerprint, bypass_token: TOKEN, actor_id: actorId,
  })
}

function sourceRowCounts(): string {
  return query(DB, `select jsonb_build_object(
    'clinics',(select count(*) from clinics),'patients',(select count(*) from patients),
    'appointment_types',(select count(*) from appointment_types),'global_settings',(select count(*) from global_settings),
    'package_templates',(select count(*) from package_templates),'appointments',(select count(*) from appointments),
    'packages',(select count(*) from packages),'payments',(select count(*) from payments),
    'appointment_payments',(select count(*) from appointment_payments),
    'package_session_allocations',(select count(*) from package_session_allocations))`)
}

before(() => {
  if (!available) return
  buildDatabase(DB)
  run(DB, `
    insert into public.clinics (id,name) values ('d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Amruta');
    delete from public.appointment_types where clinic_id = 'd36983a1-e62d-41bd-8c3a-dfbdb4ce7968';
    insert into public.appointment_types (id,clinic_id,name,session_rate,is_shared,is_default,sort_order) values
      ('2c08cb1e-13c2-4b86-be34-08a03cc6c399','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Clinic',650,true,true,0),
      ('cd57ef69-f287-4f1e-9056-04e9dcbe96c2','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Spinal Bed',500,false,false,2);
    insert into public.patients (id,clinic_id,name,phone) values
      ('72881d5a-88d9-4937-93b2-5ae53cf8a471','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Smita aquamarine','1'),
      ('24c77231-9973-4b21-b338-b1dfc092a2e3','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Pranav','2'),
      ('fa67d1ba-3f91-4f28-befa-00e8df3fbdad','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Vikash mayflower','3'),
      ('e7714eb4-df6c-4421-a2d6-575837fe3cae','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Sandeep Kumar Goyal','4'),
      ('dfc43b86-d56f-4ff4-a9d4-68ffd3b288d4','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Nayana pai','5'),
      ('9756bf2a-0c32-4dc1-826e-d9fdb50183d4','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','Tresa','6');
    insert into public.packages
      (id,clinic_id,patient_id,name,total_sessions,used_sessions,total_amount,per_session_amount,paid_amount,status,appointment_type_id,starts_on,billing_version,created_at)
    values
      ('cb877a26-47f4-4ae7-8e15-416269db240f','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','72881d5a-88d9-4937-93b2-5ae53cf8a471','10 session',10,0,6000,600,0,'active','2c08cb1e-13c2-4b86-be34-08a03cc6c399','2026-07-15',2,'2026-07-15 08:26:00.671693+00'),
      ('dd3bf8eb-741f-40d9-a25d-bdea979871b4','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','24c77231-9973-4b21-b338-b1dfc092a2e3','5',5,0,3250,650,0,'active','2c08cb1e-13c2-4b86-be34-08a03cc6c399','2026-07-29',2,'2026-07-29 13:06:30.172184+00'),
      ('28ecd64e-875d-42fa-b5df-c59191c58a7b','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','24c77231-9973-4b21-b338-b1dfc092a2e3','5 session package',5,0,3250,650,0,'active','2c08cb1e-13c2-4b86-be34-08a03cc6c399','2026-08-11',2,'2026-08-11 04:12:24.323841+00'),
      ('44e48b86-bb08-49a2-89e0-060051f9b47a','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','fa67d1ba-3f91-4f28-befa-00e8df3fbdad','5 session package',5,0,3250,650,0,'active','2c08cb1e-13c2-4b86-be34-08a03cc6c399','2026-08-07',2,'2026-08-07'),
      ('cacb4aea-4059-4671-806a-1e382dc3fa75','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','e7714eb4-df6c-4421-a2d6-575837fe3cae','7',7,0,4550,650,0,'active','2c08cb1e-13c2-4b86-be34-08a03cc6c399','2026-08-11',2,'2026-08-11'),
      ('705d245d-e107-4f13-b511-445f424208c0','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','dfc43b86-d56f-4ff4-a9d4-68ffd3b288d4','7',5,0,3250,650,0,'active','2c08cb1e-13c2-4b86-be34-08a03cc6c399','2026-08-12',2,'2026-08-12'),
      ('5e169151-db06-46c9-9736-dd0221afd749','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','9756bf2a-0c32-4dc1-826e-d9fdb50183d4','7 days',7,0,4550,650,0,'active','2c08cb1e-13c2-4b86-be34-08a03cc6c399','2026-07-14',2,'2026-07-14');
  `)
  run(DB, `insert into public.appointments (id,clinic_id,patient_id,date,time,appointment_type_id,status,fee) values
    ${appointmentValues('72881d5a-88d9-4937-93b2-5ae53cf8a471','2c08cb1e-13c2-4b86-be34-08a03cc6c399', Array.from({ length: 9 }, (_, i) => [`10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, `2026-07-${String(15 + i).padStart(2, '0')}`, 'completed', 600]))},
    ('c1d8f6e6-d25d-4016-b496-77e187351b8f','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','72881d5a-88d9-4937-93b2-5ae53cf8a471','2026-07-22','09:00','cd57ef69-f287-4f1e-9056-04e9dcbe96c2','completed',500),
    ${appointmentValues('24c77231-9973-4b21-b338-b1dfc092a2e3','2c08cb1e-13c2-4b86-be34-08a03cc6c399', [
      ['20000000-0000-4000-8000-000000000001','2026-07-28','completed',700], ['20000000-0000-4000-8000-000000000002','2026-07-29','completed',650],
      ['20000000-0000-4000-8000-000000000003','2026-07-31','completed',650], ['20000000-0000-4000-8000-000000000004','2026-08-01','completed',650],
      ['20000000-0000-4000-8000-000000000005','2026-08-05','completed',650], ['20000000-0000-4000-8000-000000000006','2026-08-08','completed',650],
      ['20000000-0000-4000-8000-000000000007','2026-08-10','completed',650], ['20000000-0000-4000-8000-000000000008','2026-08-11','completed',650],
      ['20000000-0000-4000-8000-000000000009','2026-08-12','completed',650], ['20000000-0000-4000-8000-000000000010','2026-08-13','completed',650],
    ])},
    ${appointmentValues('fa67d1ba-3f91-4f28-befa-00e8df3fbdad','2c08cb1e-13c2-4b86-be34-08a03cc6c399', [
      ['30000000-0000-4000-8000-000000000001','2026-08-07','completed',650], ['30000000-0000-4000-8000-000000000002','2026-08-08','completed',650],
      ['30000000-0000-4000-8000-000000000003','2026-08-09','completed',650], ['30000000-0000-4000-8000-000000000004','2026-08-10','completed',650],
      ['30000000-0000-4000-8000-000000000005','2026-08-16','scheduled',650]])},
    ${appointmentValues('e7714eb4-df6c-4421-a2d6-575837fe3cae','2c08cb1e-13c2-4b86-be34-08a03cc6c399', [
      ['40000000-0000-4000-8000-000000000001','2026-08-11','completed',650], ['40000000-0000-4000-8000-000000000002','2026-08-12','completed',650],
      ['40000000-0000-4000-8000-000000000003','2026-08-13','completed',650], ['40000000-0000-4000-8000-000000000004','2026-08-16','scheduled',650],
      ['40000000-0000-4000-8000-000000000005','2026-08-17','scheduled',650]])},
    ${appointmentValues('dfc43b86-d56f-4ff4-a9d4-68ffd3b288d4','2c08cb1e-13c2-4b86-be34-08a03cc6c399', [
      ['50000000-0000-4000-8000-000000000001','2026-08-12','completed',650], ['50000000-0000-4000-8000-000000000002','2026-08-13','completed',650],
      ['50000000-0000-4000-8000-000000000003','2026-08-16','scheduled',650]])},
    ('89650eb0-d673-4d50-b481-403e704ad847','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','dfc43b86-d56f-4ff4-a9d4-68ffd3b288d4','2026-08-15','11:00','cd57ef69-f287-4f1e-9056-04e9dcbe96c2','scheduled',500),
    ${appointmentValues('9756bf2a-0c32-4dc1-826e-d9fdb50183d4','2c08cb1e-13c2-4b86-be34-08a03cc6c399', Array.from({ length: 7 }, (_, i) => [`60000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, `2026-07-${String(14 + i).padStart(2, '0')}`, 'completed', 650]))};`)
  run(DB, `insert into public.payments (id,clinic_id,patient_id,package_id,amount,payment_method,date,notes,created_at,funding_scope,status,billing_version) values
    ('b53563c9-b4b4-4a02-b5f4-5937b4cf1225','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','72881d5a-88d9-4937-93b2-5ae53cf8a471','cb877a26-47f4-4ae7-8e15-416269db240f',6000,'upi','2026-07-15','Self','2026-07-15 08:26:00.671693+00','package','posted',2);`)
  for (const [id, patient, pkg, amount, date] of [
    ['9976d6c1-1131-4eab-bab8-e06538113994','24c77231-9973-4b21-b338-b1dfc092a2e3','dd3bf8eb-741f-40d9-a25d-bdea979871b4',3250,'2026-07-29'],
    ['d6391221-fd2a-406e-8c0c-6f8d87c3d0ef','24c77231-9973-4b21-b338-b1dfc092a2e3','28ecd64e-875d-42fa-b5df-c59191c58a7b',3250,'2026-08-11'],
    ['70000000-0000-4000-8000-000000000001','fa67d1ba-3f91-4f28-befa-00e8df3fbdad','44e48b86-bb08-49a2-89e0-060051f9b47a',3250,'2026-08-07'],
    ['70000000-0000-4000-8000-000000000002','e7714eb4-df6c-4421-a2d6-575837fe3cae','cacb4aea-4059-4671-806a-1e382dc3fa75',4550,'2026-08-11'],
    ['70000000-0000-4000-8000-000000000003','dfc43b86-d56f-4ff4-a9d4-68ffd3b288d4','705d245d-e107-4f13-b511-445f424208c0',3250,'2026-08-12'],
    ['70000000-0000-4000-8000-000000000004','9756bf2a-0c32-4dc1-826e-d9fdb50183d4','5e169151-db06-46c9-9736-dd0221afd749',4550,'2026-07-14'],
  ] as const) run(DB, `insert into public.payments (id,clinic_id,patient_id,package_id,amount,payment_method,date,funding_scope,status,billing_version) values ('${id}','d36983a1-e62d-41bd-8c3a-dfbdb4ce7968','${patient}','${pkg}',${amount},'upi','${date}','package','posted',2)`)
  actorId = seedUser(DB, 'admin', 'd36983a1-e62d-41bd-8c3a-dfbdb4ce7968')
  assert.throws(() => psqlFile(prepareScript, {
    expected_live_db_fingerprint: '0'.repeat(64), source_fingerprint: SOURCE,
    source_row_counts: sourceRowCounts(), plan_fingerprint: PLAN, report_checksum: REPORT, bypass_token: TOKEN,
  }), /fingerprint\/count mismatch/i)
  liveDbFingerprint = query(DB, `select observed_live_db_fingerprint from private.billing_ops_gate where id=true`)
  psqlFile(prepareScript, {
    expected_live_db_fingerprint: liveDbFingerprint, source_fingerprint: SOURCE,
    source_row_counts: sourceRowCounts(), plan_fingerprint: PLAN, report_checksum: REPORT, bypass_token: TOKEN,
  })
})

after(() => { if (available) dropDatabase(DB) })

test('aborts atomically on fingerprint mismatch, applies once, and verifies every approved fixture', { skip: !available }, () => {
  run(DB, `delete from private.billing_ops_gate where id=true`)
  assert.throws(() => apply(SOURCE), /write-pause gate is missing/i)
  psqlFile(prepareScript, {
    expected_live_db_fingerprint: liveDbFingerprint, source_fingerprint: SOURCE,
    source_row_counts: sourceRowCounts(), plan_fingerprint: PLAN, report_checksum: REPORT, bypass_token: TOKEN,
  })
  run(DB, `update private.billing_ops_gate set paused_at=now()-interval '25 hours' where id=true`)
  assert.throws(() => apply(SOURCE), /stale or not verified/i)
  run(DB, `update private.billing_ops_gate set paused_at=now() where id=true`)

  assert.throws(() => apply('wrong-fingerprint'), /fingerprint mismatch/)
  assert.equal(query(DB, `select status from public.payments where id='b53563c9-b4b4-4a02-b5f4-5937b4cf1225'`), 'posted')
  assert.equal(query(DB, `select count(*) from public.payments where id='4bb5d6ca-08b4-4d8a-92aa-47cf7a265401'`), '0')

  apply(SOURCE)
  assert.equal(query(DB, `select status from public.payments where id='b53563c9-b4b4-4a02-b5f4-5937b4cf1225'`), 'voided')
  assert.equal(query(DB, `select count(*) from public.payments where id in ('4bb5d6ca-08b4-4d8a-92aa-47cf7a265401','6dc37185-3aa2-4590-9e18-acde15600600')`), '2')
  assert.equal(query(DB, `select count(*) from public.refunds where id='79b344fb-d5e2-4ea1-b6c2-202607300100'`), '1')
  assert.equal(query(DB, `select count(*) from public.billing_events where event_type='package_corrected_historical' and details->>'previousTotalSessions'='10' and details->>'totalSessions'='9'`), '1')
  assert.equal(query(DB, `select payment_status from public.appointments where id='c1d8f6e6-d25d-4016-b496-77e187351b8f'`), 'paid')
  assert.equal(query(DB, `select status || ':' || used_sessions from public.packages where id='28ecd64e-875d-42fa-b5df-c59191c58a7b'`), 'completed:5')

  apply(SOURCE)
  assert.equal(query(DB, `select count(*) from public.billing_events where event_type='approved_historical_corrections_20260815'`), '1')
  assert.equal(query(DB, `select count(*) from public.payments where id in ('4bb5d6ca-08b4-4d8a-92aa-47cf7a265401','6dc37185-3aa2-4590-9e18-acde15600600')`), '2')
  assert.equal(query(DB, `select status from private.billing_ops_gate where id=true`), 'corrections_applied')
  psqlFile(resumeScript, { bypass_token: TOKEN })
  assert.equal(query(DB, `select status from private.billing_ops_gate where id=true`), 'resumed')
  assert.equal(query(DB, `select current_setting('carebook.ops.bypass_token', true)`), '')
})
