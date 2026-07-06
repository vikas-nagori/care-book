-- Make payment-credit allocation idempotent so editing a *paid* session re-derives the balance.
--
-- The billing-sync trigger fires `after update of fee/status on appointments` and runs
-- allocate_patient_payment_credit, but the prior version (migration 015) only ever paid off
-- sessions still flagged `unpaid` and used `insert ... on conflict do nothing`. It never un-tied
-- money from an already-paid session nor re-snapshotted amount_applied. So editing the fee (or
-- un-completing) a paid session moved appointments.fee but left its allocation frozen — the
-- due/credit totals never changed (see docs/superpowers/specs/2026-07-07-*-design.md, Phase 1).
--
-- Fix (Approach A — idempotent per-patient re-derivation): before the FIFO passes, wipe the
-- patient's money ties on all NON-cancelled sessions and reset those sessions to `unpaid`, then
-- rebuild the allocation from current fees/status and the full payment pool. Running it repeatedly
-- lands on the same result, so any trigger firing (fee edit, status flip, new/removed payment)
-- recomputes correctly. Cancelled sessions are left to the dedicated untally trigger (migration
-- 008); the package *session-quota* ledger (package_session_allocations / used_sessions) is a
-- separate table this function never touches, so package usage counts are undisturbed.
--
-- Note: the reset/rebuild only writes appointments.payment_status (not fee/status/date), and the
-- billing-sync trigger fires only on updates of patient_id/status/date/time/fee — so these writes
-- do not re-fire the trigger and there is no recursion.

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
  -- Idempotent reset: clear existing money ties on the patient's non-cancelled sessions and
  -- reset those sessions to unpaid, so the FIFO passes below rebuild from the current state.
  delete from public.appointment_payments appointment_payment_row
  using public.appointments appt
  where appt.id = appointment_payment_row.appointment_id
    and appt.patient_id = target_patient_id
    and appt.status <> 'cancelled';

  update public.appointments
  set payment_status = 'unpaid'
  where patient_id = target_patient_id
    and status <> 'cancelled'
    and payment_status <> 'unpaid';

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

grant execute on function public.allocate_patient_payment_credit(uuid) to authenticated;
