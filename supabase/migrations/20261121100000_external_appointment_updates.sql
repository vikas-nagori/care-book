-- External Staff can reschedule or cancel their own upcoming appointments (2026-11-21).
--
-- 1. The external appointment projection gains appointment_type_id so the workspace can prefill
--    a reschedule form. It is a clinic-wide catalogue id the workspace already lists; fee, notes
--    and payment fields stay out of this projection.
-- 2. private.external_update_appointment: one narrow write path. The caller may change the date,
--    time, duration and type of a scheduled appointment assigned to them, or cancel it. They can
--    never complete it, reassign it, move it to another patient or set its fee: a type change is
--    repriced server-side with private.default_appointment_fee, otherwise the fee is untouched.

begin;

create or replace function private.external_appointment_json(a public.appointments, patient_name text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'patient_id', a.patient_id, 'patient_name', patient_name,
    'appointment_type_id', a.appointment_type_id,
    'date', a.date, 'time', a.time, 'duration_minutes', a.duration_minutes, 'type', a.type, 'status', a.status);
$$;

create function private.external_update_appointment(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_clinic uuid := private.current_clinic_id();
  v_keys text[] := array['id','appointment_type_id','date','time','status','duration_minutes'];
  v_id uuid;
  v_type uuid;
  v_date date;
  v_time time;
  v_duration integer;
  v_status text;
  v_patient uuid;
  v_name text;
  v_fee numeric;
  v_current public.appointments%rowtype;
  v_updated public.appointments%rowtype;
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
    or (p_request->>'duration_minutes') !~ '^[0-9]{1,4}$'
    or (p_request->>'status') not in ('scheduled', 'cancelled') then
    raise exception 'Invalid booking request.' using errcode = '22023';
  end if;
  begin
    v_id := (p_request->>'id')::uuid;
    v_type := (p_request->>'appointment_type_id')::uuid;
    v_date := (p_request->>'date')::date;
    v_time := (p_request->>'time')::time;
    v_duration := (p_request->>'duration_minutes')::integer;
    v_status := p_request->>'status';
  exception when data_exception then
    raise exception 'Invalid booking request.' using errcode = '22023';
  end;
  if v_duration not between 1 and 1440 then raise exception 'Invalid booking request.' using errcode = '22023'; end if;

  -- Every miss reports the same denial, so a probe cannot tell another clinic's, another
  -- assignee's or an internal appointment apart from an id that does not exist.
  select a.patient_id into v_patient from public.appointments a where a.id = v_id and a.clinic_id = v_clinic;
  if not found then raise exception 'Access denied.' using errcode = '42501'; end if;

  -- Same lock order as booking and grant replacement: patient lock first, then the row.
  -- Recheck everything after taking it.
  perform private.lock_patient_billing_v2(v_patient);
  select * into v_current from public.appointments a where a.id = v_id and a.clinic_id = v_clinic for update;
  if not found or v_current.external_profile_id is distinct from v_actor
    or not private.eligible_external_profile(v_actor, v_clinic) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if v_current.patient_id <> v_patient then
    raise exception 'Concurrent booking update. Retry.' using errcode = '40001';
  end if;
  select p.name into v_name from public.patients p
  join public.patient_external_access g on g.patient_id = p.id and g.clinic_id = p.clinic_id
  where p.id = v_patient and g.external_profile_id = v_actor and g.clinic_id = v_clinic;
  if not found then raise exception 'Access denied.' using errcode = '42501'; end if;
  if v_current.status <> 'scheduled' then
    raise exception 'This appointment can no longer be changed.' using errcode = 'P0002';
  end if;
  perform 1 from public.appointment_types where id = v_type and clinic_id = v_clinic for share;
  if not found then raise exception 'Invalid booking request.' using errcode = '22023'; end if;

  if v_status = 'cancelled' then
    -- A cancellation states the appointment it cancels; it cannot also reschedule it.
    if v_current.appointment_type_id is distinct from v_type or v_current.date <> v_date
      or v_current.time <> v_time or v_current.duration_minutes <> v_duration then
      raise exception 'Invalid booking request.' using errcode = '22023';
    end if;
    -- Only upcoming sessions: a past-dated one still 'scheduled' is about to be completed and
    -- billed by the nightly job, and cancelling it would avoid that charge.
    if v_current.date < (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'This appointment can no longer be changed.' using errcode = 'P0002';
    end if;
    begin
      update public.appointments set status = 'cancelled' where id = v_id returning * into v_updated;
    exception when others then
      -- Trigger, constraint and ledger diagnostics can contain sensitive rows.
      raise exception 'Unable to update this appointment.' using errcode = 'P0001';
    end;
  else
    -- The nightly job completes (and bills) scheduled rows dated before the clinic's today.
    if v_date < (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'Invalid booking request.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.appointments a where a.clinic_id = v_clinic and a.external_profile_id = v_actor
        and a.patient_id = v_patient and a.date = v_date and a.time = v_time
        and a.status <> 'cancelled' and a.id <> v_id
    ) then
      raise exception 'You already have an appointment for this patient at that time.' using errcode = '23P01';
    end if;
    v_fee := case when v_type is distinct from v_current.appointment_type_id
      then private.default_appointment_fee(v_clinic, v_patient, v_type) else v_current.fee end;
    begin
      update public.appointments
        set date = v_date, time = v_time, duration_minutes = v_duration, appointment_type_id = v_type, fee = v_fee
        where id = v_id returning * into v_updated;
    exception when others then
      raise exception 'Unable to update this appointment.' using errcode = 'P0001';
    end;
  end if;
  return private.external_appointment_json(v_updated, v_name);
end;
$$;

create function public.external_update_appointment(p_request jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.external_update_appointment(p_request);
$$;

revoke all on function private.external_update_appointment(jsonb), public.external_update_appointment(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.external_update_appointment(jsonb), public.external_update_appointment(jsonb)
  to authenticated;

commit;
