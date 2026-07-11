-- 024_prepaid_only_packages.sql
-- Packages are prepaid-only. Postpaid packages allowed the "sessions -> package" allocation
-- layer to attach a bill-later package (paid_amount 0) to sessions that were already paid by
-- the independent "money -> sessions" FIFO layer, producing a paid/unpaid contradiction and a
-- double-counted balance (see the Suruchi Muley case). Removing postpaid eliminates that class
-- of bug: a prepaid package always carries collected money, so it can never mark a paid session
-- as unpaid.

-- 1) Constrain the column to prepaid only.
alter table public.packages
  drop constraint if exists packages_payment_timing_check;

alter table public.packages
  add constraint packages_payment_timing_check check (payment_timing = 'prepaid');

alter table public.packages
  alter column payment_timing set default 'prepaid';

-- 2) record_billing_entry: reject non-prepaid packages and always require a positive amount for
--    a package. Body is otherwise identical to the clinic-aware version from migration 019/022.
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
  set search_path to 'public', 'private'
as $function$
declare
  target_clinic_id uuid;
  normalized_amount numeric(10,2) := coalesce(p_amount, 0);
  package_total_amount numeric(10,2);
  new_package_id uuid;
  new_payment_id uuid;
  linked_appointment_ids uuid[] := array[]::uuid[];
  remaining_credit numeric(10,2) := 0;
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to manage billing.' using errcode = '42501';
  end if;

  select clinic_id into target_clinic_id
  from public.patients
  where id = p_patient_id;

  if target_clinic_id is null or not private.is_same_clinic(target_clinic_id) then
    raise exception 'Selected patient does not belong to your clinic.' using errcode = '42501';
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

    -- Packages are prepaid only.
    if coalesce(p_package_payment_timing, 'prepaid') <> 'prepaid' then
      raise exception 'Packages are prepaid only.' using errcode = '22023';
    end if;

    if p_package_total_sessions is null or p_package_total_sessions <= 0 then
      raise exception 'Total sessions must be greater than zero.' using errcode = '22023';
    end if;

    if p_package_per_session_amount is null or p_package_per_session_amount < 0 then
      raise exception 'Per-session charge cannot be negative.' using errcode = '22023';
    end if;

    package_total_amount := p_package_total_sessions * p_package_per_session_amount;

    if normalized_amount <= 0 then
      raise exception 'Enter the amount collected for this package.' using errcode = '22023';
    end if;

    if normalized_amount > package_total_amount then
      raise exception 'Payment exceeds the package total.' using errcode = '22023';
    end if;

    insert into public.packages (
      clinic_id,
      patient_id,
      name,
      total_sessions,
      total_amount,
      per_session_amount,
      payment_timing
    )
    values (
      target_clinic_id,
      p_patient_id,
      trim(p_package_name),
      p_package_total_sessions,
      package_total_amount,
      p_package_per_session_amount,
      'prepaid'
    )
    returning id into new_package_id;

    perform private.assign_patient_package_sessions(p_patient_id);
  end if;

  if normalized_amount > 0 then
    if nullif(trim(coalesce(p_payment_method, '')), '') is null then
      raise exception 'Choose a payment method.' using errcode = '22023';
    end if;

    if p_payment_date is null then
      raise exception 'Choose a payment date.' using errcode = '22023';
    end if;

    insert into public.payments (
      clinic_id,
      patient_id,
      package_id,
      amount,
      payment_method,
      date,
      notes
    )
    values (
      target_clinic_id,
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
      where id = new_package_id
        and clinic_id = target_clinic_id;
    end if;

    perform private.allocate_patient_payment_credit(p_patient_id);

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
$function$;
