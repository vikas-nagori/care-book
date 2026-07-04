-- Harden access control, billing validation, and package/session consistency.

create extension if not exists "pgcrypto";

create or replace function public.has_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

grant execute on function public.has_role(text[]) to authenticated;

drop policy if exists "Authenticated users can do anything" on public.patients;
drop policy if exists "Authenticated users can do anything" on public.appointments;
drop policy if exists "Authenticated users can do anything" on public.treatment_plans;
drop policy if exists "Authenticated users can do anything" on public.session_notes;
drop policy if exists "Authenticated users can do anything" on public.packages;
drop policy if exists "Authenticated users can do anything" on public.payments;
drop policy if exists "auth users can read/write appointment_payments" on public.appointment_payments;
drop policy if exists "auth users can read/write global_settings" on public.global_settings;
drop policy if exists "profiles_read_authenticated" on public.profiles;
drop policy if exists "profiles_write_admin" on public.profiles;

create policy "patients_staff_admin_access" on public.patients
  for all
  using (public.has_role(array['admin', 'staff']))
  with check (public.has_role(array['admin', 'staff']));

create policy "appointments_staff_admin_access" on public.appointments
  for all
  using (public.has_role(array['admin', 'staff']))
  with check (public.has_role(array['admin', 'staff']));

create policy "treatment_plans_staff_admin_access" on public.treatment_plans
  for all
  using (public.has_role(array['admin', 'staff']))
  with check (public.has_role(array['admin', 'staff']));

create policy "session_notes_staff_admin_access" on public.session_notes
  for all
  using (public.has_role(array['admin', 'staff']))
  with check (public.has_role(array['admin', 'staff']));

create policy "packages_staff_admin_access" on public.packages
  for all
  using (public.has_role(array['admin', 'staff']))
  with check (public.has_role(array['admin', 'staff']));

create policy "payments_staff_admin_access" on public.payments
  for all
  using (public.has_role(array['admin', 'staff']))
  with check (public.has_role(array['admin', 'staff']));

create policy "appointment_payments_staff_admin_access" on public.appointment_payments
  for all
  using (public.has_role(array['admin', 'staff']))
  with check (public.has_role(array['admin', 'staff']));

create policy "global_settings_staff_admin_read" on public.global_settings
  for select
  using (public.has_role(array['admin', 'staff']));

create policy "global_settings_admin_write" on public.global_settings
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));

create policy "profiles_read_self_or_admin" on public.profiles
  for select
  using (id = auth.uid() or public.has_role(array['admin']));

create policy "profiles_write_admin" on public.profiles
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));

update public.global_settings
set
  home_visit_fee = greatest(home_visit_fee, 0),
  clinic_fee = greatest(clinic_fee, 0);

update public.appointments
set
  duration_minutes = greatest(duration_minutes, 1),
  fee = case when fee is null then null else greatest(fee, 0) end;

update public.packages
set
  total_sessions = greatest(total_sessions, 1),
  used_sessions = greatest(used_sessions, 0),
  total_amount = greatest(total_amount, 0),
  paid_amount = least(greatest(paid_amount, 0), greatest(total_amount, 0));

alter table public.global_settings
  drop constraint if exists global_settings_home_visit_fee_nonnegative,
  drop constraint if exists global_settings_clinic_fee_nonnegative;

alter table public.global_settings
  add constraint global_settings_home_visit_fee_nonnegative check (home_visit_fee >= 0),
  add constraint global_settings_clinic_fee_nonnegative check (clinic_fee >= 0);

alter table public.appointments
  drop constraint if exists appointments_duration_minutes_positive,
  drop constraint if exists appointments_fee_nonnegative;

alter table public.appointments
  add constraint appointments_duration_minutes_positive check (duration_minutes > 0),
  add constraint appointments_fee_nonnegative check (fee is null or fee >= 0);

alter table public.packages
  drop constraint if exists packages_total_sessions_positive,
  drop constraint if exists packages_used_sessions_nonnegative,
  drop constraint if exists packages_total_amount_nonnegative,
  drop constraint if exists packages_paid_amount_nonnegative,
  drop constraint if exists packages_used_sessions_within_total,
  drop constraint if exists packages_paid_amount_within_total;

alter table public.packages
  add constraint packages_total_sessions_positive check (total_sessions > 0),
  add constraint packages_used_sessions_nonnegative check (used_sessions >= 0),
  add constraint packages_total_amount_nonnegative check (total_amount >= 0),
  add constraint packages_paid_amount_nonnegative check (paid_amount >= 0),
  add constraint packages_used_sessions_within_total check (used_sessions <= total_sessions),
  add constraint packages_paid_amount_within_total check (paid_amount <= total_amount);

alter table public.payments
  drop constraint if exists payments_amount_positive;

alter table public.payments
  add constraint payments_amount_positive check (amount > 0);

create or replace function public.reconcile_package_usage(target_package_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.packages package_row
  set used_sessions = coalesce(usage_counts.used_sessions, 0)
  from (
    select
      package_row.id as package_id,
      count(distinct appointment_row.id)::integer as used_sessions
    from public.packages package_row
    left join public.payments payment_row
      on payment_row.package_id = package_row.id
    left join public.appointment_payments appointment_payment_row
      on appointment_payment_row.payment_id = payment_row.id
    left join public.appointments appointment_row
      on appointment_row.id = appointment_payment_row.appointment_id
      and appointment_row.status = 'completed'
    where package_row.id = target_package_id
    group by package_row.id
  ) as usage_counts
  where package_row.id = usage_counts.package_id;
$$;

create or replace function public.sync_appointment_package_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_appointment_id uuid;
  target_package_id uuid;
begin
  if tg_table_name = 'appointments' then
    target_appointment_id := coalesce(new.id, old.id);
  else
    target_appointment_id := coalesce(new.appointment_id, old.appointment_id);
  end if;

  for target_package_id in
    select distinct payment_row.package_id
    from public.appointment_payments appointment_payment_row
    join public.payments payment_row on payment_row.id = appointment_payment_row.payment_id
    where appointment_payment_row.appointment_id = target_appointment_id
      and payment_row.package_id is not null
  loop
    perform public.reconcile_package_usage(target_package_id);
  end loop;

  return null;
end;
$$;

create or replace function public.sync_payment_package_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.package_id is not null then
    perform public.reconcile_package_usage(old.package_id);
  end if;

  if new.package_id is not null then
    perform public.reconcile_package_usage(new.package_id);
  end if;

  return null;
end;
$$;

drop trigger if exists appointment_payments_reconcile_usage on public.appointment_payments;
create trigger appointment_payments_reconcile_usage
  after insert or delete on public.appointment_payments
  for each row execute function public.sync_appointment_package_usage();

drop trigger if exists appointments_reconcile_usage on public.appointments;
create trigger appointments_reconcile_usage
  after update of status on public.appointments
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_appointment_package_usage();

drop trigger if exists payments_reconcile_usage on public.payments;
create trigger payments_reconcile_usage
  after update of package_id on public.payments
  for each row
  when (old.package_id is distinct from new.package_id)
  execute function public.sync_payment_package_usage();

update public.packages package_row
set used_sessions = coalesce(usage_counts.used_sessions, 0)
from (
  select
    package_row.id as package_id,
    count(distinct appointment_row.id)::integer as used_sessions
  from public.packages package_row
  left join public.payments payment_row
    on payment_row.package_id = package_row.id
  left join public.appointment_payments appointment_payment_row
    on appointment_payment_row.payment_id = payment_row.id
  left join public.appointments appointment_row
    on appointment_row.id = appointment_payment_row.appointment_id
    and appointment_row.status = 'completed'
  group by package_row.id
) as usage_counts
where package_row.id = usage_counts.package_id;

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
  distinct_count integer := 0;
  total_session_fee numeric(10,2) := 0;
  today_ist date := timezone('Asia/Kolkata', now())::date;
begin
  if not public.has_role(array['admin', 'staff']) then
    raise exception 'You are not allowed to record payments.' using errcode = '42501';
  end if;

  if p_payment_timing not in ('prepaid', 'postpaid') then
    raise exception 'Unsupported payment timing.' using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = '22023';
  end if;

  if requested_count > 0 then
    select count(distinct appointment_id)
    into distinct_count
    from unnest(appointment_ids) as appointment_id;

    if distinct_count <> requested_count then
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
