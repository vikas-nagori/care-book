-- Pool a patient's payment credit across payments when covering a session.
--
-- Previously allocate_patient_payment_credit (009) spent each payment's credit
-- independently, and appointment_payments had a unique(appointment_id) constraint, so a
-- session could be funded by at most one payment. Two ₹100 payments could therefore not
-- jointly cover one ₹150 session, and small per-payment leftovers stranded permanently.
--
-- This migration:
--   1. Drops the one-payment-per-appointment unique index (keeps unique(payment_id,
--      appointment_id), so a payment still links a given appointment at most once).
--   2. Rewrites allocate_patient_payment_credit to pool every payment's remaining credit
--      into a single FIFO balance and draw a session's full fee across as many payments
--      as needed (one appointment_payments row per contributing payment). Coverage stays
--      all-or-nothing per session (a session is only marked paid/prepaid once the pooled
--      balance can fund its full fee), oldest-first, completed sessions before upcoming.

-- 1. Allow a session to be funded by more than one payment.
drop index if exists public.appointment_payments_one_payment_per_appointment_idx;

-- 2. Pooled FIFO allocation.
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
    select appointment_row.*
    from public.appointments appointment_row
    where appointment_row.patient_id = target_patient_id
      and appointment_row.status = 'completed'
      and appointment_row.payment_status = 'unpaid'
      and coalesce(appointment_row.fee, 0) > 0
    order by appointment_row.date, appointment_row.time, appointment_row.id
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
    select appointment_row.*
    from public.appointments appointment_row
    where appointment_row.patient_id = target_patient_id
      and appointment_row.status = 'scheduled'
      and appointment_row.date >= today_ist
      and appointment_row.payment_status = 'unpaid'
      and coalesce(appointment_row.fee, 0) > 0
    order by appointment_row.date, appointment_row.time, appointment_row.id
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
