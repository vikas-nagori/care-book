begin;

-- Complete the v2 billing write boundary: audited RPCs, read-only ledger RLS,
-- safe legacy compatibility, and reconstructable appointment deletion history.

-- Refunds are financial records in their own right, so retain the effective date and method.
alter table public.refunds
  add column if not exists refund_method text,
  add column if not exists refund_date date;

update public.refunds refund
set refund_method = payment.payment_method,
    refund_date = refund.created_at::date
from public.payments payment
where payment.id = refund.payment_id
  and (refund.refund_method is null or refund.refund_date is null);

alter table public.refunds
  alter column refund_method set not null,
  alter column refund_date set not null;

alter table public.refunds drop constraint if exists refunds_method_check;
alter table public.refunds add constraint refunds_method_check
  check (refund_method in ('cash', 'upi', 'card', 'bank_transfer'));

drop trigger if exists payments_no_hard_delete_v2 on public.payments;
create trigger payments_no_hard_delete_v2
  before delete on public.payments
  for each row execute function private.reject_billing_ledger_mutation();
drop trigger if exists packages_no_hard_delete_v2 on public.packages;
create trigger packages_no_hard_delete_v2
  before delete on public.packages
  for each row execute function private.reject_billing_ledger_mutation();

create or replace function private.guard_payment_rewrite_v2()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1
     and old.voided_by is not null
     and new.voided_by is null
     and (to_jsonb(old) - 'voided_by') = (to_jsonb(new) - 'voided_by') then
    return new;
  end if;
  if current_setting('carebook.billing_payment_mutation_v2', true) is distinct from 'on' then
    raise exception 'Payment receipts are immutable; use a billing RPC.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function private.guard_package_rewrite_v2()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1
     and old.cancelled_by is not null
     and new.cancelled_by is null
     and (to_jsonb(old) - 'cancelled_by') = (to_jsonb(new) - 'cancelled_by') then
    return new;
  end if;
  if current_setting('carebook.billing_reconcile_v2', true) is distinct from 'on'
     and current_setting('carebook.billing_package_mutation_v2', true) is distinct from 'on' then
    raise exception 'Packages are immutable; use a billing RPC.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_guard_rewrite_v2 on public.payments;
create trigger payments_guard_rewrite_v2
  before update on public.payments
  for each row execute function private.guard_payment_rewrite_v2();
drop trigger if exists packages_guard_rewrite_v2 on public.packages;
create trigger packages_guard_rewrite_v2
  before update on public.packages
  for each row execute function private.guard_package_rewrite_v2();

-- Keep stable, non-FK appointment identifiers on ledger rows. The nullable FK is only
-- a convenience link while the schedule row exists; the reference id preserves history.
-- This backfill runs inside migration 032's transaction. Temporarily remove only the two
-- guards whose newly-added reference column must be initialized, then restore them before
-- commit; no externally visible migration state has the history boundary disabled.
drop trigger if exists appointment_charge_adjustments_immutable on public.appointment_charge_adjustments;
drop trigger if exists package_session_allocations_no_delete on public.package_session_allocations;

alter table public.appointment_charges
  add column if not exists appointment_reference_id uuid;
update public.appointment_charges
set appointment_reference_id = appointment_id
where appointment_reference_id is null;
alter table public.appointment_charges
  alter column appointment_reference_id set not null,
  alter column appointment_id drop not null;
alter table public.appointment_charges drop constraint if exists appointment_charges_appointment_id_fkey;
alter table public.appointment_charges add constraint appointment_charges_appointment_id_fkey
  foreign key (appointment_id) references public.appointments(id) on delete set null;

alter table public.appointment_charge_adjustments
  add column if not exists appointment_reference_id uuid;
update public.appointment_charge_adjustments
set appointment_reference_id = appointment_id
where appointment_reference_id is null;
alter table public.appointment_charge_adjustments
  alter column appointment_reference_id set not null,
  alter column appointment_id drop not null;
alter table public.appointment_charge_adjustments drop constraint if exists appointment_charge_adjustments_appointment_id_fkey;
alter table public.appointment_charge_adjustments add constraint appointment_charge_adjustments_appointment_id_fkey
  foreign key (appointment_id) references public.appointments(id) on delete set null;

alter table public.package_session_allocations
  add column if not exists appointment_reference_id uuid;
update public.package_session_allocations
set appointment_reference_id = appointment_id
where appointment_reference_id is null;
alter table public.package_session_allocations
  alter column appointment_reference_id set not null,
  alter column appointment_id drop not null;
alter table public.package_session_allocations drop constraint if exists package_session_allocations_appointment_id_fkey;
alter table public.package_session_allocations add constraint package_session_allocations_appointment_id_fkey
  foreign key (appointment_id) references public.appointments(id) on delete set null;

create or replace function private.set_billing_appointment_reference_v2()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  new.appointment_reference_id := coalesce(new.appointment_reference_id, new.appointment_id);
  if new.appointment_reference_id is null then
    raise exception 'Appointment reference is required.' using errcode = '23502';
  end if;
  return new;
end;
$$;

create trigger appointment_charges_set_reference_v2
  before insert or update of appointment_id, appointment_reference_id
  on public.appointment_charges for each row
  execute function private.set_billing_appointment_reference_v2();
create trigger appointment_charge_adjustments_set_reference_v2
  before insert or update of appointment_id, appointment_reference_id
  on public.appointment_charge_adjustments for each row
  execute function private.set_billing_appointment_reference_v2();
create trigger package_session_allocations_set_reference_v2
  before insert or update of appointment_id, appointment_reference_id
  on public.package_session_allocations for each row
  execute function private.set_billing_appointment_reference_v2();

create trigger appointment_charge_adjustments_immutable
  before update or delete on public.appointment_charge_adjustments
  for each row execute function private.reject_billing_ledger_mutation();
create trigger package_session_allocations_no_delete
  before update or delete on public.package_session_allocations
  for each row execute function private.guard_package_allocation_history_v2();

-- A completed charge cannot be silently rewritten. Scheduled appointments remain editable;
-- completed fee corrections must use public.adjust_appointment_fee.
create or replace function private.guard_completed_appointment_fee_v2()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if old.status = 'completed'
     and old.fee is distinct from new.fee
     and current_setting('carebook.billing_fee_adjustment_v2', true) is distinct from 'on' then
    raise exception 'Completed appointment fees must be changed with adjust_appointment_fee.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger appointments_guard_completed_fee_v2
  before update of fee on public.appointments
  for each row execute function private.guard_completed_appointment_fee_v2();

-- Preserve charge/allocation history when a deletable scheduled appointment is removed.
create or replace function private.preserve_deleted_appointment_billing_v2()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- DELETE already owns the appointment row. Refuse to wait for a patient lock from
  -- this inverted position before touching any charge/allocation child row; the caller
  -- can retry after the canonical RPC transaction releases the patient advisory lock.
  if not private.try_lock_patient_billing_v2(old.patient_id) then
    raise exception 'Concurrent billing update; retry the transaction.' using errcode = '40001';
  end if;

  update public.appointment_charges
  set status = 'voided', updated_at = now()
  where appointment_id = old.id;

  update public.package_session_allocations
  set lifecycle = 'released',
      released_at = coalesce(released_at, now()),
      release_reason = coalesce(release_reason, 'appointment deleted')
  where appointment_id = old.id and lifecycle <> 'released';

  if exists (select 1 from public.appointment_charges where appointment_reference_id = old.id)
     or exists (select 1 from public.package_session_allocations where appointment_reference_id = old.id) then
    insert into public.billing_events (
      clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details
    ) values (
      old.clinic_id, old.patient_id, 'appointment_deleted', 'appointment', old.id,
      'scheduled appointment deleted', auth.uid(),
      jsonb_build_object('date', old.date, 'time', old.time, 'status', old.status, 'fee', old.fee)
    );
  end if;
  return old;
end;
$$;

drop trigger if exists appointments_delete_sync_billing on public.appointments;
create trigger appointments_preserve_billing_before_delete_v2
  before delete on public.appointments
  for each row execute function private.preserve_deleted_appointment_billing_v2();
create trigger appointments_reconcile_billing_after_delete_v2
  after delete on public.appointments
  for each row execute function private.trigger_reconcile_patient_billing_v2();

-- Read-only, admin-only ledger access. Security-definer RPCs own every write.
drop policy if exists "packages_tenant_admin_access" on public.packages;
drop policy if exists "payments_tenant_admin_access" on public.payments;
drop policy if exists "appointment_payments_tenant_admin_access" on public.appointment_payments;
drop policy if exists "packages_tenant_admin_read_v2" on public.packages;
drop policy if exists "payments_tenant_admin_read_v2" on public.payments;
drop policy if exists "appointment_payments_tenant_admin_read_v2" on public.appointment_payments;
create policy "packages_tenant_admin_read_v2" on public.packages
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));
create policy "payments_tenant_admin_read_v2" on public.payments
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));
create policy "appointment_payments_tenant_admin_read_v2" on public.appointment_payments
  for select using (
    private.has_role(array['admin'])
    and exists (
      select 1 from public.payments payment
      where payment.id = appointment_payments.payment_id
        and private.is_same_clinic(payment.clinic_id)
    )
  );

alter table public.appointment_charges enable row level security;
alter table public.appointment_charge_adjustments enable row level security;
alter table public.refunds enable row level security;
alter table public.refund_reversals enable row level security;
alter table public.payment_applications enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists "appointment_charges_tenant_admin_read_v2" on public.appointment_charges;
create policy "appointment_charges_tenant_admin_read_v2" on public.appointment_charges
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));
drop policy if exists "appointment_charge_adjustments_tenant_admin_read_v2" on public.appointment_charge_adjustments;
create policy "appointment_charge_adjustments_tenant_admin_read_v2" on public.appointment_charge_adjustments
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));
drop policy if exists "refunds_tenant_admin_read_v2" on public.refunds;
create policy "refunds_tenant_admin_read_v2" on public.refunds
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));
drop policy if exists "refund_reversals_tenant_admin_read_v2" on public.refund_reversals;
create policy "refund_reversals_tenant_admin_read_v2" on public.refund_reversals
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));
drop policy if exists "payment_applications_tenant_admin_read_v2" on public.payment_applications;
create policy "payment_applications_tenant_admin_read_v2" on public.payment_applications
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));
drop policy if exists "billing_events_tenant_admin_read_v2" on public.billing_events;
create policy "billing_events_tenant_admin_read_v2" on public.billing_events
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));

drop policy if exists "package_session_allocations_tenant_admin_access" on public.package_session_allocations;
drop policy if exists "package_session_allocations_admin_access" on public.package_session_allocations;
drop policy if exists "package_session_allocations_tenant_admin_read_v2" on public.package_session_allocations;
create policy "package_session_allocations_tenant_admin_read_v2" on public.package_session_allocations
  for select using (private.has_role(array['admin']) and private.is_same_clinic(clinic_id));

revoke all on public.appointment_charges from public, anon, authenticated;
revoke all on public.appointment_charge_adjustments from public, anon, authenticated;
revoke all on public.refunds from public, anon, authenticated;
revoke all on public.refund_reversals from public, anon, authenticated;
revoke all on public.payment_applications from public, anon, authenticated;
revoke all on public.package_session_allocations from public, anon, authenticated;
revoke all on public.billing_events from public, anon, authenticated;
revoke insert, update, delete on public.packages from authenticated;
revoke insert, update, delete on public.payments from authenticated;
revoke insert, update, delete on public.appointment_payments from authenticated;
grant select on public.packages to authenticated;
grant select on public.payments to authenticated;
grant select on public.appointment_payments to authenticated;
grant select on public.appointment_charges to authenticated;
grant select on public.appointment_charge_adjustments to authenticated;
grant select on public.refunds to authenticated;
grant select on public.refund_reversals to authenticated;
grant select on public.payment_applications to authenticated;
grant select on public.package_session_allocations to authenticated;
grant select on public.billing_events to authenticated;
grant all on public.appointment_charges to service_role;
grant all on public.appointment_charge_adjustments to service_role;
grant all on public.refunds to service_role;
grant all on public.refund_reversals to service_role;
grant all on public.payment_applications to service_role;
grant all on public.package_session_allocations to service_role;
grant all on public.billing_events to service_role;

create or replace function public.record_payment_v2(
  p_patient_id uuid,
  p_funding_scope text,
  p_package_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  target_clinic_id uuid;
  target_package_id uuid;
  new_payment_id uuid;
  linked_appointment_ids uuid[];
  remaining_credit numeric(12,2);
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to record payments.' using errcode = '42501';
  end if;
  perform private.lock_patient_billing_v2(p_patient_id);
  select clinic_id into target_clinic_id from public.patients where id = p_patient_id;
  if target_clinic_id is null or not private.is_same_clinic(target_clinic_id) then
    raise exception 'Selected patient does not belong to your clinic.' using errcode = '42501';
  end if;
  if p_funding_scope not in ('ordinary', 'package') then
    raise exception 'Funding scope must be ordinary or package.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = '22023';
  end if;
  if p_payment_method not in ('cash', 'upi', 'card', 'bank_transfer') then
    raise exception 'Choose a valid payment method.' using errcode = '22023';
  end if;
  if p_payment_date is null then
    raise exception 'Choose a payment date.' using errcode = '22023';
  end if;

  if p_funding_scope = 'ordinary' then
    if p_package_id is not null then
      raise exception 'Ordinary payments cannot reference a package.' using errcode = '22023';
    end if;
  else
    select id into target_package_id
    from public.packages
    where id = p_package_id
      and patient_id = p_patient_id
      and clinic_id = target_clinic_id
      and status <> 'cancelled'
    for update;
    if target_package_id is null then
      raise exception 'Selected package does not belong to the chosen patient.' using errcode = '22023';
    end if;
  end if;

  insert into public.payments (
    clinic_id, patient_id, package_id, amount, payment_method, date, notes,
    funding_scope, status, billing_version
  ) values (
    target_clinic_id, p_patient_id, case when p_funding_scope = 'package' then p_package_id else null end,
    p_amount, p_payment_method, p_payment_date, nullif(btrim(coalesce(p_notes, '')), ''),
    p_funding_scope, 'posted', 2
  ) returning id into new_payment_id;

  select coalesce(array_agg(charge.appointment_id order by appointment.date, appointment.time, appointment.id), array[]::uuid[])
  into linked_appointment_ids
  from public.payment_applications application
  join public.appointment_charges charge on charge.id = application.charge_id
  join public.appointments appointment on appointment.id = charge.appointment_id
  where application.payment_id = new_payment_id and application.status = 'active';

  select greatest(
    p_amount - coalesce(sum(application.amount) filter (where application.status = 'active'), 0), 0
  ) into remaining_credit
  from public.payment_applications application
  where application.payment_id = new_payment_id;

  return jsonb_build_object(
    'success', true,
    'paymentId', new_payment_id,
    'linkedAppointmentIds', coalesce(linked_appointment_ids, array[]::uuid[]),
    'remainingCredit', coalesce(remaining_credit, p_amount),
    'updatedPackageId', p_package_id
  );
exception when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
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
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  target_clinic_id uuid;
  valid_type_id uuid;
  new_package_id uuid;
  payment_result jsonb;
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to manage billing.' using errcode = '42501';
  end if;
  perform private.lock_patient_billing_v2(p_patient_id);
  select clinic_id into target_clinic_id from public.patients where id = p_patient_id;
  if target_clinic_id is null or not private.is_same_clinic(target_clinic_id) then
    raise exception 'Selected patient does not belong to your clinic.' using errcode = '42501';
  end if;
  if p_entry_kind not in ('payment_only', 'package_with_payment') then
    raise exception 'Unsupported billing entry type.' using errcode = '22023';
  end if;

  if p_entry_kind = 'payment_only' then
    return public.record_payment_v2(
      p_patient_id, 'ordinary', null, p_amount, p_payment_method, p_payment_date, p_notes
    );
  end if;

  if nullif(btrim(coalesce(p_package_name, '')), '') is null then
    raise exception 'Enter a package name.' using errcode = '22023';
  end if;
  if p_package_total_sessions is null or p_package_total_sessions <= 0 then
    raise exception 'Total sessions must be greater than zero.' using errcode = '22023';
  end if;
  if p_package_per_session_amount is null or p_package_per_session_amount <= 0 then
    raise exception 'Per-session charge must be greater than zero.' using errcode = '22023';
  end if;
  if p_package_starts_on is null then
    raise exception 'Choose a package start date.' using errcode = '22023';
  end if;
  select id into valid_type_id
  from public.appointment_types
  where id = p_appointment_type_id and clinic_id = target_clinic_id;
  if valid_type_id is null then
    raise exception 'Choose an appointment type from this clinic.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount collected for this package.' using errcode = '22023';
  end if;
  if p_payment_method not in ('cash', 'upi', 'card', 'bank_transfer') then
    raise exception 'Choose a valid payment method.' using errcode = '22023';
  end if;
  if p_payment_date is null then
    raise exception 'Choose a payment date.' using errcode = '22023';
  end if;

  insert into public.packages (
    clinic_id, patient_id, name, total_sessions, used_sessions, total_amount,
    per_session_amount, paid_amount, payment_timing, status,
    appointment_type_id, starts_on, billing_version
  ) values (
    target_clinic_id, p_patient_id, btrim(p_package_name), p_package_total_sessions, 0,
    p_package_total_sessions * p_package_per_session_amount, p_package_per_session_amount,
    0, 'prepaid', 'active', p_appointment_type_id, p_package_starts_on, 2
  ) returning id into new_package_id;

  payment_result := public.record_payment_v2(
    p_patient_id, 'package', new_package_id, p_amount, p_payment_method, p_payment_date, p_notes
  );
  if not coalesce((payment_result ->> 'success')::boolean, false) then
    raise exception '%', coalesce(payment_result ->> 'message', 'Unable to record package payment') using errcode = coalesce(payment_result ->> 'errorCode', 'P0001');
  end if;

  return payment_result || jsonb_build_object('packageId', new_package_id);
exception when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
end;
$$;

create or replace function public.record_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_refund_method text,
  p_refund_date date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  payment_row public.payments%rowtype;
  target_patient_id uuid;
  already_refunded numeric(12,2);
  new_refund_id uuid;
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to refund payments.' using errcode = '42501';
  end if;
  select patient_id into target_patient_id from public.payments where id = p_payment_id;
  if target_patient_id is null then raise exception 'Payment not found.' using errcode = '22023'; end if;
  perform private.lock_patient_billing_v2(target_patient_id);
  select * into payment_row from public.payments where id = p_payment_id for update;
  if payment_row.id is null then raise exception 'Payment not found.' using errcode = '22023'; end if;
  if not private.is_same_clinic(payment_row.clinic_id) then raise exception 'Payment does not belong to your clinic.' using errcode = '42501'; end if;
  if payment_row.status <> 'posted' then raise exception 'Only posted payments can be refunded.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Refund amount must be greater than zero.' using errcode = '22023'; end if;
  if p_refund_method not in ('cash', 'upi', 'card', 'bank_transfer') then raise exception 'Choose a valid refund method.' using errcode = '22023'; end if;
  if p_refund_date is null then raise exception 'Choose a refund date.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Refund reason is required.' using errcode = '22023'; end if;
  select coalesce(sum(refund.amount), 0) into already_refunded
  from public.refunds refund
  where refund.payment_id = p_payment_id
    and not exists (select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id);
  if already_refunded + p_amount > payment_row.amount then raise exception 'Refund exceeds the unrefunded payment amount.' using errcode = '22023'; end if;

  insert into public.refunds (
    clinic_id, patient_id, payment_id, amount, refund_method, refund_date, reason, created_by
  ) values (
    payment_row.clinic_id, payment_row.patient_id, payment_row.id, p_amount,
    p_refund_method, p_refund_date, btrim(p_reason), auth.uid()
  ) returning id into new_refund_id;

  insert into public.billing_events (
    clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details
  ) values (
    payment_row.clinic_id, payment_row.patient_id, 'payment_refunded', 'refund', new_refund_id,
    btrim(p_reason), auth.uid(), jsonb_build_object('paymentId', payment_row.id, 'amount', p_amount, 'method', p_refund_method, 'date', p_refund_date)
  );
  return jsonb_build_object('success', true, 'refundId', new_refund_id, 'paymentId', payment_row.id, 'patientId', payment_row.patient_id);
exception when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
end;
$$;

create or replace function public.record_refund(p_payment_id uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare payment_method text;
begin
  select p.payment_method into payment_method from public.payments p where p.id = p_payment_id;
  return public.record_refund(p_payment_id, p_amount, payment_method, current_date, p_reason);
end;
$$;

create or replace function private.trigger_reconcile_refund_reversal_v2()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare target_patient_id uuid;
begin
  select refund.patient_id into target_patient_id
  from public.refunds refund
  where refund.id = new.refund_id;
  if target_patient_id is not null and not private.try_lock_patient_billing_v2(target_patient_id) then
    raise exception 'Concurrent billing update; retry the transaction.' using errcode = '40001';
  end if;
  if target_patient_id is not null then perform private.reconcile_patient_billing_v2(target_patient_id); end if;
  return null;
end;
$$;

create trigger refund_reversals_reconcile_billing_v2
  after insert on public.refund_reversals
  for each row execute function private.trigger_reconcile_refund_reversal_v2();

create or replace function public.void_refund(p_refund_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  refund_row public.refunds%rowtype;
  target_patient_id uuid;
  new_reversal_id uuid;
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to reverse refunds.' using errcode = '42501';
  end if;
  select patient_id into target_patient_id from public.refunds where id = p_refund_id;
  if target_patient_id is null then raise exception 'Refund not found.' using errcode = '22023'; end if;
  perform private.lock_patient_billing_v2(target_patient_id);
  select * into refund_row from public.refunds where id = p_refund_id for update;
  if not private.is_same_clinic(refund_row.clinic_id) then
    raise exception 'Refund does not belong to your clinic.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Refund reversal reason is required.' using errcode = '22023';
  end if;
  if exists (select 1 from public.refund_reversals reversal where reversal.refund_id = refund_row.id) then
    raise exception 'Refund is already reversed.' using errcode = '22023';
  end if;

  insert into public.refund_reversals (
    clinic_id, patient_id, refund_id, reason, created_by
  ) values (
    refund_row.clinic_id, refund_row.patient_id, refund_row.id, btrim(p_reason), auth.uid()
  ) returning id into new_reversal_id;

  insert into public.billing_events (
    clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details
  ) values (
    refund_row.clinic_id, refund_row.patient_id, 'refund_reversed', 'refund', refund_row.id,
    btrim(p_reason), auth.uid(),
    jsonb_build_object('refundReversalId', new_reversal_id, 'paymentId', refund_row.payment_id, 'amount', refund_row.amount)
  );
  return jsonb_build_object(
    'success', true, 'refundId', refund_row.id, 'refundReversalId', new_reversal_id,
    'paymentId', refund_row.payment_id, 'patientId', refund_row.patient_id
  );
exception when unique_violation then
  return jsonb_build_object('success', false, 'errorCode', '23505', 'message', 'Refund is already reversed.');
when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
end;
$$;

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare payment_row public.payments%rowtype; target_patient_id uuid;
begin
  if not private.has_role(array['admin']) then raise exception 'You are not allowed to void payments.' using errcode = '42501'; end if;
  select patient_id into target_patient_id from public.payments where id = p_payment_id;
  if target_patient_id is null then raise exception 'Payment not found.' using errcode = '22023'; end if;
  perform private.lock_patient_billing_v2(target_patient_id);
  select * into payment_row from public.payments where id = p_payment_id for update;
  if payment_row.id is null then raise exception 'Payment not found.' using errcode = '22023'; end if;
  if not private.is_same_clinic(payment_row.clinic_id) then raise exception 'Payment does not belong to your clinic.' using errcode = '42501'; end if;
  if payment_row.status <> 'posted' then raise exception 'Payment is already voided.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Void reason is required.' using errcode = '22023'; end if;
  if exists (
    select 1 from public.refunds refund
    where refund.payment_id = payment_row.id
      and not exists (select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id)
  ) then
    raise exception 'A refunded payment cannot be voided; record a refund correction instead.' using errcode = '22023';
  end if;

  perform set_config('carebook.billing_payment_mutation_v2', 'on', true);
  update public.payments set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
  where id = p_payment_id;
  perform set_config('carebook.billing_payment_mutation_v2', 'off', true);
  insert into public.billing_events (clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details)
  values (payment_row.clinic_id, payment_row.patient_id, 'payment_voided', 'payment', payment_row.id, btrim(p_reason), auth.uid(), jsonb_build_object('amount', payment_row.amount));
  return jsonb_build_object('success', true, 'paymentId', payment_row.id, 'patientId', payment_row.patient_id);
exception when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
end;
$$;

create or replace function public.cancel_package(p_package_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare package_row public.packages%rowtype; target_patient_id uuid;
begin
  if not private.has_role(array['admin']) then raise exception 'You are not allowed to cancel packages.' using errcode = '42501'; end if;
  select patient_id into target_patient_id from public.packages where id = p_package_id;
  if target_patient_id is null then raise exception 'Package not found.' using errcode = '22023'; end if;
  perform private.lock_patient_billing_v2(target_patient_id);
  select * into package_row from public.packages where id = p_package_id for update;
  if package_row.id is null then raise exception 'Package not found.' using errcode = '22023'; end if;
  if not private.is_same_clinic(package_row.clinic_id) then raise exception 'Package does not belong to your clinic.' using errcode = '42501'; end if;
  if package_row.status = 'cancelled' then raise exception 'Package is already cancelled.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Cancellation reason is required.' using errcode = '22023'; end if;

  perform set_config('carebook.billing_package_mutation_v2', 'on', true);
  update public.packages
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason), completed_at = null
  where id = p_package_id;
  perform set_config('carebook.billing_package_mutation_v2', 'off', true);
  insert into public.billing_events (clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details)
  values (package_row.clinic_id, package_row.patient_id, 'package_cancelled', 'package', package_row.id, btrim(p_reason), auth.uid(), jsonb_build_object('previousStatus', package_row.status));
  return jsonb_build_object('success', true, 'packageId', package_row.id, 'patientId', package_row.patient_id);
exception when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
end;
$$;

create or replace function public.adjust_appointment_fee(p_appointment_id uuid, p_adjusted_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare appointment_row public.appointments%rowtype; charge_id uuid; adjustment_id uuid; target_patient_id uuid;
begin
  if not private.has_role(array['admin']) then raise exception 'You are not allowed to adjust appointment fees.' using errcode = '42501'; end if;
  select patient_id into target_patient_id from public.appointments where id = p_appointment_id;
  if target_patient_id is null then raise exception 'Appointment not found.' using errcode = '22023'; end if;
  perform private.lock_patient_billing_v2(target_patient_id);
  select * into appointment_row from public.appointments where id = p_appointment_id for update;
  if appointment_row.id is null then raise exception 'Appointment not found.' using errcode = '22023'; end if;
  if not private.is_same_clinic(appointment_row.clinic_id) then raise exception 'Appointment does not belong to your clinic.' using errcode = '42501'; end if;
  if appointment_row.status <> 'completed' then raise exception 'Only completed appointment fees require an audited adjustment.' using errcode = '22023'; end if;
  if p_adjusted_amount is null or p_adjusted_amount <= 0 then raise exception 'Adjusted fee must be greater than zero.' using errcode = '22023'; end if;
  if p_adjusted_amount = appointment_row.fee then raise exception 'Adjusted fee must differ from the current fee.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Adjustment reason is required.' using errcode = '22023'; end if;

  select id into charge_id from public.appointment_charges where appointment_id = appointment_row.id;
  insert into public.appointment_charge_adjustments (
    clinic_id, patient_id, appointment_id, appointment_reference_id, charge_id,
    previous_amount, adjusted_amount, reason, created_by
  ) values (
    appointment_row.clinic_id, appointment_row.patient_id, appointment_row.id, appointment_row.id, charge_id,
    coalesce(appointment_row.fee, 0), p_adjusted_amount, btrim(p_reason), auth.uid()
  ) returning id into adjustment_id;

  perform set_config('carebook.billing_fee_adjustment_v2', 'on', true);
  update public.appointments set fee = p_adjusted_amount where id = appointment_row.id;
  perform set_config('carebook.billing_fee_adjustment_v2', 'off', true);

  insert into public.billing_events (clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details)
  values (appointment_row.clinic_id, appointment_row.patient_id, 'appointment_fee_adjusted', 'appointment', appointment_row.id, btrim(p_reason), auth.uid(),
    jsonb_build_object('adjustmentId', adjustment_id, 'previousAmount', appointment_row.fee, 'adjustedAmount', p_adjusted_amount));
  return jsonb_build_object('success', true, 'adjustmentId', adjustment_id, 'appointmentId', appointment_row.id, 'patientId', appointment_row.patient_id);
exception when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
end;
$$;

-- Legacy callers remain functional during UI cutover, but destructive names now delegate
-- to audited state transitions and old payment APIs use the scoped v2 allocator.
create or replace function public.record_payment(
  p_patient_id uuid, p_package_id uuid, p_amount numeric, p_payment_method text,
  p_payment_date date, p_notes text
)
returns jsonb language sql security definer set search_path = public, private, pg_temp
as $$
  select public.record_payment_v2(
    p_patient_id, case when p_package_id is null then 'ordinary' else 'package' end,
    p_package_id, p_amount, p_payment_method, p_payment_date, p_notes
  );
$$;

create or replace function public.record_billing_entry(
  p_patient_id uuid, p_entry_kind text, p_package_name text,
  p_package_total_sessions integer, p_package_per_session_amount numeric,
  p_package_payment_timing text, p_amount numeric, p_payment_method text,
  p_payment_date date, p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare default_type_id uuid; target_clinic_id uuid;
begin
  select clinic_id into target_clinic_id from public.patients where id = p_patient_id;
  if p_entry_kind = 'package_with_payment' then
    if coalesce(p_package_payment_timing, 'prepaid') <> 'prepaid' then
      return jsonb_build_object('success', false, 'errorCode', '22023', 'message', 'Packages are prepaid only.');
    end if;
    select id into default_type_id from public.appointment_types
    where clinic_id = target_clinic_id and name = 'Clinic'
    order by is_default desc, sort_order, id limit 1;
  end if;
  return public.record_billing_entry_v2(
    p_patient_id, p_entry_kind, p_package_name, p_package_total_sessions,
    p_package_per_session_amount, default_type_id, p_payment_date,
    p_amount, p_payment_method, p_payment_date, p_notes
  );
end;
$$;

create or replace function public.delete_payment(p_payment_id uuid)
returns jsonb language sql security definer set search_path = public, private, pg_temp
as $$ select public.void_payment(p_payment_id, 'Legacy delete request converted to audited void'); $$;

create or replace function public.delete_package(p_package_id uuid)
returns jsonb language sql security definer set search_path = public, private, pg_temp
as $$ select public.cancel_package(p_package_id, 'Legacy delete request converted to audited cancellation'); $$;

-- Internal legacy allocation entrypoints must not revive the old pooled ledger. Keep their
-- signatures for migration/trigger compatibility, but delegate every rebuild to v2.
create or replace function private.assign_patient_package_sessions(target_patient_id uuid)
returns void language plpgsql security definer set search_path = public, private, pg_temp
as $$ begin
  perform private.lock_patient_billing_v2(target_patient_id);
  perform private.reconcile_patient_billing_v2(target_patient_id);
end; $$;

create or replace function private.allocate_patient_payment_credit(target_patient_id uuid)
returns void language plpgsql security definer set search_path = public, private, pg_temp
as $$ begin
  perform private.lock_patient_billing_v2(target_patient_id);
  perform private.reconcile_patient_billing_v2(target_patient_id);
end; $$;

create or replace function private.reconcile_package_usage(target_package_id uuid)
returns void language plpgsql security definer set search_path = public, private, pg_temp
as $$
declare target_patient_id uuid;
begin
  select patient_id into target_patient_id from public.packages where id = target_package_id;
  if target_patient_id is not null then
    perform private.lock_patient_billing_v2(target_patient_id);
    perform private.reconcile_patient_billing_v2(target_patient_id);
  end if;
end;
$$;

create or replace function public.assign_patient_package_sessions(target_patient_id uuid)
returns void language sql security definer set search_path = public, private, pg_temp
as $$ select private.reconcile_patient_billing_v2(target_patient_id); $$;

create or replace function public.allocate_patient_payment_credit(target_patient_id uuid)
returns void language sql security definer set search_path = public, private, pg_temp
as $$ select private.reconcile_patient_billing_v2(target_patient_id); $$;

create or replace function public.reconcile_package_usage(target_package_id uuid)
returns void language sql security definer set search_path = public, private, pg_temp
as $$ select private.reconcile_package_usage(target_package_id); $$;

-- Explicit function boundary: authenticated app users may call wrappers; anon/public may not.
revoke all on function public.record_billing_entry_v2(uuid, text, text, integer, numeric, uuid, date, numeric, text, date, text) from public, anon;
revoke all on function public.record_payment_v2(uuid, text, uuid, numeric, text, date, text) from public, anon;
revoke all on function public.record_refund(uuid, numeric, text, date, text) from public, anon;
revoke all on function public.record_refund(uuid, numeric, text) from public, anon;
revoke all on function public.void_refund(uuid, text) from public, anon;
revoke all on function public.void_payment(uuid, text) from public, anon;
revoke all on function public.cancel_package(uuid, text) from public, anon;
revoke all on function public.adjust_appointment_fee(uuid, numeric, text) from public, anon;
revoke all on function public.reconcile_patient_billing_v2(uuid) from public, anon;
revoke all on function public.preview_billing_allocation_v2(uuid) from public, anon;
revoke all on function public.record_payment(uuid, uuid, numeric, text, date, text) from public, anon;
revoke all on function public.record_billing_entry(uuid, text, text, integer, numeric, text, numeric, text, date, text) from public, anon;
revoke all on function public.delete_payment(uuid) from public, anon;
revoke all on function public.delete_package(uuid) from public, anon;

grant execute on function public.record_billing_entry_v2(uuid, text, text, integer, numeric, uuid, date, numeric, text, date, text) to authenticated;
grant execute on function public.record_payment_v2(uuid, text, uuid, numeric, text, date, text) to authenticated;
grant execute on function public.record_refund(uuid, numeric, text, date, text) to authenticated;
grant execute on function public.record_refund(uuid, numeric, text) to authenticated;
grant execute on function public.void_refund(uuid, text) to authenticated;
grant execute on function public.void_payment(uuid, text) to authenticated;
grant execute on function public.cancel_package(uuid, text) to authenticated;
grant execute on function public.adjust_appointment_fee(uuid, numeric, text) to authenticated;
grant execute on function public.reconcile_patient_billing_v2(uuid) to authenticated;
grant execute on function public.preview_billing_allocation_v2(uuid) to authenticated;
grant execute on function public.record_payment(uuid, uuid, numeric, text, date, text) to authenticated;
grant execute on function public.record_billing_entry(uuid, text, text, integer, numeric, text, numeric, text, date, text) to authenticated;
grant execute on function public.delete_payment(uuid) to authenticated;
grant execute on function public.delete_package(uuid) to authenticated;

revoke all on function private.reconcile_patient_billing_v2(uuid) from public, anon, authenticated;
revoke all on function private.trigger_reconcile_patient_billing_v2() from public, anon, authenticated;
revoke all on function private.trigger_reconcile_payment_refund_v2() from public, anon, authenticated;
revoke all on function private.trigger_reconcile_refund_reversal_v2() from public, anon, authenticated;
revoke all on function private.reject_billing_ledger_mutation() from public, anon, authenticated;
revoke all on function private.set_billing_appointment_reference_v2() from public, anon, authenticated;
revoke all on function private.guard_completed_appointment_fee_v2() from public, anon, authenticated;
revoke all on function private.preserve_deleted_appointment_billing_v2() from public, anon, authenticated;
revoke all on function private.guard_payment_rewrite_v2() from public, anon, authenticated;
revoke all on function private.guard_package_rewrite_v2() from public, anon, authenticated;
revoke all on function private.guard_payment_application_history_v2() from public, anon, authenticated;
revoke all on function private.guard_package_allocation_history_v2() from public, anon, authenticated;
revoke all on function private.billing_patient_lock_key_v2(uuid) from public, anon, authenticated;
revoke all on function private.lock_patient_billing_v2(uuid) from public, anon, authenticated;
revoke all on function private.try_lock_patient_billing_v2(uuid) from public, anon, authenticated;
revoke all on function private.assign_patient_package_sessions(uuid) from public, anon, authenticated;
revoke all on function private.allocate_patient_payment_credit(uuid) from public, anon, authenticated;
revoke all on function private.reconcile_package_usage(uuid) from public, anon, authenticated;
revoke all on function public.assign_patient_package_sessions(uuid) from public, anon, authenticated;
revoke all on function public.allocate_patient_payment_credit(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_package_usage(uuid) from public, anon, authenticated;

revoke all on public.package_billing_balances_v2 from public, anon;
revoke all on public.patient_billing_balances_v2 from public, anon;
grant select on public.package_billing_balances_v2 to authenticated;
grant select on public.patient_billing_balances_v2 to authenticated;

commit;
