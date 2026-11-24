-- Idempotent billing receipts (G-14).
--
-- A double tap on Save Payment, or a resend after a reply was lost on a weak phone signal, used
-- to record the same payment twice: record_payment_v2 / record_billing_entry_v2 had no way to
-- tell a resend from a new receipt. The app now sends a request id (one per form attempt; the
-- same id for every resend of the same input), and these overloads record it next to the result.
-- A second call with an id that already succeeded returns the first result and writes nothing.
--
-- The existing 7- and 11-argument functions are not touched: the new overloads take one extra,
-- required `p_request_id` and delegate to them, so no guard in those long bodies can be dropped
-- by copying them forward (the risk migration 037 calls out). PostgREST picks the overload by
-- the named arguments sent, so an app build that does not send `p_request_id` (and the legacy
-- record_payment / record_billing_entry wrappers) keep calling the originals unchanged.
--
-- Concurrency: the per-patient advisory lock is taken before the id is looked up, so two
-- simultaneous calls with one id serialise; the second sees the first's committed row. The
-- primary key on request_id is the backstop.

create table if not exists private.billing_request_keys (
  request_id uuid primary key,
  rpc text not null check (rpc in ('record_payment_v2', 'record_billing_entry_v2')),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null,
  actor_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table private.billing_request_keys from public, anon, authenticated;
grant select, insert, update, delete on table private.billing_request_keys to service_role;

-- Shared replay lookup. Returns the stored result for an id this caller may see, null for a new
-- id, and refuses an id that was used for another patient, entry kind or clinic.
create or replace function private.billing_request_replay(p_request_id uuid, p_rpc text, p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  stored private.billing_request_keys%rowtype;
begin
  select * into stored from private.billing_request_keys where request_id = p_request_id;
  if not found then
    return null;
  end if;
  if stored.rpc <> p_rpc or stored.patient_id <> p_patient_id or not private.is_same_clinic(stored.clinic_id) then
    raise exception 'This billing request was already used for a different entry. Close the form and try again.'
      using errcode = '22023';
  end if;
  return stored.result || jsonb_build_object('replayed', true);
end;
$$;

revoke all on function private.billing_request_replay(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.billing_request_remember(p_request_id uuid, p_rpc text, p_patient_id uuid, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not coalesce((p_result ->> 'success')::boolean, false) then
    return;
  end if;
  insert into private.billing_request_keys (request_id, rpc, clinic_id, patient_id, actor_id, result)
  select p_request_id, p_rpc, patient_row.clinic_id, p_patient_id, auth.uid(), p_result
  from public.patients patient_row
  where patient_row.id = p_patient_id;
end;
$$;

revoke all on function private.billing_request_remember(uuid, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.record_payment_v2(
  p_patient_id uuid,
  p_funding_scope text,
  p_package_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_notes text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  replayed jsonb;
  result jsonb;
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to record payments.' using errcode = '42501';
  end if;
  if p_request_id is null then
    return public.record_payment_v2(p_patient_id, p_funding_scope, p_package_id, p_amount, p_payment_method, p_payment_date, p_notes);
  end if;

  perform private.lock_patient_billing_v2(p_patient_id);
  replayed := private.billing_request_replay(p_request_id, 'record_payment_v2', p_patient_id);
  if replayed is not null then
    return replayed;
  end if;

  result := public.record_payment_v2(p_patient_id, p_funding_scope, p_package_id, p_amount, p_payment_method, p_payment_date, p_notes);
  perform private.billing_request_remember(p_request_id, 'record_payment_v2', p_patient_id, result);
  return result;
exception when others then
  return private.billing_error_response(sqlstate, sqlerrm);
end;
$$;

create or replace function public.record_billing_entry_v2(
  p_patient_id uuid,
  p_entry_kind text,
  p_package_name text,
  p_package_total_sessions integer,
  p_package_per_session_amount numeric,
  p_appointment_type_id uuid,
  p_package_starts_on date,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_notes text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  replayed jsonb;
  result jsonb;
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to manage billing.' using errcode = '42501';
  end if;
  if p_request_id is null then
    return public.record_billing_entry_v2(
      p_patient_id, p_entry_kind, p_package_name, p_package_total_sessions, p_package_per_session_amount,
      p_appointment_type_id, p_package_starts_on, p_amount, p_payment_method, p_payment_date, p_notes
    );
  end if;

  perform private.lock_patient_billing_v2(p_patient_id);
  replayed := private.billing_request_replay(p_request_id, 'record_billing_entry_v2', p_patient_id);
  if replayed is not null then
    return replayed;
  end if;

  result := public.record_billing_entry_v2(
    p_patient_id, p_entry_kind, p_package_name, p_package_total_sessions, p_package_per_session_amount,
    p_appointment_type_id, p_package_starts_on, p_amount, p_payment_method, p_payment_date, p_notes
  );
  perform private.billing_request_remember(p_request_id, 'record_billing_entry_v2', p_patient_id, result);
  return result;
exception when others then
  return private.billing_error_response(sqlstate, sqlerrm);
end;
$$;

revoke all on function public.record_payment_v2(uuid, text, uuid, numeric, text, date, text, uuid) from public, anon;
revoke all on function public.record_billing_entry_v2(uuid, text, text, integer, numeric, uuid, date, numeric, text, date, text, uuid) from public, anon;
grant execute on function public.record_payment_v2(uuid, text, uuid, numeric, text, date, text, uuid) to authenticated;
grant execute on function public.record_billing_entry_v2(uuid, text, text, integer, numeric, uuid, date, numeric, text, date, text, uuid) to authenticated;
