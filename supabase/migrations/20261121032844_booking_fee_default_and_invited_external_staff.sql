-- Booking follow-ups for External Staff (2026-11-21).
--
-- 1. One fee default for every booking the client does not price itself: the patient's most
--    recent non-cancelled, non-zero fee for the same appointment type, else the type's session
--    rate. This matches the MCP booking tool (src/lib/mcp/appointment-fee.ts). Staff inserts
--    (trigger from 030) and External Staff bookings use it server-side; admins get it as a
--    suggestion they can still override.
-- 2. Invited External Staff who have not signed in yet can be shared patients and assigned.
--    Invites are temporary-password based, so the account already exists; a revoked invite
--    still makes the profile ineligible (revocation also detaches and bans the account).

begin;

create function private.default_appointment_fee(p_clinic uuid, p_patient uuid, p_type uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select a.fee from public.appointments a
      where a.clinic_id = p_clinic and a.patient_id = p_patient and a.appointment_type_id = p_type
        and a.status <> 'cancelled' and a.fee > 0
      order by a.date desc, a.time desc
      limit 1),
    (select t.session_rate from public.appointment_types t where t.id = p_type and t.clinic_id = p_clinic)
  );
$$;

create function public.suggest_appointment_fee(p_patient_id uuid, p_appointment_type_id uuid)
returns numeric language plpgsql stable security definer set search_path = '' as $$
begin
  -- Fees are payment signals: only clinic admins may read them.
  if auth.uid() is null or not private.has_role(array['admin']) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  return private.default_appointment_fee(private.current_clinic_id(), p_patient_id, p_appointment_type_id);
end;
$$;

revoke all on function private.default_appointment_fee(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.suggest_appointment_fee(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.suggest_appointment_fee(uuid,uuid) to authenticated;

-- 030's guard, priced with the shared default instead of the bare type rate.
create or replace function private.enforce_staff_appointment_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  configured_rate numeric(10,2);
begin
  -- Billing allocation functions update payment_status from inside other
  -- triggers. Those trusted nested writes must not be mistaken for client DML.
  if pg_trigger_depth() > 1 or not private.has_role(array['staff']) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    configured_rate := private.default_appointment_fee(new.clinic_id, new.patient_id, new.appointment_type_id);

    if configured_rate is null then
      raise exception 'Appointment type rate was not found for the appointment clinic.'
        using errcode = '23503';
    end if;

    new.fee := configured_rate;
    new.payment_status := 'unpaid';
  else
    new.fee := old.fee;
    new.payment_status := old.payment_status;
  end if;

  return new;
end;
$$;

create or replace function private.eligible_external_profile(p_profile uuid, p_clinic uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.clinics c on c.id = p.clinic_id
    where p.id = p_profile and p.clinic_id = p_clinic and c.status = 'active'
      and p.status = 'active' and p.role = 'external_staff'
      and not exists (
        select 1 from public.user_invites i
        where i.clinic_id = p.clinic_id and i.status = 'revoked'
          and (i.auth_user_id = p.id or (i.auth_user_id is null and lower(i.email) = lower(p.email)))
      )
  );
$$;

-- 20261120194728's body with the fee taken from private.default_appointment_fee, and a cancelled
-- appointment no longer blocks rebooking the same slot.
create or replace function private.external_create_appointment(p_request jsonb)
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
  perform 1 from public.appointment_types where id = v_type and clinic_id = v_clinic for share;
  if not found then raise exception 'Invalid booking request.' using errcode = '22023'; end if;
  v_rate := private.default_appointment_fee(v_clinic, v_patient, v_type);

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
        and a.status <> 'cancelled'
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

commit;
