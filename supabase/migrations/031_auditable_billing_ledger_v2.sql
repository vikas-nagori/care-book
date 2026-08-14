-- Auditable, scoped billing ledger. V2 is additive: legacy RPC signatures and columns remain.

create extension if not exists "pgcrypto";

-- Stop the legacy allocators before introducing the single v2 reconciler.
drop trigger if exists appointments_sync_patient_billing_allocations on public.appointments;
drop trigger if exists packages_sync_patient_billing_allocations on public.packages;
drop trigger if exists payments_sync_patient_billing_allocations on public.payments;
drop trigger if exists appointments_untally_cancelled_billing on public.appointments;

alter table public.appointments drop constraint if exists appointments_payment_status_check;
alter table public.appointments
  add constraint appointments_payment_status_check
  check (payment_status in ('unpaid', 'prepaid', 'partially_prepaid', 'paid', 'partially_paid'));

alter table public.packages
  add column if not exists appointment_type_id uuid references public.appointment_types(id) on delete restrict,
  add column if not exists starts_on date,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text,
  add column if not exists billing_version smallint not null default 1;

alter table public.packages drop constraint if exists packages_v2_required_fields;
alter table public.packages add constraint packages_v2_required_fields
  check (billing_version < 2 or (appointment_type_id is not null and starts_on is not null));
alter table public.packages drop constraint if exists packages_cancellation_audit;
alter table public.packages add constraint packages_cancellation_audit
  check (status <> 'cancelled' or billing_version < 2 or (
    cancelled_at is not null and cancelled_by is not null and nullif(btrim(cancellation_reason), '') is not null
  ));

alter table public.payments
  add column if not exists funding_scope text,
  add column if not exists status text not null default 'posted',
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text,
  add column if not exists billing_version smallint not null default 1;

update public.payments
set funding_scope = case when package_id is null then 'ordinary' else 'package' end
where funding_scope is null;
alter table public.payments alter column funding_scope set default 'ordinary';
alter table public.payments alter column funding_scope set not null;
alter table public.payments drop constraint if exists payments_funding_scope_check;
alter table public.payments add constraint payments_funding_scope_check
  check (funding_scope in ('ordinary', 'package'));
alter table public.payments drop constraint if exists payments_scope_package_check;
alter table public.payments add constraint payments_scope_package_check
  check ((funding_scope = 'ordinary' and package_id is null) or (funding_scope = 'package' and package_id is not null));
alter table public.payments drop constraint if exists payments_ledger_status_check;
alter table public.payments add constraint payments_ledger_status_check check (status in ('posted', 'voided'));
alter table public.payments drop constraint if exists payments_void_audit_check;
alter table public.payments add constraint payments_void_audit_check
  check (status <> 'voided' or (voided_at is not null and voided_by is not null and nullif(btrim(void_reason), '') is not null));

create table public.appointment_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete restrict unique,
  amount numeric(10,2) not null check (amount >= 0),
  status text not null check (status in ('pending', 'posted', 'voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointment_charge_adjustments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  charge_id uuid not null references public.appointment_charges(id) on delete restrict,
  previous_amount numeric(10,2) not null check (previous_amount >= 0),
  adjusted_amount numeric(10,2) not null check (adjusted_amount > 0),
  reason text not null check (nullif(btrim(reason), '') is not null),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  reason text not null check (nullif(btrim(reason), '') is not null),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.payment_applications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  charge_id uuid not null references public.appointment_charges(id) on delete restrict,
  funding_scope text not null check (funding_scope in ('ordinary', 'package')),
  package_id uuid references public.packages(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'active' check (status in ('active', 'reversed')),
  applied_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversal_reason text,
  check ((funding_scope = 'ordinary' and package_id is null) or (funding_scope = 'package' and package_id is not null)),
  check (status <> 'reversed' or (reversed_at is not null and nullif(btrim(reversal_reason), '') is not null))
);

alter table public.package_session_allocations
  add column if not exists clinic_id uuid references public.clinics(id) on delete restrict,
  add column if not exists patient_id uuid references public.patients(id) on delete restrict,
  add column if not exists lifecycle text,
  add column if not exists released_at timestamptz,
  add column if not exists release_reason text;

update public.package_session_allocations allocation
set clinic_id = package_row.clinic_id,
    patient_id = package_row.patient_id,
    lifecycle = case when appointment_row.status = 'completed' then 'availed' else 'scheduled' end
from public.packages package_row, public.appointments appointment_row
where allocation.package_id = package_row.id
  and allocation.appointment_id = appointment_row.id
  and (allocation.clinic_id is null or allocation.patient_id is null or allocation.lifecycle is null);

alter table public.package_session_allocations alter column clinic_id set not null;
alter table public.package_session_allocations alter column patient_id set not null;
alter table public.package_session_allocations alter column lifecycle set not null;
alter table public.package_session_allocations drop constraint if exists package_session_allocations_lifecycle_check;
alter table public.package_session_allocations add constraint package_session_allocations_lifecycle_check
  check (lifecycle in ('scheduled', 'availed', 'released'));
alter table public.package_session_allocations drop constraint if exists package_session_allocations_package_id_appointment_id_key;
alter table public.package_session_allocations drop constraint if exists package_session_allocations_appointment_id_key;

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  reason text,
  actor_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index package_session_allocations_one_active_appointment_v2_idx
  on public.package_session_allocations (appointment_id) where lifecycle <> 'released';
create index package_session_allocations_patient_v2_idx
  on public.package_session_allocations (patient_id, lifecycle);
create unique index payment_applications_one_active_pair_v2_idx
  on public.payment_applications (payment_id, charge_id) where status = 'active';
create index payment_applications_patient_v2_idx on public.payment_applications (patient_id, status);
create index appointment_charges_patient_v2_idx on public.appointment_charges (patient_id, status);
create index refunds_payment_v2_idx on public.refunds (payment_id);
create index billing_events_patient_v2_idx on public.billing_events (patient_id, created_at, id);

-- Immutable audit rows may only be appended by RPCs. Ledger applications/allocations are
-- reversible by state transition, never deleted.
create or replace function private.reject_billing_ledger_mutation()
returns trigger language plpgsql set search_path = public, private as $$
begin
  raise exception 'Billing audit rows are immutable.' using errcode = '55000';
end;
$$;

create trigger appointment_charge_adjustments_immutable
  before update or delete on public.appointment_charge_adjustments
  for each row execute function private.reject_billing_ledger_mutation();
create trigger refunds_immutable
  before update or delete on public.refunds
  for each row execute function private.reject_billing_ledger_mutation();
create trigger billing_events_immutable
  before update or delete on public.billing_events
  for each row execute function private.reject_billing_ledger_mutation();
create trigger payment_applications_no_delete
  before delete on public.payment_applications
  for each row execute function private.reject_billing_ledger_mutation();
create trigger package_session_allocations_no_delete
  before delete on public.package_session_allocations
  for each row execute function private.reject_billing_ledger_mutation();

create or replace function private.reconcile_patient_billing_v2(target_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  target_clinic_id uuid;
  package_row record;
  appointment_row record;
  payment_row record;
  charge_row record;
  remaining_sessions integer;
  remaining_payment numeric(12,2);
  remaining_charge numeric(12,2);
  draw_amount numeric(12,2);
begin
  select patient.clinic_id
  into target_clinic_id
  from public.patients patient
  where patient.id = target_patient_id
  for update;

  if target_clinic_id is null then
    raise exception 'Patient not found.' using errcode = '22023';
  end if;

  if current_setting('carebook.billing_reconcile_v2', true) = 'on' then
    return;
  end if;
  perform set_config('carebook.billing_reconcile_v2', 'on', true);

  insert into public.appointment_charges (
    clinic_id, patient_id, appointment_id, amount, status
  )
  select
    appointment.clinic_id,
    appointment.patient_id,
    appointment.id,
    coalesce(appointment.fee, 0),
    case appointment.status
      when 'scheduled' then 'pending'
      when 'completed' then 'posted'
      else 'voided'
    end
  from public.appointments appointment
  where appointment.patient_id = target_patient_id
  on conflict (appointment_id) do update
  set clinic_id = excluded.clinic_id,
      patient_id = excluded.patient_id,
      amount = excluded.amount,
      status = excluded.status,
      updated_at = case
        when appointment_charges.amount is distinct from excluded.amount
          or appointment_charges.status is distinct from excluded.status
        then now()
        else appointment_charges.updated_at
      end;

  create temporary table if not exists desired_package_allocations_v2 (
    package_id uuid not null,
    appointment_id uuid primary key,
    lifecycle text not null
  ) on commit drop;
  truncate desired_package_allocations_v2;

  for package_row in
    select package.*
    from public.packages package
    where package.patient_id = target_patient_id
      and package.clinic_id = target_clinic_id
      and package.status in ('active', 'completed')
      and package.appointment_type_id is not null
      and package.starts_on is not null
    order by package.created_at, package.id
  loop
    select greatest(
      package_row.total_sessions - count(*)::integer,
      0
    )
    into remaining_sessions
    from desired_package_allocations_v2 desired
    where desired.package_id = package_row.id;

    if remaining_sessions = 0 then
      continue;
    end if;

    for appointment_row in
      select appointment.id, appointment.status
      from public.appointments appointment
      join public.appointment_charges charge on charge.appointment_id = appointment.id
      where appointment.patient_id = target_patient_id
        and appointment.clinic_id = target_clinic_id
        and appointment.status in ('scheduled', 'completed')
        and charge.status in ('pending', 'posted')
        and charge.amount > 0
        and appointment.appointment_type_id = package_row.appointment_type_id
        and appointment.date >= package_row.starts_on
        and not exists (
          select 1 from desired_package_allocations_v2 desired
          where desired.appointment_id = appointment.id
        )
        and not exists (
          select 1
          from public.payment_applications application
          join public.payments payment on payment.id = application.payment_id
          where application.charge_id = charge.id
            and application.status = 'active'
            and application.funding_scope = 'ordinary'
            and payment.status = 'posted'
            and payment.amount > coalesce((
              select sum(refund.amount) from public.refunds refund where refund.payment_id = payment.id
            ), 0)
        )
      order by appointment.date, appointment.time, appointment.id
      limit remaining_sessions
    loop
      insert into desired_package_allocations_v2 (package_id, appointment_id, lifecycle)
      values (
        package_row.id,
        appointment_row.id,
        case when appointment_row.status = 'completed' then 'availed' else 'scheduled' end
      );
    end loop;
  end loop;

  update public.package_session_allocations allocation
  set lifecycle = 'released',
      released_at = now(),
      release_reason = 'reconciled: appointment or package eligibility changed'
  where allocation.patient_id = target_patient_id
    and allocation.lifecycle <> 'released'
    and not exists (
      select 1
      from desired_package_allocations_v2 desired
      where desired.package_id = allocation.package_id
        and desired.appointment_id = allocation.appointment_id
        and desired.lifecycle = allocation.lifecycle
    );

  insert into public.package_session_allocations (
    clinic_id, patient_id, package_id, appointment_id, lifecycle
  )
  select target_clinic_id, target_patient_id, desired.package_id, desired.appointment_id, desired.lifecycle
  from desired_package_allocations_v2 desired
  where not exists (
    select 1
    from public.package_session_allocations allocation
    where allocation.package_id = desired.package_id
      and allocation.appointment_id = desired.appointment_id
      and allocation.lifecycle = desired.lifecycle
      and allocation.lifecycle <> 'released'
  );

  create temporary table if not exists desired_payment_applications_v2 (
    payment_id uuid not null,
    charge_id uuid not null,
    funding_scope text not null,
    package_id uuid,
    amount numeric(10,2) not null,
    primary key (payment_id, charge_id)
  ) on commit drop;
  truncate desired_payment_applications_v2;

  for payment_row in
    select
      payment.*,
      greatest(payment.amount - coalesce(sum(refund.amount), 0), 0)::numeric(12,2) as net_amount
    from public.payments payment
    left join public.refunds refund on refund.payment_id = payment.id
    where payment.patient_id = target_patient_id
      and payment.clinic_id = target_clinic_id
      and payment.status = 'posted'
    group by payment.id
    having greatest(payment.amount - coalesce(sum(refund.amount), 0), 0) > 0
    order by payment.date, payment.created_at, payment.id
  loop
    remaining_payment := payment_row.net_amount;

    for charge_row in
      select charge.id
      from public.appointment_charges charge
      join public.appointments appointment on appointment.id = charge.appointment_id
      where charge.patient_id = target_patient_id
        and charge.status in ('pending', 'posted')
        and charge.amount > 0
        and (
          (
            payment_row.funding_scope = 'ordinary'
            and not exists (
              select 1 from desired_package_allocations_v2 allocation
              where allocation.appointment_id = appointment.id
            )
          )
          or (
            payment_row.funding_scope = 'package'
            and exists (
              select 1 from desired_package_allocations_v2 allocation
              where allocation.appointment_id = appointment.id
                and allocation.package_id = payment_row.package_id
            )
          )
        )
      order by appointment.date, appointment.time, appointment.id
    loop
      exit when remaining_payment <= 0;

      select greatest(charge.amount - coalesce(sum(desired.amount), 0), 0)
      into remaining_charge
      from public.appointment_charges charge
      left join desired_payment_applications_v2 desired on desired.charge_id = charge.id
      where charge.id = charge_row.id
      group by charge.amount;

      if remaining_charge <= 0 then
        continue;
      end if;

      draw_amount := least(remaining_payment, remaining_charge);
      insert into desired_payment_applications_v2 (
        payment_id, charge_id, funding_scope, package_id, amount
      ) values (
        payment_row.id,
        charge_row.id,
        payment_row.funding_scope,
        payment_row.package_id,
        draw_amount
      );
      remaining_payment := remaining_payment - draw_amount;
    end loop;
  end loop;

  update public.payment_applications application
  set status = 'reversed',
      reversed_at = now(),
      reversal_reason = 'reconciled: funding or charge eligibility changed'
  where application.patient_id = target_patient_id
    and application.status = 'active'
    and not exists (
      select 1
      from desired_payment_applications_v2 desired
      where desired.payment_id = application.payment_id
        and desired.charge_id = application.charge_id
        and desired.funding_scope = application.funding_scope
        and desired.package_id is not distinct from application.package_id
        and desired.amount = application.amount
    );

  insert into public.payment_applications (
    clinic_id, patient_id, payment_id, charge_id, funding_scope, package_id, amount
  )
  select
    target_clinic_id,
    target_patient_id,
    desired.payment_id,
    desired.charge_id,
    desired.funding_scope,
    desired.package_id,
    desired.amount
  from desired_payment_applications_v2 desired
  where not exists (
    select 1
    from public.payment_applications application
    where application.payment_id = desired.payment_id
      and application.charge_id = desired.charge_id
      and application.status = 'active'
      and application.amount = desired.amount
      and application.funding_scope = desired.funding_scope
      and application.package_id is not distinct from desired.package_id
  );

  update public.appointments appointment
  set payment_status = coalesce(status_summary.payment_status, 'unpaid')
  from (
    select
      charge.appointment_id,
      case
        when coalesce(sum(application.amount) filter (where application.funding_scope = 'package'), 0) >= charge.amount
          and charge.amount > 0 then 'prepaid'
        when coalesce(sum(application.amount) filter (where application.funding_scope = 'package'), 0) > 0
          then 'partially_prepaid'
        when coalesce(sum(application.amount) filter (where application.funding_scope = 'ordinary'), 0) >= charge.amount
          and charge.amount > 0 then 'paid'
        when coalesce(sum(application.amount) filter (where application.funding_scope = 'ordinary'), 0) > 0
          then 'partially_paid'
        else 'unpaid'
      end as payment_status
    from public.appointment_charges charge
    left join public.payment_applications application
      on application.charge_id = charge.id and application.status = 'active'
    where charge.patient_id = target_patient_id
    group by charge.id
  ) status_summary
  where appointment.id = status_summary.appointment_id
    and appointment.payment_status is distinct from status_summary.payment_status;

  update public.packages package
  set used_sessions = counts.availed_sessions,
      status = case
        when counts.availed_sessions = package.total_sessions then 'completed'
        else 'active'
      end,
      completed_at = case
        when counts.availed_sessions = package.total_sessions then coalesce(package.completed_at, now())
        else null
      end,
      paid_amount = least(counts.net_received, package.total_amount)
  from (
    select
      package.id as package_id,
      count(allocation.appointment_id) filter (where allocation.lifecycle = 'availed')::integer as availed_sessions,
      coalesce((
        select sum(greatest(payment.amount - coalesce(refunded.amount, 0), 0))
        from public.payments payment
        left join (
          select refund.payment_id, sum(refund.amount) as amount
          from public.refunds refund group by refund.payment_id
        ) refunded on refunded.payment_id = payment.id
        where payment.package_id = package.id and payment.status = 'posted'
      ), 0) as net_received
    from public.packages package
    left join public.package_session_allocations allocation
      on allocation.package_id = package.id and allocation.lifecycle <> 'released'
    where package.patient_id = target_patient_id and package.status <> 'cancelled'
    group by package.id
  ) counts
  where package.id = counts.package_id
    and (
      package.used_sessions is distinct from counts.availed_sessions
      or package.status is distinct from case when counts.availed_sessions = package.total_sessions then 'completed' else 'active' end
      or package.paid_amount is distinct from least(counts.net_received, package.total_amount)
    );

  perform set_config('carebook.billing_reconcile_v2', 'off', true);
end;
$$;

create or replace function private.trigger_reconcile_patient_billing_v2()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  old_patient_id uuid;
  new_patient_id uuid;
begin
  if current_setting('carebook.billing_reconcile_v2', true) = 'on' then return null; end if;
  if tg_op <> 'INSERT' then old_patient_id := old.patient_id; end if;
  if tg_op <> 'DELETE' then new_patient_id := new.patient_id; end if;
  if old_patient_id is not null then perform private.reconcile_patient_billing_v2(old_patient_id); end if;
  if new_patient_id is not null and new_patient_id is distinct from old_patient_id then
    perform private.reconcile_patient_billing_v2(new_patient_id);
  end if;
  return null;
end;
$$;

create or replace function private.trigger_reconcile_payment_refund_v2()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare target_patient_id uuid;
begin
  if current_setting('carebook.billing_reconcile_v2', true) = 'on' then return null; end if;
  select patient_id into target_patient_id
  from public.payments where id = coalesce(new.payment_id, old.payment_id);
  if target_patient_id is not null then perform private.reconcile_patient_billing_v2(target_patient_id); end if;
  return null;
end;
$$;

create trigger appointments_reconcile_billing_v2
  after insert or update of patient_id, status, date, time, fee, appointment_type_id
  on public.appointments for each row execute function private.trigger_reconcile_patient_billing_v2();
create trigger packages_reconcile_billing_v2
  after insert or update of patient_id, status, total_sessions, appointment_type_id, starts_on
  on public.packages for each row execute function private.trigger_reconcile_patient_billing_v2();
create trigger payments_reconcile_billing_v2
  after insert or update of patient_id, amount, status, funding_scope, package_id
  on public.payments for each row execute function private.trigger_reconcile_patient_billing_v2();
create trigger refunds_reconcile_billing_v2
  after insert on public.refunds for each row execute function private.trigger_reconcile_payment_refund_v2();

create or replace view public.package_billing_balances_v2
with (security_invoker = true)
as
select
  package.id as package_id, package.clinic_id, package.patient_id, package.name,
  package.appointment_type_id, package.starts_on, package.total_amount as quote_amount,
  coalesce(payment_totals.net_received, 0)::numeric(12,2) as net_received,
  coalesce(application_totals.applied_amount, 0)::numeric(12,2) as applied_amount,
  greatest(coalesce(charge_totals.charge_amount, 0) - coalesce(application_totals.applied_amount, 0), 0)::numeric(12,2) as due_amount,
  greatest(coalesce(payment_totals.net_received, 0) - coalesce(application_totals.applied_amount, 0), 0)::numeric(12,2) as refundable_credit,
  coalesce(session_totals.availed_sessions, 0)::integer as availed_sessions,
  coalesce(session_totals.scheduled_sessions, 0)::integer as scheduled_sessions,
  greatest(package.total_sessions - coalesce(session_totals.availed_sessions, 0) - coalesce(session_totals.scheduled_sessions, 0), 0)::integer as remaining_sessions,
  package.status as lifecycle, package.completed_at, package.cancelled_at, package.cancellation_reason
from public.packages package
left join lateral (
  select coalesce(sum(greatest(payment.amount - coalesce(refunded.amount, 0), 0)), 0) as net_received
  from public.payments payment
  left join lateral (
    select coalesce(sum(refund.amount), 0) as amount from public.refunds refund where refund.payment_id = payment.id
  ) refunded on true
  where payment.package_id = package.id and payment.status = 'posted'
) payment_totals on true
left join lateral (
  select coalesce(sum(application.amount), 0) as applied_amount
  from public.payment_applications application
  where application.package_id = package.id and application.status = 'active'
) application_totals on true
left join lateral (
  select coalesce(sum(charge.amount), 0) as charge_amount
  from public.package_session_allocations allocation
  join public.appointment_charges charge on charge.appointment_id = allocation.appointment_id
  where allocation.package_id = package.id and allocation.lifecycle <> 'released'
) charge_totals on true
left join lateral (
  select count(*) filter (where lifecycle = 'availed') as availed_sessions,
         count(*) filter (where lifecycle = 'scheduled') as scheduled_sessions
  from public.package_session_allocations allocation
  where allocation.package_id = package.id and allocation.lifecycle <> 'released'
) session_totals on true;

create or replace view public.patient_billing_balances_v2
with (security_invoker = true)
as
select
  patient.id as patient_id, patient.clinic_id,
  coalesce(charges.quote_amount, 0)::numeric(12,2) as quote_amount,
  coalesce(receipts.net_received, 0)::numeric(12,2) as net_received,
  coalesce(applications.applied_amount, 0)::numeric(12,2) as applied_amount,
  greatest(coalesce(charges.quote_amount, 0) - coalesce(applications.applied_amount, 0), 0)::numeric(12,2) as due_amount,
  greatest(coalesce(receipts.net_received, 0) - coalesce(applications.applied_amount, 0), 0)::numeric(12,2) as refundable_credit
from public.patients patient
left join lateral (
  select coalesce(sum(amount), 0) as quote_amount from public.appointment_charges
  where patient_id = patient.id and status in ('pending', 'posted')
) charges on true
left join lateral (
  select coalesce(sum(greatest(payment.amount - coalesce(refunded.amount, 0), 0)), 0) as net_received
  from public.payments payment
  left join lateral (
    select coalesce(sum(refund.amount), 0) as amount from public.refunds refund where refund.payment_id = payment.id
  ) refunded on true
  where payment.patient_id = patient.id and payment.status = 'posted'
) receipts on true
left join lateral (
  select coalesce(sum(amount), 0) as applied_amount from public.payment_applications
  where patient_id = patient.id and status = 'active'
) applications on true;

create or replace function public.reconcile_patient_billing_v2(p_patient_id uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare target_clinic_id uuid;
begin
  if not private.has_role(array['admin']) then raise exception 'You are not allowed to reconcile billing.' using errcode = '42501'; end if;
  select clinic_id into target_clinic_id from public.patients where id = p_patient_id;
  if target_clinic_id is null or not private.is_same_clinic(target_clinic_id) then
    raise exception 'Selected patient does not belong to your clinic.' using errcode = '42501';
  end if;
  perform private.reconcile_patient_billing_v2(p_patient_id);
  return jsonb_build_object('success', true, 'patientId', p_patient_id);
exception when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
end;
$$;

create or replace function public.preview_billing_allocation_v2(p_patient_id uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare target_clinic_id uuid; patient_balance jsonb; package_balances jsonb;
begin
  if not private.has_role(array['admin']) then raise exception 'You are not allowed to preview billing.' using errcode = '42501'; end if;
  select clinic_id into target_clinic_id from public.patients where id = p_patient_id;
  if target_clinic_id is null or not private.is_same_clinic(target_clinic_id) then
    raise exception 'Selected patient does not belong to your clinic.' using errcode = '42501';
  end if;
  select to_jsonb(balance) into patient_balance from public.patient_billing_balances_v2 balance where balance.patient_id = p_patient_id;
  select coalesce(jsonb_agg(to_jsonb(balance) order by balance.starts_on, balance.package_id), '[]'::jsonb)
  into package_balances from public.package_billing_balances_v2 balance where balance.patient_id = p_patient_id;
  return jsonb_build_object('success', true, 'patientBalance', coalesce(patient_balance, '{}'::jsonb), 'packageBalances', package_balances);
exception when others then
  return jsonb_build_object('success', false, 'errorCode', sqlstate, 'message', sqlerrm);
end;
$$;
