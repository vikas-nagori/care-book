-- Mirror the package-must-be-collected-in-full guard inside record_payment_v2.
--
-- Migration 035 added the guard to record_billing_entry_v2, and src/app/billing/actions.ts now
-- pins recordPayment's funding scope to 'ordinary' so no caller of the Server Action can pick
-- 'package'. record_payment_v2 itself is still granted to `authenticated` though, so an admin
-- can call it directly over PostgREST with p_funding_scope = 'package' and any positive amount
-- — recreating the stranded package-due state that no screen can collect. Enforce the same
-- equality here, at the layer that actually writes the row.
--
-- The rule is exactly migration 035's: a package-scoped receipt must equal the package total.
-- Under-payment is the failure that strands a due, and this is the check that blocks it. Note
-- that it deliberately does not sum prior receipts — a later full-total receipt on the same
-- package remains allowed, because the ledger already distributes that surplus as FIFO credit
-- and that behaviour is tested and intentional. Narrowing that is a billing decision, not a
-- security one.
--
-- The only legitimate caller, record_billing_entry_v2, passes the exact package total on a
-- package it just created, so it satisfies this unchanged.
--
-- create or replace preserves the grants from migration 032. The exception handler uses
-- private.billing_error_response from migration 037.

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
  package_total numeric(12,2);
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
    select id, total_amount into target_package_id, package_total
    from public.packages
    where id = p_package_id
      and patient_id = p_patient_id
      and clinic_id = target_clinic_id
      and status <> 'cancelled'
    for update;
    if target_package_id is null then
      raise exception 'Selected package does not belong to the chosen patient.' using errcode = '22023';
    end if;

    if abs(p_amount - coalesce(package_total, 0)) > 0.005 then
      raise exception 'A package is collected in full — the amount received must equal the package total.'
        using errcode = '22023';
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
  return private.billing_error_response(sqlstate, sqlerrm);
end;
$$;
