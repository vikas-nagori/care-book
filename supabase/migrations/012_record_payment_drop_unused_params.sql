-- Drop the unused p_appointment_ids and p_payment_timing parameters from record_payment.
--
-- Allocation of payment credit to appointments is handled entirely by
-- allocate_patient_payment_credit (patient-wide, oldest-first), so the caller-supplied
-- appointment list was never read, and payment timing (prepaid vs postpaid) is derived
-- from each appointment's own status rather than a flag on the payment. Removing the
-- dead parameters keeps the RPC signature honest and prevents the UI from implying it
-- controls allocation.
--
-- The function body is otherwise identical to the version in migration 009.

-- The old signature must be dropped explicitly before recreating with fewer params.
drop function if exists public.record_payment(uuid, uuid, numeric, text, date, text, text, uuid[]);

create or replace function public.record_payment(
  p_patient_id uuid,
  p_package_id uuid,
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
  package_paid_amount numeric(10,2);
  package_total_amount numeric(10,2);
  new_payment_id uuid;
  linked_appointment_ids uuid[] := array[]::uuid[];
begin
  if not public.has_role(array['admin']) then
    raise exception 'You are not allowed to record payments.' using errcode = '42501';
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

grant execute on function public.record_payment(uuid, uuid, numeric, text, date, text) to authenticated;
