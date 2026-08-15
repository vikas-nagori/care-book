-- Packages must be collected in full.
--
-- record_billing_entry_v2 previously accepted any positive receipt when creating a package,
-- so an admin could create a 5,400 package against a 2,000 payment. With the funding-scope
-- picker removed from the billing entry form there is no longer any UI path to collect the
-- remainder, leaving a package due that can never be cleared. Reject the partial receipt at
-- creation instead. The package insert already hardcodes payment_timing = 'prepaid', so this
-- makes the RPC agree with what it records.
--
-- create or replace preserves the existing grants from migration 032.

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
  -- Packages are prepaid in full. A partial receipt would strand a package due with no
  -- collection path, so the receipt must equal sessions x per-session charge.
  if round(p_amount, 2) <> round(p_package_total_sessions * p_package_per_session_amount, 2) then
    raise exception 'A package is collected in full — the amount received must equal the package total.' using errcode = '22023';
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
