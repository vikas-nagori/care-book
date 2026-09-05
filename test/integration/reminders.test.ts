import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAsAuthenticated, seedUser } from './db.ts'

const DB = 'carebook_it_reminders'
const available = postgresAvailable()
const skip = available ? false : 'no local Postgres reachable'
let clinic = '', otherClinic = '', admin = '', staff = '', outsider = '', blocked = '', patient = '', foreignPatient = ''
before(() => {
  if (!available) return
  buildDatabase(DB)
  clinic = query(DB, "insert into clinics(name) values ('Reminders') returning id")
  otherClinic = query(DB, "insert into clinics(name) values ('Other reminders') returning id")
  admin = seedUser(DB, 'admin', clinic)
  staff = seedUser(DB, 'staff', clinic)
  outsider = seedUser(DB, 'admin', otherClinic)
  blocked = seedUser(DB, 'staff', clinic)
  query(DB, `update profiles set status = 'blocked' where id = '${blocked}'`)
  patient = query(DB, `insert into patients(clinic_id,name,phone) values ('${clinic}','Patient','1') returning id`)
  foreignPatient = query(DB, `insert into patients(clinic_id,name,phone) values ('${otherClinic}','Other','2') returning id`)
})
after(() => { if (available) dropDatabase(DB) })
function as(user: string, sql: string) { return queryAsAuthenticated(DB, user, sql) }
function create(user = staff, extra = '') {
  return as(user, `insert into reminders(clinic_id,created_by,title,date${extra ? ',patient_id' : ''}) values ('${clinic}','${user}','Call','2026-09-05'${extra ? `,'${extra}'` : ''}) returning id`)
}
test('staff and admin share clinic CRUD without a patient', {skip}, () => {
  const id = create()
  assert.equal(as(admin, `select title from reminders where id='${id}'`), 'Call')
  as(admin, `update reminders set title='Updated',status='completed' where id='${id}'`)
  assert.equal(as(staff, `select status from reminders where id='${id}'`), 'completed')
  as(staff, `update reminders set status='pending' where id='${id}'`)
  assert.equal(as(admin, `select status from reminders where id='${id}'`), 'pending')
  as(admin, `delete from reminders where id='${id}'`)
  assert.equal(as(staff, `select count(*) from reminders where id='${id}'`), '0')
})
test('other clinics and inactive profiles cannot read or mutate reminders', {skip}, () => {
  const id = create()
  for (const user of [outsider, blocked]) {
    assert.equal(as(user, `select count(*) from reminders where id='${id}'`),'0')
    as(user, `update reminders set title='Hidden' where id='${id}'`)
    as(user, `delete from reminders where id='${id}'`)
    assert.throws(() => create(user))
  }
  assert.equal(as(staff, `select title from reminders where id='${id}'`),'Call')
})
test('rejects foreign patients and forged or changed ownership', {skip}, () => {
  assert.throws(() => create(staff, foreignPatient))
  assert.throws(() => as(staff, `insert into reminders(clinic_id,created_by,title,date) values ('${clinic}','${admin}','Forged','2026-09-05')`))
  const id = create(staff, patient)
  for (const assignment of [`patient_id='${foreignPatient}'`, `clinic_id='${otherClinic}'`, `created_by='${admin}'`, 'created_by=null']) {
    assert.throws(() => as(staff, `update reminders set ${assignment} where id='${id}'`))
  }
})
test('database rejects invalid content', {skip}, () => {
  const id = create()
  for (const assignment of ["title=' '", "title=repeat('x',201)", "contact_name=repeat('x',201)", "phone=repeat('x',51)", "notes=repeat('x',5001)", "status='cancelled'", "date='infinity'", "time='24:00'"]) {
    assert.throws(() => as(staff, `update reminders set ${assignment} where id='${id}'`), assignment)
  }
})
test('patient and creator deletion retain reminder and null references', {skip}, () => {
  const disposable = query(DB, `insert into patients(clinic_id,name,phone) values ('${clinic}','Delete','3') returning id`)
  const creator = seedUser(DB, 'staff', clinic, 'reminder-cleanup@carebook.test')
  const id = create(creator, disposable)
  query(DB, `delete from patients where id='${disposable}'`)
  assert.equal(as(staff, `select patient_id is null from reminders where id='${id}'`),'t')
  query(DB, `update auth.users set raw_app_meta_data = '{"carebook_e2e_cleanup":{"state":"requested","reason":"Reminder FK test"}}'::jsonb where id='${creator}'`)
  query(DB, `set request.jwt.claim.role='service_role'; delete from auth.users where id='${creator}'`)
  assert.equal(as(staff, `select created_by is null from reminders where id='${id}'`),'t')
})

test('inactive clinics cannot access reminders even with an active profile', {skip}, () => {
  const id = create()
  query(DB, `update clinics set status='inactive' where id='${clinic}'`)
  try {
    assert.equal(as(staff, `select count(*) from reminders where id='${id}'`), '0')
    assert.throws(() => create())
    as(admin, `delete from reminders where id='${id}'`)
  } finally {
    query(DB, `update clinics set status='active' where id='${clinic}'`)
  }
  assert.equal(as(admin, `select count(*) from reminders where id='${id}'`), '1')
})

test('database normalizes optional blanks and preserves original creation time', {skip}, () => {
  const id = create()
  const created = as(staff, `select created_at from reminders where id='${id}'`)
  as(staff, `update reminders set title='  Call  ', contact_name=' ', phone='', notes=' ', created_at='2000-01-01' where id='${id}'`)
  assert.equal(as(staff, `select title from reminders where id='${id}'`), 'Call')
  assert.equal(as(staff, `select contact_name is null and phone is null and notes is null from reminders where id='${id}'`), 't')
  assert.equal(as(staff, `select created_at from reminders where id='${id}'`), created)
})
