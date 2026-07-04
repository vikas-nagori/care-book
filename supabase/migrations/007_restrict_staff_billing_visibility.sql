-- Restrict billing and payment access to admins while leaving appointment creation intact for staff.

drop policy if exists "packages_staff_admin_access" on public.packages;
drop policy if exists "payments_staff_admin_access" on public.payments;
drop policy if exists "appointment_payments_staff_admin_access" on public.appointment_payments;
drop policy if exists "Authenticated users can do anything" on public.packages;
drop policy if exists "Authenticated users can do anything" on public.payments;
drop policy if exists "auth users can read/write appointment_payments" on public.appointment_payments;
drop policy if exists "packages_admin_access" on public.packages;
drop policy if exists "payments_admin_access" on public.payments;
drop policy if exists "appointment_payments_admin_access" on public.appointment_payments;

create policy "packages_admin_access" on public.packages
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));

create policy "payments_admin_access" on public.payments
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));

create policy "appointment_payments_admin_access" on public.appointment_payments
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));

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
  appointment_ids uuid[] := coalesce(p_appointment_ids, array[]::uuid[]);
  linked_appointment_ids uuid[] := array[]::uuid[];
  package_paid_amount numeric(10,2);
  package_total_amount numeric(10,2);
  new_payment_id uuid;
  requested_count integer := coalesce(array_length(appointment_ids, 1), 0);
  matched_count integer := 0;
  total_session_fee numeric(10,2) := 0;
  today_ist date := timezone('Asia/Kolkata', now())::date;
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

  if requested_count > 0 then
    if (
      select count(*)
      from (
        select distinct appointment_id
        from unnest(appointment_ids) as selected_appointments(appointment_id)
      ) as distinct_appointments
    ) <> requested_count then
      raise exception 'Appointment selection contains duplicates.' using errcode = '22023';
    end if;
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

  if requested_count > 0 then
    with locked_appointments as (
      select *
      from public.appointments
      where id = any(appointment_ids)
      for update
    )
    select
      count(*)::integer,
      coalesce(sum(fee), 0),
      coalesce(array_agg(id order by date, time), array[]::uuid[])
    into matched_count, total_session_fee, linked_appointment_ids
    from locked_appointments
    where patient_id = p_patient_id
      and payment_status = 'unpaid'
      and coalesce(fee, 0) > 0
      and (
        (p_payment_timing = 'postpaid' and status = 'completed')
        or
        (p_payment_timing = 'prepaid' and status = 'scheduled' and date >= today_ist)
      );

    if matched_count <> requested_count then
      raise exception 'Selected appointments are no longer eligible for this payment.' using errcode = '22023';
    end if;

    if p_amount < total_session_fee then
      raise exception 'Payment amount does not cover the selected sessions.' using errcode = '22023';
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

  if requested_count > 0 then
    insert into public.appointment_payments (payment_id, appointment_id)
    select new_payment_id, unnest(linked_appointment_ids);

    update public.appointments
    set payment_status = case
      when p_payment_timing = 'postpaid' then 'paid'
      else 'prepaid'
    end
    where id = any(linked_appointment_ids);
  end if;

  if p_package_id is not null then
    update public.packages
    set paid_amount = paid_amount + p_amount
    where id = p_package_id;
  end if;

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

grant execute on function public.record_payment(uuid, uuid, numeric, text, date, text, text, uuid[]) to authenticated;
