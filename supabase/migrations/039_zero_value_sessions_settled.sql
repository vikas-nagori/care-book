-- 039_zero_value_sessions_settled.sql
--
-- A session with a zero fee was stamped 'unpaid' forever and listed alongside genuinely
-- outstanding sessions on the balance-detail drill-down, and badged "Due" on the dashboard.
--
-- Root cause: the payment_status CASE inside private.reconcile_patient_billing_v2 can only
-- reach 'paid' or 'prepaid' via a branch guarded by `charge.amount > 0`. A zero-value charge
-- matches no branch and lands on `else 'unpaid'`. It contributes nothing to any due total, so
-- the balances were always right — only the status was wrong.
--
-- This recreates the function with one added first branch, then backfills the rows already
-- stamped wrong. Everything else in the function is byte-identical to migration 031; the body
-- was verified against production (md5 551d011f3e2e4a354213f20ea0f7f643) before editing.

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
  application_row record;
  charge_row record;
  remaining_sessions integer;
  remaining_payment numeric(12,2);
  remaining_charge numeric(12,2);
  draw_amount numeric(12,2);
begin
  select patient.clinic_id
  into target_clinic_id
  from public.patients patient
  where patient.id = target_patient_id;

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

  -- Normalize imported historical commitments before packages inspect eligibility.
  -- Reconciled ordinary applications remain derived FIFO state and are rebuilt below;
  -- only legacy imports reserve their original appointment ahead of package selection.
  create temporary table if not exists normalized_ordinary_applications_v2 (
    payment_id uuid not null,
    charge_id uuid not null,
    amount numeric(10,2) not null,
    allocation_origin text not null,
    applied_at timestamptz not null,
    primary key (payment_id, charge_id)
  ) on commit drop;
  truncate normalized_ordinary_applications_v2;

  for application_row in
    select
      application.*,
      greatest(payment.amount - coalesce((
        select sum(refund.amount) from public.refunds refund
        where refund.payment_id = payment.id
          and not exists (select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id)
      ), 0), 0)::numeric(12,2) as net_payment_amount,
      charge.amount as charge_amount
    from public.payment_applications application
    join public.payments payment on payment.id = application.payment_id
    join public.appointment_charges charge on charge.id = application.charge_id
    join public.appointments appointment on appointment.id = charge.appointment_id
    where application.patient_id = target_patient_id
      and application.status = 'active'
      and application.funding_scope = 'ordinary'
      and application.allocation_origin = 'legacy_import'
      and payment.patient_id = target_patient_id
      and payment.clinic_id = target_clinic_id
      and payment.status = 'posted'
      and payment.funding_scope = 'ordinary'
      and charge.status in ('pending', 'posted')
      and charge.amount > 0
    order by payment.date, payment.created_at, payment.id, application.applied_at, application.id
  loop
    select greatest(application_row.net_payment_amount - coalesce(sum(normalized.amount), 0), 0)
    into remaining_payment
    from normalized_ordinary_applications_v2 normalized
    where normalized.payment_id = application_row.payment_id;

    select greatest(application_row.charge_amount - coalesce(sum(normalized.amount), 0), 0)
    into remaining_charge
    from normalized_ordinary_applications_v2 normalized
    where normalized.charge_id = application_row.charge_id;

    draw_amount := least(application_row.amount, remaining_payment, remaining_charge);
    if draw_amount > 0 then
      insert into normalized_ordinary_applications_v2 (
        payment_id, charge_id, amount, allocation_origin, applied_at
      ) values (
        application_row.payment_id,
        application_row.charge_id,
        draw_amount,
        application_row.allocation_origin,
        application_row.applied_at
      );
    end if;
  end loop;

  update public.payment_applications application
  set status = 'reversed',
      reversed_at = now(),
      reversal_reason = 'reconciled: ordinary commitment capacity changed'
  where application.patient_id = target_patient_id
    and application.status = 'active'
    and application.funding_scope = 'ordinary'
    and application.allocation_origin = 'legacy_import'
    and not exists (
      select 1
      from normalized_ordinary_applications_v2 normalized
      where normalized.payment_id = application.payment_id
        and normalized.charge_id = application.charge_id
        and normalized.amount = application.amount
        and normalized.allocation_origin = application.allocation_origin
    );

  insert into public.payment_applications (
    clinic_id, patient_id, payment_id, charge_id, funding_scope, package_id,
    amount, allocation_origin, applied_at
  )
  select
    target_clinic_id,
    target_patient_id,
    normalized.payment_id,
    normalized.charge_id,
    'ordinary',
    null,
    normalized.amount,
    normalized.allocation_origin,
    normalized.applied_at
  from normalized_ordinary_applications_v2 normalized
  where not exists (
    select 1
    from public.payment_applications application
    where application.payment_id = normalized.payment_id
      and application.charge_id = normalized.charge_id
      and application.status = 'active'
      and application.amount = normalized.amount
      and application.allocation_origin = normalized.allocation_origin
  );

  -- Rebuild the current ordinary FIFO before package selection. Historical imports keep
  -- their validated appointment commitment, while reconciled applications are derived
  -- anew so an earlier or redated charge immediately takes priority. Appointments that
  -- already belong to a still-eligible package remain outside the ordinary FIFO.
  create temporary table if not exists prepackage_ordinary_applications_v2 (
    payment_id uuid not null,
    charge_id uuid not null,
    amount numeric(10,2) not null,
    allocation_origin text not null,
    applied_at timestamptz not null,
    primary key (payment_id, charge_id, allocation_origin)
  ) on commit drop;
  truncate prepackage_ordinary_applications_v2;

  insert into prepackage_ordinary_applications_v2 (
    payment_id, charge_id, amount, allocation_origin, applied_at
  )
  select
    normalized.payment_id,
    normalized.charge_id,
    normalized.amount,
    normalized.allocation_origin,
    normalized.applied_at
  from normalized_ordinary_applications_v2 normalized;

  for payment_row in
    select
      payment.*,
      greatest(payment.amount - coalesce(sum(refund.amount), 0), 0)::numeric(12,2) as net_amount
    from public.payments payment
    left join public.refunds refund on refund.payment_id = payment.id
      and not exists (select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id)
    where payment.patient_id = target_patient_id
      and payment.clinic_id = target_clinic_id
      and payment.status = 'posted'
      and payment.funding_scope = 'ordinary'
    group by payment.id
    having greatest(payment.amount - coalesce(sum(refund.amount), 0), 0) > 0
    order by payment.date, payment.created_at, payment.id
  loop
    select greatest(payment_row.net_amount - coalesce(sum(application.amount), 0), 0)
    into remaining_payment
    from prepackage_ordinary_applications_v2 application
    where application.payment_id = payment_row.id;

    for charge_row in
      select charge.id
      from public.appointment_charges charge
      join public.appointments appointment on appointment.id = charge.appointment_id
      where charge.patient_id = target_patient_id
        and charge.status in ('pending', 'posted')
        and charge.amount > 0
        and not exists (
          select 1
          from public.package_session_allocations allocation
          join public.packages package on package.id = allocation.package_id
          where allocation.appointment_id = appointment.id
            and allocation.lifecycle <> 'released'
            and package.status in ('active', 'completed')
            and package.appointment_type_id = appointment.appointment_type_id
            and appointment.date >= package.starts_on
        )
      order by appointment.date, appointment.time, appointment.id
    loop
      exit when remaining_payment <= 0;

      select greatest(charge.amount - coalesce(sum(application.amount), 0), 0)
      into remaining_charge
      from public.appointment_charges charge
      left join prepackage_ordinary_applications_v2 application
        on application.charge_id = charge.id
      where charge.id = charge_row.id
      group by charge.amount;

      if remaining_charge <= 0 then
        continue;
      end if;

      draw_amount := least(remaining_payment, remaining_charge);
      insert into prepackage_ordinary_applications_v2 (
        payment_id, charge_id, amount, allocation_origin, applied_at
      ) values (
        payment_row.id,
        charge_row.id,
        draw_amount,
        'reconciled',
        now()
      )
      on conflict (payment_id, charge_id, allocation_origin) do update
      set amount = prepackage_ordinary_applications_v2.amount + excluded.amount;
      remaining_payment := remaining_payment - draw_amount;
    end loop;
  end loop;

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
          from prepackage_ordinary_applications_v2 application
          where application.charge_id = charge.id
            and application.amount > 0
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
    allocation_origin text not null,
    applied_at timestamptz not null,
    primary key (payment_id, charge_id, allocation_origin)
  ) on commit drop;
  truncate desired_payment_applications_v2;

  insert into desired_payment_applications_v2 (
    payment_id, charge_id, funding_scope, package_id, amount, allocation_origin, applied_at
  )
  select
    normalized.payment_id,
    normalized.charge_id,
    'ordinary',
    null,
    normalized.amount,
    normalized.allocation_origin,
    normalized.applied_at
  from normalized_ordinary_applications_v2 normalized;

  for payment_row in
    select
      payment.*,
      greatest(payment.amount - coalesce(sum(refund.amount), 0), 0)::numeric(12,2) as net_amount
    from public.payments payment
    left join public.refunds refund on refund.payment_id = payment.id
      and not exists (select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id)
    where payment.patient_id = target_patient_id
      and payment.clinic_id = target_clinic_id
      and payment.status = 'posted'
    group by payment.id
    having greatest(payment.amount - coalesce(sum(refund.amount), 0), 0) > 0
    order by payment.date, payment.created_at, payment.id
  loop
    select greatest(payment_row.net_amount - coalesce(sum(desired.amount), 0), 0)
    into remaining_payment
    from desired_payment_applications_v2 desired
    where desired.payment_id = payment_row.id;

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
        payment_id, charge_id, funding_scope, package_id, amount, allocation_origin, applied_at
      ) values (
        payment_row.id,
        charge_row.id,
        payment_row.funding_scope,
        payment_row.package_id,
        draw_amount,
        'reconciled',
        now()
      )
      on conflict (payment_id, charge_id, allocation_origin) do update
      set amount = desired_payment_applications_v2.amount + excluded.amount;
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
        and desired.allocation_origin = application.allocation_origin
    );

  insert into public.payment_applications (
    clinic_id, patient_id, payment_id, charge_id, funding_scope, package_id, amount,
    allocation_origin, applied_at
  )
  select
    target_clinic_id,
    target_patient_id,
    desired.payment_id,
    desired.charge_id,
    desired.funding_scope,
    desired.package_id,
    desired.amount,
    desired.allocation_origin,
    desired.applied_at
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
      and application.allocation_origin = desired.allocation_origin
  );

  -- Temporary read compatibility for pages still reading appointment_payments during the
  -- same-release UI cutover. The v2 application ledger remains authoritative.
  delete from public.appointment_payments legacy_application
  using public.payments payment
  where legacy_application.payment_id = payment.id
    and payment.patient_id = target_patient_id;

  insert into public.appointment_payments (payment_id, appointment_id, amount_applied)
  select application.payment_id, charge.appointment_id, sum(application.amount)
  from public.payment_applications application
  join public.appointment_charges charge on charge.id = application.charge_id
  where application.patient_id = target_patient_id
    and application.status = 'active'
    and charge.appointment_id is not null
  group by application.payment_id, charge.appointment_id
  on conflict (payment_id, appointment_id) do update
  set amount_applied = excluded.amount_applied;

  update public.appointments appointment
  set payment_status = coalesce(status_summary.payment_status, 'unpaid')
  from (
    select
      charge.appointment_id,
      case
        -- A zero-value session has nothing to collect, so it is settled the moment it exists.
        -- Every branch below requires charge.amount > 0, so without this one a free session
        -- falls through to 'unpaid' and stays there forever, showing up in every due list.
        when charge.amount <= 0 then 'paid'
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
          from public.refunds refund
          where not exists (select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id)
          group by refund.payment_id
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

-- Backfill: restate the sessions the old CASE stamped 'unpaid'. This matches exactly what the
-- function above now derives, so a later reconcile is a no-op rather than a second correction.
update public.appointments appointment
set payment_status = 'paid'
from public.appointment_charges charge
where charge.appointment_id = appointment.id
  and charge.amount <= 0
  and appointment.payment_status is distinct from 'paid';
