-- NOTE: merged from former 009_remove_no_show_status.sql to give the local Supabase CLI a
-- unique migration version (it keys migrations by numeric prefix, so two 009_* files collide).
-- Statements below preserve the original apply order: no_show removal, then simplified billing.

-- ===== formerly 009_remove_no_show_status.sql =====
-- Convert all historical no_show appointments to cancelled, then tighten the CHECK constraint.

-- 1. Migrate existing data
update public.appointments
set status = 'cancelled'
where status = 'no_show';

-- 2. Replace the CHECK constraint to disallow no_show going forward
alter table public.appointments
  drop constraint if exists appointments_status_check;

alter table public.appointments
  add constraint appointments_status_check
    check (status in ('scheduled', 'completed', 'cancelled'));

-- ===== formerly 009_simplified_billing_credit_allocations.sql =====
-- Simplify billing entries by treating payments as patient credit and packages as
-- independent session entitlements.

create extension if not exists "pgcrypto";

alter table public.packages
  add column if not exists per_session_amount numeric(10,2);

update public.packages
set per_session_amount = case
  when total_sessions > 0 then round(total_amount / total_sessions, 2)
  else 0
end
where per_session_amount is null;

alter table public.packages
  alter column per_session_amount set default 0,
  alter column per_session_amount set not null;

alter table public.packages
  drop constraint if exists packages_per_session_amount_nonnegative;

alter table public.packages
  add constraint packages_per_session_amount_nonnegative check (per_session_amount >= 0);

alter table public.appointment_payments
  add column if not exists amount_applied numeric(10,2) not null default 0;

update public.appointment_payments appointment_payment_row
set amount_applied = coalesce(appointment_row.fee, 0)
from public.appointments appointment_row
where appointment_row.id = appointment_payment_row.appointment_id
  and appointment_payment_row.amount_applied = 0;

alter table public.appointment_payments
  drop constraint if exists appointment_payments_amount_applied_nonnegative;

alter table public.appointment_payments
  add constraint appointment_payments_amount_applied_nonnegative check (amount_applied >= 0);

create unique index if not exists appointment_payments_one_payment_per_appointment_idx
  on public.appointment_payments (appointment_id);

create table if not exists public.package_session_allocations (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (package_id, appointment_id),
  unique (appointment_id)
);

alter table public.package_session_allocations enable row level security;

drop policy if exists "package_session_allocations_admin_access" on public.package_session_allocations;

create policy "package_session_allocations_admin_access" on public.package_session_allocations
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));

create index if not exists idx_package_session_allocations_package_id
  on public.package_session_allocations(package_id);

create index if not exists idx_package_session_allocations_appointment_id
  on public.package_session_allocations(appointment_id);

create or replace function public.reconcile_package_usage(target_package_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.packages package_row
  set used_sessions = coalesce(usage_counts.used_sessions, 0)
  from (
    select
      package_row.id as package_id,
      count(distinct appointment_row.id)::integer as used_sessions
    from public.packages package_row
    left join public.package_session_allocations package_session_row
      on package_session_row.package_id = package_row.id
    left join public.appointments appointment_row
      on appointment_row.id = package_session_row.appointment_id
      and appointment_row.status in ('scheduled', 'completed')
    where package_row.id = target_package_id
    group by package_row.id
  ) as usage_counts
  where package_row.id = usage_counts.package_id;
$$;

create or replace function public.assign_patient_package_sessions(target_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  package_row record;
  appointment_row record;
  remaining_slots integer;
begin
  delete from public.package_session_allocations allocation_row
  using public.appointments appointment_row
  where appointment_row.id = allocation_row.appointment_id
    and appointment_row.patient_id = target_patient_id
    and appointment_row.status not in ('scheduled', 'completed');

  for package_row in
    select *
    from public.packages
    where patient_id = target_patient_id
      and status = 'active'
    order by created_at, id
  loop
    perform public.reconcile_package_usage(package_row.id);

    select greatest(package_row.total_sessions - count(appointment_row.id)::integer, 0)
    into remaining_slots
    from public.package_session_allocations allocation_row
    join public.appointments appointment_row
      on appointment_row.id = allocation_row.appointment_id
    where allocation_row.package_id = package_row.id
      and appointment_row.status in ('scheduled', 'completed');

    if remaining_slots <= 0 then
      continue;
    end if;

    for appointment_row in
      select appointment_row.*
      from public.appointments appointment_row
      where appointment_row.patient_id = target_patient_id
        and appointment_row.status in ('completed', 'scheduled')
        and coalesce(appointment_row.fee, 0) > 0
        and not exists (
          select 1
          from public.package_session_allocations existing_allocation
          where existing_allocation.appointment_id = appointment_row.id
        )
      order by appointment_row.date, appointment_row.time, appointment_row.id
      limit remaining_slots
    loop
      insert into public.package_session_allocations (package_id, appointment_id)
      values (package_row.id, appointment_row.id)
      on conflict (appointment_id) do nothing;
    end loop;

    perform public.reconcile_package_usage(package_row.id);
  end loop;
end;
$$;

create or replace function public.allocate_patient_payment_credit(target_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row record;
  appointment_row record;
  remaining_amount numeric(10,2);
  inserted_count integer;
  today_ist date := timezone('Asia/Kolkata', now())::date;
begin
  for payment_row in
    select
      payment_row.*,
      payment_row.amount - coalesce(sum(appointment_payment_row.amount_applied), 0) as available_credit
    from public.payments payment_row
    left join public.appointment_payments appointment_payment_row
      on appointment_payment_row.payment_id = payment_row.id
    where payment_row.patient_id = target_patient_id
    group by payment_row.id
    order by payment_row.date, payment_row.created_at, payment_row.id
  loop
    remaining_amount := coalesce(payment_row.available_credit, 0);

    if remaining_amount <= 0 then
      continue;
    end if;

    for appointment_row in
      select appointment_row.*
      from public.appointments appointment_row
      where appointment_row.patient_id = target_patient_id
        and appointment_row.status = 'completed'
        and appointment_row.payment_status = 'unpaid'
        and coalesce(appointment_row.fee, 0) > 0
      order by appointment_row.date, appointment_row.time, appointment_row.id
    loop
      if coalesce(appointment_row.fee, 0) > remaining_amount then
        exit;
      end if;

      insert into public.appointment_payments (payment_id, appointment_id, amount_applied)
      values (payment_row.id, appointment_row.id, appointment_row.fee)
      on conflict (appointment_id) do nothing;

      get diagnostics inserted_count = row_count;

      if inserted_count > 0 then
        update public.appointments
        set payment_status = 'paid'
        where id = appointment_row.id;

        remaining_amount := remaining_amount - appointment_row.fee;
      end if;
    end loop;

    for appointment_row in
      select appointment_row.*
      from public.appointments appointment_row
      where appointment_row.patient_id = target_patient_id
        and appointment_row.status = 'scheduled'
        and appointment_row.date >= today_ist
        and appointment_row.payment_status = 'unpaid'
        and coalesce(appointment_row.fee, 0) > 0
      order by appointment_row.date, appointment_row.time, appointment_row.id
    loop
      if coalesce(appointment_row.fee, 0) > remaining_amount then
        exit;
      end if;

      insert into public.appointment_payments (payment_id, appointment_id, amount_applied)
      values (payment_row.id, appointment_row.id, appointment_row.fee)
      on conflict (appointment_id) do nothing;

      get diagnostics inserted_count = row_count;

      if inserted_count > 0 then
        update public.appointments
        set payment_status = 'prepaid'
        where id = appointment_row.id;

        remaining_amount := remaining_amount - appointment_row.fee;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.sync_patient_billing_allocations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_patient_id uuid;
begin
  if tg_op = 'DELETE' then
    target_patient_id := old.patient_id;
  else
    target_patient_id := new.patient_id;
  end if;

  if target_patient_id is null then
    return null;
  end if;

  perform public.assign_patient_package_sessions(target_patient_id);
  perform public.allocate_patient_payment_credit(target_patient_id);

  return null;
end;
$$;

drop trigger if exists appointments_sync_patient_billing_allocations on public.appointments;
create trigger appointments_sync_patient_billing_allocations
  after insert or update of patient_id, status, date, time, fee on public.appointments
  for each row execute function public.sync_patient_billing_allocations();

drop trigger if exists packages_sync_patient_billing_allocations on public.packages;
create trigger packages_sync_patient_billing_allocations
  after insert or update of patient_id, status, total_sessions on public.packages
  for each row execute function public.sync_patient_billing_allocations();

drop trigger if exists payments_sync_patient_billing_allocations on public.payments;
create trigger payments_sync_patient_billing_allocations
  after insert or update of patient_id, amount on public.payments
  for each row execute function public.sync_patient_billing_allocations();

create or replace function public.record_payment(
  p_patient_id uuid,
  p_package_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_notes text,
  p_payment_timing text,
  p_appointment_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  package_paid_amount numeric(10,2);
  package_total_amount numeric(10,2);
  new_payment_id uuid;
  linked_appointment_ids uuid[] := array[]::uuid[];
begin
  if not public.has_role(array['admin']) then
    raise exception 'You are not allowed to record payments.' using errcode = '42501';
  end if;

  if p_payment_timing not in ('prepaid', 'postpaid') then
    raise exception 'Unsupported payment timing.' using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_payment_method, '')), '') is null then
    raise exception 'Choose a payment method.' using errcode = '22023';
  end if;

  if p_payment_date is null then
    raise exception 'Choose a payment date.' using errcode = '22023';
  end if;

  if p_package_id is not null then
    select paid_amount, total_amount
    into package_paid_amount, package_total_amount
    from public.packages
    where id = p_package_id
      and patient_id = p_patient_id
    for update;

    if package_paid_amount is null then
      raise exception 'Selected package does not belong to the chosen patient.' using errcode = '22023';
    end if;

    if package_paid_amount + p_amount > package_total_amount then
      raise exception 'Payment exceeds the remaining package balance.' using errcode = '22023';
    end if;
  end if;

  insert into public.payments (
    patient_id,
    package_id,
    amount,
    payment_method,
    date,
    notes
  )
  values (
    p_patient_id,
    p_package_id,
    p_amount,
    p_payment_method,
    p_payment_date,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into new_payment_id;

  if p_package_id is not null then
    update public.packages
    set paid_amount = paid_amount + p_amount
    where id = p_package_id;
  end if;

  perform public.allocate_patient_payment_credit(p_patient_id);

  select coalesce(array_agg(appointment_payment_row.appointment_id order by appointment_row.date, appointment_row.time), array[]::uuid[])
  into linked_appointment_ids
  from public.appointment_payments appointment_payment_row
  join public.appointments appointment_row
    on appointment_row.id = appointment_payment_row.appointment_id
  where appointment_payment_row.payment_id = new_payment_id;

  return jsonb_build_object(
    'success', true,
    'paymentId', new_payment_id,
    'linkedAppointmentIds', linked_appointment_ids,
    'updatedPackageId', p_package_id
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'errorCode', SQLSTATE,
      'message', SQLERRM
    );
end;
$$;

create or replace function public.record_billing_entry(
  p_patient_id uuid,
  p_entry_kind text,
  p_package_name text,
  p_package_total_sessions integer,
  p_package_per_session_amount numeric,
  p_package_payment_timing text,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_notes text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized_amount numeric(10,2) := coalesce(p_amount, 0);
  package_total_amount numeric(10,2);
  new_package_id uuid;
  new_payment_id uuid;
  linked_appointment_ids uuid[] := array[]::uuid[];
  remaining_credit numeric(10,2) := 0;
begin
  if not public.has_role(array['admin']) then
    raise exception 'You are not allowed to manage billing.' using errcode = '42501';
  end if;

  if p_entry_kind not in ('payment_only', 'package_with_payment') then
    raise exception 'Unsupported billing entry type.' using errcode = '22023';
  end if;

  if p_entry_kind = 'payment_only' and normalized_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = '22023';
  end if;

  if p_entry_kind = 'package_with_payment' then
    if nullif(trim(coalesce(p_package_name, '')), '') is null then
      raise exception 'Enter a package name.' using errcode = '22023';
    end if;

    if p_package_payment_timing not in ('prepaid', 'postpaid') then
      raise exception 'Unsupported package billing style.' using errcode = '22023';
    end if;

    if p_package_total_sessions is null or p_package_total_sessions <= 0 then
      raise exception 'Total sessions must be greater than zero.' using errcode = '22023';
    end if;

    if p_package_per_session_amount is null or p_package_per_session_amount < 0 then
      raise exception 'Per-session charge cannot be negative.' using errcode = '22023';
    end if;

    package_total_amount := p_package_total_sessions * p_package_per_session_amount;

    if p_package_payment_timing = 'prepaid' and normalized_amount <= 0 then
      raise exception 'Enter the amount collected for this prepaid package.' using errcode = '22023';
    end if;

    if normalized_amount > package_total_amount then
      raise exception 'Payment exceeds the package total.' using errcode = '22023';
    end if;

    insert into public.packages (
      patient_id,
      name,
      total_sessions,
      total_amount,
      per_session_amount,
      payment_timing
    )
    values (
      p_patient_id,
      trim(p_package_name),
      p_package_total_sessions,
      package_total_amount,
      p_package_per_session_amount,
      p_package_payment_timing
    )
    returning id into new_package_id;

    perform public.assign_patient_package_sessions(p_patient_id);
  end if;

  if normalized_amount > 0 then
    if nullif(trim(coalesce(p_payment_method, '')), '') is null then
      raise exception 'Choose a payment method.' using errcode = '22023';
    end if;

    if p_payment_date is null then
      raise exception 'Choose a payment date.' using errcode = '22023';
    end if;

    insert into public.payments (
      patient_id,
      package_id,
      amount,
      payment_method,
      date,
      notes
    )
    values (
      p_patient_id,
      new_package_id,
      normalized_amount,
      p_payment_method,
      p_payment_date,
      nullif(trim(coalesce(p_notes, '')), '')
    )
    returning id into new_payment_id;

    if new_package_id is not null then
      update public.packages
      set paid_amount = paid_amount + normalized_amount
      where id = new_package_id;
    end if;

    perform public.allocate_patient_payment_credit(p_patient_id);

    select
      coalesce(array_agg(appointment_payment_row.appointment_id order by appointment_row.date, appointment_row.time), array[]::uuid[]),
      greatest(normalized_amount - coalesce(sum(appointment_payment_row.amount_applied), 0), 0)
    into linked_appointment_ids, remaining_credit
    from public.appointment_payments appointment_payment_row
    join public.appointments appointment_row
      on appointment_row.id = appointment_payment_row.appointment_id
    where appointment_payment_row.payment_id = new_payment_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'packageId', new_package_id,
    'paymentId', new_payment_id,
    'linkedAppointmentIds', linked_appointment_ids,
    'remainingCredit', remaining_credit
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'errorCode', SQLSTATE,
      'message', SQLERRM
    );
end;
$$;

grant execute on function public.assign_patient_package_sessions(uuid) to authenticated;
grant execute on function public.allocate_patient_payment_credit(uuid) to authenticated;
grant execute on function public.record_payment(uuid, uuid, numeric, text, date, text, text, uuid[]) to authenticated;
grant execute on function public.record_billing_entry(uuid, text, text, integer, numeric, text, numeric, text, date, text) to authenticated;
