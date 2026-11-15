import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  applyMigrationsAfter,
  buildDatabaseThrough,
  dropDatabase,
  postgresAvailable,
  query,
  queryAs,
  queryAsAuthenticated,
  run,
  seedUser,
} from './db.ts'

// The appointments and session_notes policies used to call can_access_appointment(...) per row.
// 20261115100000_appointment_policy_initplans rewrites them so the caller-only helpers run once per
// statement. The rewrite must admit exactly the same rows for every kind of caller and every
// command, or it silently hides (or leaks) clinical data — and applying it must not touch data.
//
// So this file is differential: it builds the database on the previous migration, lays down every
// combination of the columns the rule reads, records what each caller can read, update, delete and
// insert (plus a fingerprint of every public table), applies the new migration, and records it all
// again. Both recordings must be identical. It also checks the result against
// can_access_appointment directly, which the migration leaves in place.

const DB = 'carebook_it_appointment_policy_initplans'
const PREVIOUS_MIGRATION = '20261114144100_tenant_policy_initplans.sql'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

type Caller = { label: string; id: string }
const callers: Caller[] = []
let clinicA = ''
let clinicB = ''
let staffA = ''
let staffA2 = ''
let adminA = ''
const fixture = { patientA: '', patientB: '', typeA: '', typeB: '' }

const OLD_RULE = `public.can_access_appointment(clinic_id, type_is_shared, created_by, assigned_to)`

type Recording = { fingerprint: string; outcomes: Record<string, string> }
let beforeUpgrade: Recording
let afterUpgrade: Recording

/** md5 of every row of every public table, so any data change made by the migration is caught. */
function fingerprint(): string {
  return query(DB, `
    do $$
    declare t record; digest text; result text := '';
    begin
      for t in select tablename from pg_tables where schemaname = 'public' order by tablename loop
        execute format('select %L || '':'' || count(*) || '':'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from public.%I x', t.tablename, t.tablename)
          into digest;
        result := result || digest || E'\\n';
      end loop;
      perform set_config('it.fingerprint', result, false);
    end $$;
    select current_setting('it.fingerprint');`)
}

/**
 * Everything a caller can do to appointments and session notes, as one comparable string. Each probe
 * runs in its own subtransaction that is always rolled back, so probes never affect one another.
 */
function probeCaller(caller: Caller, appointmentIds: string[]): string {
  const idList = appointmentIds.map((id) => `'${id}'::uuid`).join(', ')
  const others = [clinicA, clinicB].map((id) => `'${id}'::uuid`).join(', ')
  return queryAsAuthenticated(DB, caller.id, `
    create temp table if not exists probe_result (k text, v text);
    truncate probe_result;
    do $$
    declare
      target uuid; outcome text; n int;
      clinic uuid; shared boolean; creator uuid; assignee uuid;
      scenario text;
    begin
      foreach target in array array[${idList}] loop
        foreach scenario in array array['notes', 'unshare', 'hand_off', 'move_clinic', 'delete', 'delete_note'] loop
          begin
            if scenario = 'notes' then
              update public.appointments set notes = 'probe' where id = target;
            elsif scenario = 'unshare' then
              update public.appointments set type_is_shared = false where id = target;
            elsif scenario = 'hand_off' then
              update public.appointments set created_by = '${adminA}', assigned_to = null where id = target;
            elsif scenario = 'move_clinic' then
              update public.appointments set clinic_id = case when clinic_id = '${clinicA}' then '${clinicB}'::uuid else '${clinicA}'::uuid end where id = target;
            elsif scenario = 'delete' then
              delete from public.appointments where id = target;
            else
              delete from public.session_notes where appointment_id = target;
            end if;
            get diagnostics n = row_count;
            outcome := 'ok:' || n;
            raise exception using errcode = 'P0001', message = 'probe-rollback';
          exception when others then
            if sqlerrm <> 'probe-rollback' then outcome := 'err:' || sqlstate; end if;
          end;
          insert into probe_result values (target::text || '/' || scenario, outcome);
        end loop;
      end loop;

      foreach clinic in array array[${others}] loop
        foreach shared in array array[true, false] loop
          foreach creator in array array['${staffA}'::uuid, '${staffA2}'::uuid, '${adminA}'::uuid, null::uuid] loop
            foreach assignee in array array['${staffA}'::uuid, '${staffA2}'::uuid, null::uuid] loop
              begin
                insert into public.appointments (clinic_id, patient_id, appointment_type_id, date, time, type, status, type_is_shared, created_by, assigned_to)
                values (clinic,
                        case when clinic = '${clinicA}' then '${fixture.patientA}'::uuid else '${fixture.patientB}'::uuid end,
                        case when clinic = '${clinicA}' then '${fixture.typeA}'::uuid else '${fixture.typeB}'::uuid end,
                        current_date + 1, '11:00', 'Policy', 'scheduled', shared, creator, assignee);
                outcome := 'ok';
                raise exception using errcode = 'P0001', message = 'probe-rollback';
              exception when others then
                if sqlerrm <> 'probe-rollback' then outcome := 'err:' || sqlstate; end if;
              end;
              insert into probe_result values (concat_ws('/', 'insert', clinic, shared, coalesce(creator::text, 'none'), coalesce(assignee::text, 'none')), outcome);
            end loop;
          end loop;
        end loop;
      end loop;

      insert into probe_result
      select 'read/appointments', coalesce(string_agg(id::text, ',' order by id), '') from public.appointments;
      insert into probe_result
      select 'read/session_notes', coalesce(string_agg(id::text, ',' order by id), '') from public.session_notes;
    end $$;
    select string_agg(k || '=' || v, E'\\n' order by k) from probe_result;`)
}

function record(): Recording {
  const appointmentIds = query(DB, `select string_agg(id::text, ',' order by id) from appointments`).split(',')
  const outcomes: Record<string, string> = {}
  for (const caller of callers) outcomes[caller.label] = probeCaller(caller, appointmentIds)
  return { fingerprint: fingerprint(), outcomes }
}

before(() => {
  if (!hasPostgres) return
  buildDatabaseThrough(DB, PREVIOUS_MIGRATION)

  clinicA = query(DB, `insert into clinics (name) values ('Policy A') returning id`)
  clinicB = query(DB, `insert into clinics (name) values ('Policy B') returning id`)
  const inactiveClinic = query(DB, `insert into clinics (name) values ('Policy inactive') returning id`)

  adminA = seedUser(DB, 'admin', clinicA)
  staffA = seedUser(DB, 'staff', clinicA)
  staffA2 = seedUser(DB, 'staff', clinicA)
  const adminB = seedUser(DB, 'admin', clinicB)
  const staffB = seedUser(DB, 'staff', clinicB)
  const blockedStaffA = seedUser(DB, 'staff', clinicA)
  const blockedAdminA = seedUser(DB, 'admin', clinicA)
  const inactiveClinicAdmin = seedUser(DB, 'admin', inactiveClinic)
  const noClinicAdmin = seedUser(DB, 'admin')

  run(DB, `update profiles set status = 'blocked' where id in ('${blockedStaffA}', '${blockedAdminA}')`)
  run(DB, `update clinics set status = 'inactive' where id = '${inactiveClinic}'`)

  callers.push(
    { label: 'admin A', id: adminA },
    { label: 'staff A', id: staffA },
    { label: 'second staff A', id: staffA2 },
    { label: 'admin B', id: adminB },
    { label: 'staff B', id: staffB },
    { label: 'blocked staff A', id: blockedStaffA },
    { label: 'blocked admin A', id: blockedAdminA },
    { label: 'admin of inactive clinic', id: inactiveClinicAdmin },
    { label: 'admin with no clinic', id: noClinicAdmin },
    { label: 'user with no profile', id: '00000000-0000-4000-8000-000000000001' },
  )

  const patientA = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicA}', 'Policy patient A', '1') returning id`)
  const patientB = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicB}', 'Policy patient B', '2') returning id`)

  // Every combination of the columns the rule reads. Triggers would overwrite created_by/clinic
  // from the session, so they are suspended while the fixture is laid down verbatim.
  run(DB, `
    insert into appointment_types (clinic_id, name, is_shared)
    select id, 'Policy', true from clinics where id in ('${clinicA}', '${clinicB}');
    alter table appointments disable trigger user;
    insert into appointments (clinic_id, patient_id, appointment_type_id, date, time, type, status, type_is_shared, created_by, assigned_to)
    select clinic.id, case when clinic.id = '${clinicA}' then '${patientA}'::uuid else '${patientB}'::uuid end,
           (select t.id from appointment_types t where t.clinic_id = clinic.id and t.name = 'Policy'),
           current_date, '09:00', 'Policy', 'scheduled', shared, creator, assignee
    from (values ('${clinicA}'::uuid), ('${clinicB}'::uuid)) clinic(id)
    cross join (values (true), (false)) s(shared)
    cross join (values ('${staffA}'::uuid), ('${staffA2}'::uuid), ('${adminA}'::uuid), (null::uuid)) c(creator)
    cross join (values ('${staffA}'::uuid), ('${staffA2}'::uuid), (null::uuid)) a(assignee);
    alter table appointments enable trigger user;
    insert into session_notes (appointment_id, subjective) select id, 'note' from appointments;
  `)
  Object.assign(fixture, {
    patientA,
    patientB,
    typeA: query(DB, `select id from appointment_types where clinic_id = '${clinicA}' and name = 'Policy'`),
    typeB: query(DB, `select id from appointment_types where clinic_id = '${clinicB}' and name = 'Policy'`),
  })

  beforeUpgrade = record()
  applyMigrationsAfter(DB, PREVIOUS_MIGRATION)
  afterUpgrade = record()
})

after(() => { if (hasPostgres) dropDatabase(DB) })

test('fixture covers every input combination', { skip }, () => {
  assert.equal(query(DB, `select count(*) from appointments`), '48')
  assert.equal(query(DB, `select count(*) from session_notes`), '48')
})

test('applying the migration changes no data in any public table', { skip }, () => {
  assert.equal(afterUpgrade.fingerprint, beforeUpgrade.fingerprint)
  assert.match(afterUpgrade.fingerprint, /appointments:48:/)
  assert.match(afterUpgrade.fingerprint, /session_notes:48:/)
})

test('probes leave no trace: every probe was rolled back', { skip }, () => {
  assert.equal(fingerprint(), afterUpgrade.fingerprint)
})

test('every caller can read, update, delete and insert exactly as before the migration', { skip }, () => {
  for (const caller of callers) {
    const beforeLines = beforeUpgrade.outcomes[caller.label].split('\n')
    const afterLines = afterUpgrade.outcomes[caller.label].split('\n')
    assert.equal(afterLines.length, beforeLines.length, `probe count differs for ${caller.label}`)
    const changed = afterLines.filter((line, index) => line !== beforeLines[index])
    assert.deepEqual(changed, [], `outcomes changed for ${caller.label}`)
  }
})

test('the probe matrix exercises allowed and refused outcomes, not one blanket answer', { skip }, () => {
  const staff = afterUpgrade.outcomes['staff A']
  assert.match(staff, /\/notes=ok:1/)
  assert.match(staff, /\/notes=ok:0/)
  assert.match(staff, /\/unshare=err:42501/) // WITH CHECK refusal: the row would leave staff A's reach
  assert.match(staff, /insert\/.*=ok/)
  assert.match(staff, /insert\/.*=err:/)
  assert.match(afterUpgrade.outcomes['admin A'], /\/delete=ok:1/)
  assert.doesNotMatch(afterUpgrade.outcomes['user with no profile'], /=ok:1|=ok$/m)
})

test('appointments: every caller sees exactly the rows can_access_appointment admits', { skip }, () => {
  for (const caller of callers) {
    const expected = queryAs(DB, caller.id, `select coalesce(string_agg(id::text, ',' order by id), '') from appointments where ${OLD_RULE}`)
    const actual = queryAsAuthenticated(DB, caller.id, `select coalesce(string_agg(id::text, ',' order by id), '') from appointments`)
    assert.equal(actual, expected, `visible appointments differ for ${caller.label}`)
  }
  const staffVisible = Number(queryAsAuthenticated(DB, staffA, `select count(*) from appointments`))
  assert.ok(staffVisible > 0 && staffVisible < 24, `staff A saw ${staffVisible}`)
  assert.equal(queryAsAuthenticated(DB, adminA, `select count(*) from appointments`), '24')
})

test('session notes: every caller sees exactly the notes can_access_appointment admits', { skip }, () => {
  for (const caller of callers) {
    const expected = queryAs(DB, caller.id, `
      select coalesce(string_agg(note.id::text, ',' order by note.id), '')
      from session_notes note join appointments appointment on appointment.id = note.appointment_id
      where public.can_access_appointment(appointment.clinic_id, appointment.type_is_shared, appointment.created_by, appointment.assigned_to)`)
    const actual = queryAsAuthenticated(DB, caller.id, `select coalesce(string_agg(id::text, ',' order by id), '') from session_notes`)
    assert.equal(actual, expected, `visible session notes differ for ${caller.label}`)
  }
})

test('the rewritten policies evaluate caller helpers as initplans', { skip }, () => {
  const plan = queryAsAuthenticated(DB, adminA, `explain (costs off) select * from appointments where status = 'scheduled'`)
  assert.match(plan, /InitPlan/)
  assert.doesNotMatch(plan, /can_access_appointment/)
  const notesPlan = queryAsAuthenticated(DB, adminA, `explain (costs off) select * from session_notes`)
  assert.doesNotMatch(notesPlan, /can_access_appointment/)

  const policyUsages = query(DB, `
    select count(*) from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'can_access_appointment'`)
  assert.equal(policyUsages, '0')
})

test('all appointment command policies share one rule', { skip }, () => {
  const expressions = query(DB, `
    select string_agg(distinct expression, E'\\n---\\n')
    from (
      select qual as expression from pg_policies where schemaname = 'public' and tablename = 'appointments' and qual is not null
      union all
      select with_check from pg_policies where schemaname = 'public' and tablename = 'appointments' and with_check is not null
    ) e`)
  assert.equal(expressions.split('\n---\n').length, 1, `appointment policies diverge:\n${expressions}`)
})

test('billed month totals check the admin role once, keep their grants, and still refuse non-admins', { skip }, () => {
  const source = query(DB, `select prosrc from pg_proc where proname = 'get_billed_month_totals_v1'`)
  assert.match(source, /\(select private\.has_role\(array\['admin'\]\)\)/)
  assert.equal(
    query(DB, `select has_function_privilege('anon', 'public.get_billed_month_totals_v1(integer)', 'execute')`),
    'f',
  )
  assert.equal(
    query(DB, `select has_function_privilege('authenticated', 'public.get_billed_month_totals_v1(integer)', 'execute')`),
    't',
  )
  run(DB, `
    alter table appointments disable trigger user;
    update appointments set status = 'completed', fee = 100 where clinic_id = '${clinicA}' and created_by is null;
    alter table appointments enable trigger user;`)
  assert.equal(queryAsAuthenticated(DB, adminA, `select coalesce(sum(session_count), 0) from public.get_billed_month_totals_v1()`), '6')
  assert.equal(queryAsAuthenticated(DB, adminA, `select coalesce(sum(amount), 0) from public.get_billed_month_totals_v1()`), '600.00')
  assert.equal(queryAsAuthenticated(DB, staffA, `select count(*) from public.get_billed_month_totals_v1()`), '0')
})
