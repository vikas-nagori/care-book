-- Local-stack seed, run after migrations on `supabase db reset` / first `supabase start`.
--
-- Migrations 027 and 028 add RLS-protected tables after the original application grants in
-- migration 019. Hosted Supabase applies role defaults, while a clean local reset does not.
-- Keep the local role grants explicit: application roles get ordinary row DML (RLS still
-- applies), and the service-role seed/factory harness gets the same DML without broad table,
-- sequence, or function ownership privileges.

grant usage on schema public to service_role;

-- Local role defaults include ownership-style capabilities that bypass the intended row/RLS
-- access model. Neither the app nor the E2E harness needs them.
revoke truncate, references, trigger, maintain on all tables in schema public
from anon, authenticated, service_role;
revoke update on all sequences in schema public from anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.appointment_payments,
  public.appointment_types,
  public.appointments,
  public.clinic_onboarding_requests,
  public.clinics,
  public.doctors,
  public.external_staff,
  public.global_settings,
  public.package_session_allocations,
  public.package_templates,
  public.packages,
  public.patients,
  public.payments,
  public.profiles,
  public.session_notes,
  public.treatment_plans,
  public.user_invites
to service_role;

grant select, insert, update, delete on table
  public.appointment_types,
  public.package_templates
to authenticated;

grant usage, select on sequence public.global_settings_id_seq to authenticated, service_role;

grant execute on function public.approve_clinic_onboarding_request(uuid, uuid) to service_role;
grant execute on function public.reject_clinic_onboarding_request(uuid, uuid, text) to service_role;

-- Local-only extensions of the immutable guards. The bypass is transaction-local and is set only
-- inside cleanup_e2e_patient after its service-role and `E2E ...` identity checks pass.
create or replace function private.reject_billing_ledger_mutation()
returns trigger language plpgsql set search_path = public, private as $$
begin
  if current_setting('carebook.e2e_cleanup', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE'
     and tg_table_name = 'billing_events'
     and pg_trigger_depth() > 1
     and (to_jsonb(old) ->> 'actor_id') is not null
     and (to_jsonb(new) ->> 'actor_id') is null
     and (to_jsonb(old) - 'actor_id') = (to_jsonb(new) - 'actor_id') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and tg_table_name = 'appointment_charge_adjustments'
     and pg_trigger_depth() > 1
     and (to_jsonb(old) ->> 'appointment_id') is not null
     and (to_jsonb(new) ->> 'appointment_id') is null
     and (to_jsonb(old) - 'appointment_id') = (to_jsonb(new) - 'appointment_id')
     and not exists (
       select 1 from public.appointments
       where id = ((to_jsonb(old) ->> 'appointment_id')::uuid)
     ) then
    return new;
  end if;
  raise exception 'Billing audit rows are immutable.' using errcode = '55000';
end;
$$;

create or replace function private.guard_payment_application_history_v2()
returns trigger language plpgsql set search_path = public, private as $$
begin
  if current_setting('carebook.e2e_cleanup', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and new.status = 'reversed'
     and old.reversed_at is null
     and old.reversal_reason is null
     and new.reversed_at is not null
     and nullif(btrim(new.reversal_reason), '') is not null
     and (to_jsonb(old) - array['status', 'reversed_at', 'reversal_reason'])
       = (to_jsonb(new) - array['status', 'reversed_at', 'reversal_reason']) then
    return new;
  end if;
  raise exception 'Payment application history is immutable; only active-to-reversed transition is allowed.' using errcode = '55000';
end;
$$;

create or replace function private.guard_package_allocation_history_v2()
returns trigger language plpgsql set search_path = public, private as $$
begin
  if current_setting('carebook.e2e_cleanup', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE'
     and pg_trigger_depth() > 1
     and old.appointment_id is not null
     and new.appointment_id is null
     and (to_jsonb(old) - 'appointment_id') = (to_jsonb(new) - 'appointment_id')
     and not exists (select 1 from public.appointments where id = old.appointment_id) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.lifecycle in ('scheduled', 'availed')
     and new.lifecycle = 'released'
     and old.released_at is null
     and old.release_reason is null
     and new.released_at is not null
     and nullif(btrim(new.release_reason), '') is not null
     and (to_jsonb(old) - array['lifecycle', 'released_at', 'release_reason'])
       = (to_jsonb(new) - array['lifecycle', 'released_at', 'release_reason']) then
    return new;
  end if;
  raise exception 'Package allocation history is immutable; only active-to-released transition is allowed.' using errcode = '55000';
end;
$$;

-- The browser suite creates immutable billing history by design. This helper exists only in the
-- local seed (never in a production migration) and is the sole teardown path for disposable
-- `E2E ...` patients. It keeps the production ledger guards intact while preventing one test's
-- audit roots from contaminating later pagination and balance assertions.
create or replace function public.cleanup_e2e_patient(target_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_name text;
begin
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       nullif(current_setting('role', true), 'none'),
       session_user
     ) <> 'service_role' then
    raise exception 'E2E patient cleanup requires service_role.' using errcode = '42501';
  end if;

  select p.name
  into target_name
  from public.patients p
  where p.id = target_patient_id;

  if not found then
    return;
  end if;

  if target_name not like 'E2E %' then
    raise exception 'Only disposable E2E patients can be cleaned.' using errcode = '42501';
  end if;

  perform set_config('carebook.e2e_cleanup', 'on', true);

  delete from public.refund_reversals where patient_id = target_patient_id;
  delete from public.refunds where patient_id = target_patient_id;
  delete from public.payment_applications where patient_id = target_patient_id;
  delete from public.appointment_charge_adjustments where patient_id = target_patient_id;
  delete from public.appointment_charges where patient_id = target_patient_id;
  delete from public.billing_events where patient_id = target_patient_id;
  delete from public.package_session_allocations where patient_id = target_patient_id;
  delete from public.appointment_payments
  where appointment_id in (
    select id from public.appointments where patient_id = target_patient_id
  ) or payment_id in (
    select id from public.payments where patient_id = target_patient_id
  );
  delete from public.session_notes
  where appointment_id in (
    select id from public.appointments where patient_id = target_patient_id
  );
  delete from public.payments where patient_id = target_patient_id;
  delete from public.packages where patient_id = target_patient_id;
  delete from public.appointments where patient_id = target_patient_id;
  delete from public.treatment_plans where patient_id = target_patient_id;
  delete from public.patients where id = target_patient_id;

  perform set_config('carebook.e2e_cleanup', 'off', true);
end;
$$;

revoke all on function public.cleanup_e2e_patient(uuid) from public, anon, authenticated;
grant execute on function public.cleanup_e2e_patient(uuid) to service_role;
