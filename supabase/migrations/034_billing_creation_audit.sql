begin;

alter table public.packages
  add column if not exists created_by uuid references auth.users(id) on delete restrict,
  add column if not exists creation_origin text;
alter table public.payments
  add column if not exists created_by uuid references auth.users(id) on delete restrict,
  add column if not exists creation_origin text;

-- Rows predating this migration do not have a trustworthy creation actor. Keep that fact
-- explicit instead of inventing an administrator identity during backfill.
select set_config('carebook.billing_package_mutation_v2', 'on', true);
update public.packages set creation_origin = 'legacy_unknown' where creation_origin is null;
select set_config('carebook.billing_package_mutation_v2', 'off', true);
select set_config('carebook.billing_payment_mutation_v2', 'on', true);
update public.payments set creation_origin = 'legacy_unknown' where creation_origin is null;
select set_config('carebook.billing_payment_mutation_v2', 'off', true);
-- Only the rows present during this backfill may retain legacy_unknown. New
-- actorless inserts are system operations and still receive an audit event.
alter table public.packages alter column creation_origin set default 'system';
alter table public.payments alter column creation_origin set default 'system';
alter table public.packages alter column creation_origin set not null;
alter table public.payments alter column creation_origin set not null;

alter table public.packages drop constraint if exists packages_creation_audit_check;
alter table public.packages add constraint packages_creation_audit_check check (
  (creation_origin in ('legacy_unknown', 'system') and created_by is null)
  or (creation_origin in ('rpc', 'historical_correction') and created_by is not null)
);
alter table public.payments drop constraint if exists payments_creation_audit_check;
alter table public.payments add constraint payments_creation_audit_check check (
  (creation_origin in ('legacy_unknown', 'system') and created_by is null)
  or (creation_origin in ('rpc', 'historical_correction') and created_by is not null)
);

create or replace function private.capture_billing_creation_audit_v2()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  actor uuid := auth.uid();
  effective_role name := coalesce(nullif(current_setting('role', true), 'none'), session_user)::name;
  historical_authorized boolean := false;
begin
  if actor is not null then
    new.created_by := actor;
    new.creation_origin := 'rpc';
    return new;
  end if;

  if new.creation_origin = 'historical_correction' and new.created_by is not null then
    if to_regclass('private.billing_ops_gate') is not null then
      select exists (
        select 1 from private.billing_ops_gate gate
        where gate.id = true
          and gate.status in ('paused_verified', 'corrections_applied')
          and gate.authorized_db_role = effective_role
          and encode(extensions.digest(current_setting('carebook.ops.bypass_token', true), 'sha256'), 'hex') = gate.bypass_token_digest
      ) into historical_authorized;
    end if;
    if not historical_authorized then
      raise exception 'Historical creation actors require the verified billing operations gate.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.created_by is not null then
    raise exception 'A creation actor can only be captured by an authenticated billing RPC.' using errcode = '42501';
  end if;

  -- Do not allow a post-migration insert to masquerade as an unauditable
  -- legacy row. Service/operator writes are recorded with a null actor and a
  -- distinct system origin.
  new.creation_origin := 'system';
  return new;
end
$$;

create or replace function private.append_billing_creation_event_v2()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if new.creation_origin = 'legacy_unknown' then return new; end if;
  if tg_table_name = 'payments' then
    insert into public.billing_events (
      clinic_id, patient_id, event_type, entity_type, entity_id, actor_id, details
    ) values (
      new.clinic_id, new.patient_id, 'payment_recorded', 'payment', new.id, new.created_by,
      jsonb_build_object(
        'amount', new.amount, 'fundingScope', new.funding_scope, 'packageId', new.package_id,
        'paymentMethod', new.payment_method, 'paymentDate', new.date,
        'creationOrigin', new.creation_origin
      )
    );
  else
    insert into public.billing_events (
      clinic_id, patient_id, event_type, entity_type, entity_id, actor_id, details
    ) values (
      new.clinic_id, new.patient_id, 'package_created', 'package', new.id, new.created_by,
      jsonb_build_object(
        'name', new.name, 'totalSessions', new.total_sessions,
        'perSessionAmount', new.per_session_amount, 'totalAmount', new.total_amount,
        'appointmentTypeId', new.appointment_type_id, 'startsOn', new.starts_on,
        'creationOrigin', new.creation_origin
      )
    );
  end if;
  return new;
end
$$;

create or replace function private.guard_billing_creation_audit_v2()
returns trigger language plpgsql set search_path = public, private, pg_temp as $$
begin
  if new.created_by is distinct from old.created_by
     or new.creation_origin is distinct from old.creation_origin then
    raise exception 'Billing creation audit metadata is immutable.' using errcode = '55000';
  end if;
  return new;
end
$$;

drop trigger if exists packages_capture_creation_audit_v2 on public.packages;
create trigger packages_capture_creation_audit_v2
  before insert on public.packages for each row execute function private.capture_billing_creation_audit_v2();
drop trigger if exists payments_capture_creation_audit_v2 on public.payments;
create trigger payments_capture_creation_audit_v2
  before insert on public.payments for each row execute function private.capture_billing_creation_audit_v2();
drop trigger if exists packages_append_creation_event_v2 on public.packages;
create trigger packages_append_creation_event_v2
  after insert on public.packages for each row execute function private.append_billing_creation_event_v2();
drop trigger if exists payments_append_creation_event_v2 on public.payments;
create trigger payments_append_creation_event_v2
  after insert on public.payments for each row execute function private.append_billing_creation_event_v2();
drop trigger if exists aa_packages_creation_audit_immutable_v2 on public.packages;
create trigger aa_packages_creation_audit_immutable_v2
  before update on public.packages for each row execute function private.guard_billing_creation_audit_v2();
drop trigger if exists aa_payments_creation_audit_immutable_v2 on public.payments;
create trigger aa_payments_creation_audit_immutable_v2
  before update on public.payments for each row execute function private.guard_billing_creation_audit_v2();

create or replace function private.user_has_retained_history(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.packages where created_by = p_user_id or cancelled_by = p_user_id)
    or exists (select 1 from public.payments where created_by = p_user_id or voided_by = p_user_id)
    or exists (select 1 from public.billing_events where actor_id = p_user_id)
    or exists (select 1 from public.appointment_charge_adjustments where created_by = p_user_id)
    or exists (select 1 from public.refunds where created_by = p_user_id)
    or exists (select 1 from public.refund_reversals where created_by = p_user_id)
    or exists (select 1 from public.profiles where deleted_by = p_user_id)
    or exists (select 1 from public.appointments where created_by = p_user_id or assigned_to = p_user_id)
    or exists (select 1 from public.external_staff where created_by = p_user_id or linked_profile_id = p_user_id)
    or exists (select 1 from public.doctors where created_by = p_user_id)
    or exists (select 1 from public.clinic_onboarding_requests where approved_by = p_user_id or rejected_by = p_user_id)
    or exists (select 1 from public.user_invites where auth_user_id = p_user_id or invited_by = p_user_id);
$$;

revoke all on function private.capture_billing_creation_audit_v2() from public, anon, authenticated;
revoke all on function private.append_billing_creation_event_v2() from public, anon, authenticated;
revoke all on function private.guard_billing_creation_audit_v2() from public, anon, authenticated;
grant execute on function private.capture_billing_creation_audit_v2() to service_role;
grant execute on function private.append_billing_creation_event_v2() to service_role;
grant execute on function private.guard_billing_creation_audit_v2() to service_role;

commit;
