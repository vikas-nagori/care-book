-- Fix "record \"appointment_row\" is not assigned yet" on appointment insert/update.
--
-- assign_patient_package_sessions (013) and allocate_patient_payment_credit (014) each declare a
-- PL/pgSQL record variable named `appointment_row` AND reuse the identical name as the
-- public.appointments table alias inside their queries. PL/pgSQL resolves the qualified references
-- (appointment_row.*, appointment_row.id, ...) to the not-yet-assigned record variable instead of
-- the table alias, raising `record "appointment_row" is not assigned yet`. Both functions run from
-- the appointments_sync_patient_billing_allocations AFTER INSERT trigger, so every booking for a
-- patient with package/payment credit failed.
--
-- This migration re-creates both functions with logic identical to 013/014; the only change is the
-- public.appointments table alias is renamed to `appt` everywhere it previously collided with the
-- `appointment_row` record variable. The `appointment_row` record/loop variable is unchanged.

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
  using public.appointments appt
  where appt.id = allocation_row.appointment_id
    and appt.patient_id = target_patient_id
    and appt.status not in ('scheduled', 'completed');

  for package_row in
    select *
    from public.packages
    where patient_id = target_patient_id
      and status = 'active'
    order by created_at, id
  loop
    perform public.reconcile_package_usage(package_row.id);

    select greatest(package_row.total_sessions - count(appt.id)::integer, 0)
    into remaining_slots
    from public.package_session_allocations allocation_row
    join public.appointments appt
      on appt.id = allocation_row.appointment_id
    where allocation_row.package_id = package_row.id
      and appt.status in ('scheduled', 'completed');

    if remaining_slots <= 0 then
      continue;
    end if;

    for appointment_row in
      select appt.*
      from public.appointments appt
      where appt.patient_id = target_patient_id
        and appt.status in ('completed', 'scheduled')
        and coalesce(appt.fee, 0) > 0
        and not exists (
          select 1
          from public.package_session_allocations existing_allocation
          where existing_allocation.appointment_id = appt.id
        )
      order by
        case when appt.fee = package_row.per_session_amount then 0 else 1 end,
        appt.date,
        appt.time,
        appt.id
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
  payment_ids uuid[];
  payment_remaining numeric[];
  pool_total numeric(12,2) := 0;
  i integer;
  needed numeric(12,2);
  draw numeric(12,2);
  appointment_row record;
  today_ist date := timezone('Asia/Kolkata', now())::date;
begin
  -- Build the FIFO credit pool: each payment's unspent amount, oldest payment first.
  select
    array_agg(payment_row.id order by payment_row.date, payment_row.created_at, payment_row.id),
    array_agg(
      greatest(payment_row.amount - coalesce(applied.applied_sum, 0), 0)
      order by payment_row.date, payment_row.created_at, payment_row.id
    )
  into payment_ids, payment_remaining
  from public.payments payment_row
  left join (
    select appointment_payment_row.payment_id, sum(appointment_payment_row.amount_applied) as applied_sum
    from public.appointment_payments appointment_payment_row
    group by appointment_payment_row.payment_id
  ) applied on applied.payment_id = payment_row.id
  where payment_row.patient_id = target_patient_id;

  if payment_ids is null then
    return;
  end if;

  select coalesce(sum(remaining), 0) into pool_total from unnest(payment_remaining) as remaining;

  if pool_total <= 0 then
    return;
  end if;

  -- Pass 1: pay off completed unpaid sessions (oldest first).
  for appointment_row in
    select appt.*
    from public.appointments appt
    where appt.patient_id = target_patient_id
      and appt.status = 'completed'
      and appt.payment_status = 'unpaid'
      and coalesce(appt.fee, 0) > 0
    order by appt.date, appt.time, appt.id
  loop
    exit when appointment_row.fee > pool_total;

    needed := appointment_row.fee;
    for i in 1 .. array_length(payment_ids, 1) loop
      exit when needed <= 0;
      continue when payment_remaining[i] <= 0;

      draw := least(payment_remaining[i], needed);
      insert into public.appointment_payments (payment_id, appointment_id, amount_applied)
      values (payment_ids[i], appointment_row.id, draw)
      on conflict (payment_id, appointment_id) do nothing;

      payment_remaining[i] := payment_remaining[i] - draw;
      pool_total := pool_total - draw;
      needed := needed - draw;
    end loop;

    update public.appointments
    set payment_status = 'paid'
    where id = appointment_row.id;
  end loop;

  -- Pass 2: prepay upcoming scheduled unpaid sessions (oldest first).
  for appointment_row in
    select appt.*
    from public.appointments appt
    where appt.patient_id = target_patient_id
      and appt.status = 'scheduled'
      and appt.date >= today_ist
      and appt.payment_status = 'unpaid'
      and coalesce(appt.fee, 0) > 0
    order by appt.date, appt.time, appt.id
  loop
    exit when appointment_row.fee > pool_total;

    needed := appointment_row.fee;
    for i in 1 .. array_length(payment_ids, 1) loop
      exit when needed <= 0;
      continue when payment_remaining[i] <= 0;

      draw := least(payment_remaining[i], needed);
      insert into public.appointment_payments (payment_id, appointment_id, amount_applied)
      values (payment_ids[i], appointment_row.id, draw)
      on conflict (payment_id, appointment_id) do nothing;

      payment_remaining[i] := payment_remaining[i] - draw;
      pool_total := pool_total - draw;
      needed := needed - draw;
    end loop;

    update public.appointments
    set payment_status = 'prepaid'
    where id = appointment_row.id;
  end loop;
end;
$$;
