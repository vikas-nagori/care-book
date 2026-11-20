begin;

alter table public.profiles drop constraint profiles_role_check,
  add constraint profiles_role_check check (role in ('admin', 'staff', 'external_staff'));
alter table public.user_invites drop constraint user_invites_role_check,
  add constraint user_invites_role_check check (role in ('admin', 'staff', 'external_staff')),
  add constraint external_login_invites_have_no_temporary_link
    check (role <> 'external_staff' or external_staff_id is null);

-- Composite foreign keys also protect grants if someone tries to move a patient
-- or profile to another tenant after an admin has shared the record.
alter table public.patients add unique (id, clinic_id);
alter table public.profiles add unique (id, clinic_id);
create table public.patient_external_access (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null,
  external_profile_id uuid not null,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (patient_id, external_profile_id),
  constraint patient_external_access_patient_id_fkey foreign key (patient_id, clinic_id)
    references public.patients(id, clinic_id) on delete cascade,
  constraint patient_external_access_external_profile_id_fkey foreign key (external_profile_id, clinic_id)
    references public.profiles(id, clinic_id) on delete cascade
);
create index patient_external_access_recipient_idx on public.patient_external_access (external_profile_id, clinic_id);
create index patient_external_access_clinic_idx on public.patient_external_access (clinic_id);
create index patient_external_access_grantor_idx on public.patient_external_access (granted_by);

alter table public.patient_external_access enable row level security;
revoke all on public.patient_external_access from public, anon, authenticated, service_role;
grant select on public.patient_external_access to authenticated, service_role;
create policy patient_external_access_admin_read on public.patient_external_access for select to authenticated
  using (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin'])));

-- Retain membership changes without copying the patient record into history.
create table private.patient_external_access_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null,
  patient_id uuid not null,
  external_profile_id uuid not null,
  actor_id uuid not null,
  action text not null check (action in ('grant', 'revoke')),
  created_at timestamptz not null default now()
);

-- Retry tokens are scoped to the submitting account. The receipt survives a
-- booking deletion so an uncertain retry cannot recreate an admin-deleted row.
create table private.external_booking_requests (
  actor_id uuid not null,
  request_id uuid not null,
  appointment_id uuid not null,
  intent jsonb not null,
  primary key (actor_id, request_id)
);
revoke all on private.patient_external_access_events, private.external_booking_requests
  from public, anon, authenticated, service_role;

alter table public.appointments
  add column external_profile_id uuid references public.profiles(id) on delete restrict,
  add constraint appointments_one_assignee check (num_nonnulls(assigned_to, external_staff_id, external_profile_id) <= 1);
create index appointments_external_calendar_idx on public.appointments (external_profile_id, date, patient_id, time)
  where external_profile_id is not null;

-- Intersect every existing appointment policy (read, insert, update and delete)
-- with the login-assignee rule. Session notes inherit that exact set via RLS.
create policy appointments_protect_external_assignment on public.appointments as restrictive
  for all to authenticated
  using (external_profile_id is null or (select private.has_role(array['admin'])))
  with check (external_profile_id is null or (select private.has_role(array['admin'])));
alter policy session_notes_tenant_appointment_visibility on public.session_notes
  using (exists (select 1 from public.appointments a where a.id = session_notes.appointment_id))
  with check (exists (select 1 from public.appointments a where a.id = session_notes.appointment_id));

-- Older overloads describe an internal appointment with no external login
-- assignee. Callers evaluating an actual row can pass its fifth field.
create function private.can_access_appointment(
  appointment_clinic_id uuid, appointment_is_shared boolean, appointment_created_by uuid,
  appointment_assigned_to uuid, appointment_external_profile_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select (appointment_external_profile_id is null or private.has_role(array['admin']))
    and private.can_access_appointment(appointment_clinic_id, appointment_is_shared,
                                      appointment_created_by, appointment_assigned_to);
$$;
create function public.can_access_appointment(
  appointment_clinic_id uuid, appointment_is_shared boolean, appointment_created_by uuid,
  appointment_assigned_to uuid, appointment_external_profile_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select private.can_access_appointment($1, $2, $3, $4, $5);
$$;

alter policy clinics_read_same_clinic on public.clinics using (
  id = (select private.current_clinic_id()) and (select private.has_role(array['admin','staff']))
);
-- Role changes must also close access to historical connected-tool results.
create policy mcp_grants_internal_only on public.mcp_access_grants as restrictive for all to authenticated
  using ((select private.has_role(array['admin','staff'])))
  with check ((select private.has_role(array['admin','staff'])));
create policy mcp_invocations_internal_only on public.mcp_tool_invocations as restrictive for select to authenticated
  using ((select private.has_role(array['admin','staff'])));

-- Internal helpers are callable only by the checked implementations below.
create function private.eligible_external_profile(p_profile uuid, p_clinic uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.clinics c on c.id = p.clinic_id
    where p.id = p_profile and p.clinic_id = p_clinic and c.status = 'active'
      and p.status = 'active' and p.role = 'external_staff'
      and not exists (
        select 1 from public.user_invites i
        where i.clinic_id = p.clinic_id and i.status in ('pending','revoked')
          and (i.auth_user_id = p.id or (i.auth_user_id is null and lower(i.email) = lower(p.email)))
      )
  );
$$;

create function private.replace_patient_external_access(p_patient_id uuid, p_profile_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_clinic uuid := private.current_clinic_id();
begin
  if v_actor is null or not private.has_role(array['admin']) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  perform private.lock_patient_billing_v2(p_patient_id);
  perform 1 from public.patients where id = p_patient_id and clinic_id = v_clinic for key share;
  if not found then raise exception 'Access denied.' using errcode = '42501'; end if;

  -- Keep role/status/clinic stable through validation and insertion. All
  -- selections are checked before any membership is removed.
  perform 1 from public.profiles where id = any(p_profile_ids) and clinic_id = v_clinic order by id for share;
  if p_profile_ids is null or exists (
    select 1 from unnest(p_profile_ids) as selected(id)
    where not private.eligible_external_profile(selected.id, v_clinic)
  ) then
    raise exception 'Choose active External Staff from this clinic.' using errcode = '22023';
  end if;
  with removed as (
    delete from public.patient_external_access
    where patient_id = p_patient_id and not (external_profile_id = any(p_profile_ids))
    returning external_profile_id
  )
  insert into private.patient_external_access_events (clinic_id, patient_id, external_profile_id, actor_id, action)
    select v_clinic, p_patient_id, external_profile_id, v_actor, 'revoke' from removed;
  with added as (
    insert into public.patient_external_access (clinic_id, patient_id, external_profile_id, granted_by)
      select distinct v_clinic, p_patient_id, id, v_actor from unnest(p_profile_ids) as selected(id)
      on conflict (patient_id, external_profile_id) do nothing returning external_profile_id
  )
  insert into private.patient_external_access_events (clinic_id, patient_id, external_profile_id, actor_id, action)
    select v_clinic, p_patient_id, external_profile_id, v_actor, 'grant' from added;
end;
$$;

-- Run before shared-type normalization. The legacy trigger continues clearing
-- the two legacy assignee fields only, leaving the explicit login FK untouched.
create function private.guard_external_appointment_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
begin
  if new.assigned_to is not null and exists (
    select 1 from public.profiles where id = new.assigned_to and role = 'external_staff'
  ) then
    raise exception 'External Staff require a patient grant and an external assignment.' using errcode = '23514';
  end if;
  if new.external_profile_id is null then return new; end if;
  if num_nonnulls(new.assigned_to, new.external_staff_id) <> 0 then
    raise exception 'Choose only one appointment assignee.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.patient_id = old.patient_id and new.clinic_id = old.clinic_id
     and new.external_profile_id = old.external_profile_id then
    return new;
  end if;
  if not private.has_role(array['admin']) and not (
    new.external_profile_id = auth.uid() and private.has_role(array['external_staff'])
  ) then raise exception 'Access denied.' using errcode = '42501'; end if;

  -- An UPDATE already holds the appointment row: use the ledger's existing
  -- nonblocking locking convention to avoid a row/advisory lock inversion.
  if not private.try_lock_patient_billing_v2(new.patient_id) then
    raise exception 'Concurrent booking update. Retry.' using errcode = '40001';
  end if;
  v_clinic := private.current_clinic_id();
  if (new.clinic_id is not null and new.clinic_id <> v_clinic)
    or not private.eligible_external_profile(new.external_profile_id, v_clinic)
    or not exists (
      select 1 from public.patient_external_access g where g.patient_id = new.patient_id
        and g.clinic_id = v_clinic and g.external_profile_id = new.external_profile_id
    ) then
    raise exception 'Choose an External Staff member with access to this patient.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger appointments_check_external_assignment before insert or update of
  patient_id, clinic_id, assigned_to, external_staff_id, external_profile_id on public.appointments
  for each row execute function private.guard_external_appointment_assignment();

create function private.external_appointment_json(a public.appointments, patient_name text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'patient_id', a.patient_id, 'patient_name', patient_name,
    'date', a.date, 'time', a.time, 'duration_minutes', a.duration_minutes, 'type', a.type, 'status', a.status);
$$;

create function private.external_workspace(p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_clinic uuid := private.current_clinic_id();
begin
  if v_actor is null or not private.eligible_external_profile(v_actor, v_clinic) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or not isfinite(p_start_date) or not isfinite(p_end_date)
    or p_start_date < date '0001-01-01' or p_end_date > date '9999-12-31'
    or p_end_date < p_start_date or p_end_date - p_start_date > 365 then
    raise exception 'Invalid date range.' using errcode = '22023';
  end if;
  return (
    with shared as materialized (
      select p.id, p.name, p.phone, p.dob, p.gender, p.email, p.address
      from public.patient_external_access g
      join public.patients p on p.id = g.patient_id and p.clinic_id = g.clinic_id
      where g.external_profile_id = v_actor and g.clinic_id = v_clinic
    )
    select jsonb_build_object(
      'patients', coalesce((select jsonb_agg(to_jsonb(p) order by p.name, p.id) from shared p),'[]'),
      'appointments', coalesce((select jsonb_agg(private.external_appointment_json(a,p.name) order by a.date,a.time,a.id)
        from public.appointments a join shared p on p.id = a.patient_id
        where a.external_profile_id = v_actor and a.clinic_id = v_clinic and a.date between p_start_date and p_end_date),'[]'),
      'appointment_types', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.sort_order,t.name,t.id)
        from public.appointment_types t where t.clinic_id = v_clinic),'[]')
    )
  );
end;
$$;

create function private.external_create_appointment(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_clinic uuid := private.current_clinic_id();
  v_keys text[] := array['id','patient_id','appointment_type_id','date','time','duration_minutes'];
  v_id uuid;
  v_patient uuid;
  v_type uuid;
  v_date date;
  v_time time;
  v_duration integer;
  v_name text;
  v_rate numeric;
  v_intent jsonb;
  v_receipt private.external_booking_requests%rowtype;
  v_booking public.appointments%rowtype;
begin
  if v_actor is null or not private.eligible_external_profile(v_actor, v_clinic) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or not (p_request ?& v_keys) or p_request - v_keys <> '{}'
    or exists (select 1 from unnest(v_keys[1:5]) k where jsonb_typeof(p_request->k) <> 'string')
    or jsonb_typeof(p_request->'duration_minutes') <> 'number'
    or (p_request->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (p_request->>'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
    or (p_request->>'duration_minutes') !~ '^[0-9]{1,4}$' then
    raise exception 'Invalid booking request.' using errcode = '22023';
  end if;
  begin
    v_id := (p_request->>'id')::uuid;
    v_patient := (p_request->>'patient_id')::uuid;
    v_type := (p_request->>'appointment_type_id')::uuid;
    v_date := (p_request->>'date')::date;
    v_time := (p_request->>'time')::time;
    v_duration := (p_request->>'duration_minutes')::integer;
  exception when data_exception then
    raise exception 'Invalid booking request.' using errcode = '22023';
  end;
  if v_duration not between 1 and 1440 then raise exception 'Invalid booking request.' using errcode = '22023'; end if;
  -- External Staff cannot change appointment status, and the nightly job completes
  -- (and bills) every scheduled row dated before the clinic's today. A backdated
  -- booking would be a completed session by another route, so refuse it.
  if v_date < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Invalid booking request.' using errcode = '22023';
  end if;

  -- The canonical billing lock serializes grant replacement, same-patient
  -- duplicate checks and the ledger trigger. Recheck access AFTER taking it.
  perform private.lock_patient_billing_v2(v_patient);
  select p.name into v_name from public.patients p
  join public.patient_external_access g on g.patient_id = p.id and g.clinic_id = p.clinic_id
  where p.id = v_patient and g.external_profile_id = v_actor and g.clinic_id = v_clinic;
  if not found or not private.eligible_external_profile(v_actor, v_clinic) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  select session_rate into v_rate from public.appointment_types where id = v_type and clinic_id = v_clinic for share;
  if not found then raise exception 'Invalid booking request.' using errcode = '22023'; end if;

  v_intent := jsonb_build_array(v_patient, v_type, v_date, v_time, v_duration);
  -- Reserve the actor/token pair before creating the appointment. ON CONFLICT
  -- waits for another writer using the token even when its patient differs.
  insert into private.external_booking_requests (actor_id, request_id, appointment_id, intent)
    values (v_actor, v_id, gen_random_uuid(), v_intent)
    on conflict (actor_id, request_id) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.external_booking_requests where actor_id = v_actor and request_id = v_id;
    select * into v_booking from public.appointments a
      where a.id = v_receipt.appointment_id and a.clinic_id = v_clinic and a.created_by = v_actor
        and a.external_profile_id = v_actor and a.patient_id = v_patient and a.appointment_type_id = v_type
        and a.date = v_date and a.time = v_time and a.duration_minutes = v_duration;
    if not found or v_receipt.intent <> v_intent then
      raise exception 'Invalid booking request.' using errcode = '22023';
    end if;
  else
    if exists (
      select 1 from public.appointments a where a.clinic_id = v_clinic and a.external_profile_id = v_actor
        and a.patient_id = v_patient and a.date = v_date and a.time = v_time
    ) then
      raise exception 'You already have an appointment with this patient at that time.' using errcode = '23P01';
    end if;
    begin
      insert into public.appointments (id, clinic_id, patient_id, appointment_type_id, date, time,
        duration_minutes, status, external_profile_id, created_by, fee)
      values (v_receipt.appointment_id, v_clinic, v_patient, v_type, v_date, v_time, v_duration,
        'scheduled', v_actor, v_actor, v_rate) returning * into v_booking;
    exception when others then
      -- Trigger, constraint and ledger diagnostics can contain sensitive rows.
      raise exception 'Unable to create this appointment.' using errcode = 'P0001';
    end;
  end if;
  return private.external_appointment_json(v_booking, v_name);
end;
$$;

create function public.replace_patient_external_access(p_patient_id uuid, p_profile_ids uuid[])
returns void language sql security invoker set search_path = '' as $$
  select private.replace_patient_external_access(p_patient_id, p_profile_ids);
$$;
create function public.external_workspace(p_start_date date, p_end_date date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.external_workspace(p_start_date, p_end_date);
$$;
create function public.external_create_appointment(p_request jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.external_create_appointment(p_request);
$$;

revoke all on function private.eligible_external_profile(uuid,uuid), private.guard_external_appointment_assignment(),
  private.external_appointment_json(public.appointments,text) from public, anon, authenticated, service_role;
revoke all on function private.replace_patient_external_access(uuid,uuid[]), public.replace_patient_external_access(uuid,uuid[]),
  private.external_workspace(date,date), public.external_workspace(date,date),
  private.external_create_appointment(jsonb), public.external_create_appointment(jsonb),
  private.can_access_appointment(uuid,boolean,uuid,uuid,uuid), public.can_access_appointment(uuid,boolean,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.replace_patient_external_access(uuid,uuid[]), public.replace_patient_external_access(uuid,uuid[]),
  private.external_workspace(date,date), public.external_workspace(date,date),
  private.external_create_appointment(jsonb), public.external_create_appointment(jsonb),
  private.can_access_appointment(uuid,boolean,uuid,uuid,uuid), public.can_access_appointment(uuid,boolean,uuid,uuid,uuid)
  to authenticated;

-- Sharing a patient and being an external assignee are audit history too: such users must be
-- soft-deleted (migration 033) rather than hit a raw FK error. Body is 034's plus the last three
-- checks; CREATE OR REPLACE keeps 033's grants (service_role, supabase_auth_admin only).
create or replace function private.user_has_retained_history(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.packages where created_by = p_user_id or cancelled_by = p_user_id)
    or exists (select 1 from public.payments where created_by = p_user_id or voided_by = p_user_id)
    or exists (select 1 from public.billing_events where actor_id = p_user_id)
    or exists (select 1 from public.appointment_charge_adjustments where created_by = p_user_id)
    or exists (select 1 from public.refunds where created_by = p_user_id)
    or exists (select 1 from public.refund_reversals where created_by = p_user_id)
    or exists (select 1 from public.profiles where deleted_by = p_user_id)
    or exists (select 1 from public.appointments where created_by = p_user_id or assigned_to = p_user_id
      or external_profile_id = p_user_id)
    or exists (select 1 from public.external_staff where created_by = p_user_id or linked_profile_id = p_user_id)
    or exists (select 1 from public.doctors where created_by = p_user_id)
    or exists (select 1 from public.clinic_onboarding_requests where approved_by = p_user_id or rejected_by = p_user_id)
    or exists (select 1 from public.user_invites where auth_user_id = p_user_id or invited_by = p_user_id)
    or exists (select 1 from public.patient_external_access where granted_by = p_user_id)
    or exists (select 1 from private.patient_external_access_events
      where actor_id = p_user_id or external_profile_id = p_user_id);
$$;

commit;
