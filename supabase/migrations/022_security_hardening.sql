-- Security hardening: private helper schema, active tenant enforcement,
-- internal RPC revocation, and public onboarding abuse controls.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

alter table public.clinic_onboarding_requests
  add column if not exists request_ip text,
  add column if not exists request_user_agent text,
  add column if not exists request_fingerprint text;

create unique index if not exists clinic_onboarding_pending_owner_email_unique
  on public.clinic_onboarding_requests(lower(btrim(owner_email)))
  where status = 'pending';

create unique index if not exists clinic_onboarding_pending_clinic_name_unique
  on public.clinic_onboarding_requests(lower(btrim(clinic_name)))
  where status = 'pending';

create index if not exists clinic_onboarding_pending_fingerprint_idx
  on public.clinic_onboarding_requests(request_fingerprint, created_at desc)
  where status = 'pending' and request_fingerprint is not null;

create or replace function private.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profile_row.clinic_id
  from public.profiles profile_row
  join public.clinics clinic_row on clinic_row.id = profile_row.clinic_id
  where profile_row.id = auth.uid()
    and profile_row.status = 'active'
    and clinic_row.status = 'active';
$$;

create or replace function private.has_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile_row
    join public.clinics clinic_row on clinic_row.id = profile_row.clinic_id
    where profile_row.id = auth.uid()
      and profile_row.clinic_id is not null
      and profile_row.status = 'active'
      and clinic_row.status = 'active'
      and profile_row.role = any(allowed_roles)
  );
$$;

create or replace function private.is_same_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select target_clinic_id is not null
    and target_clinic_id = private.current_clinic_id();
$$;

create or replace function private.can_access_appointment(
  appointment_clinic_id uuid,
  appointment_type text,
  appointment_created_by uuid,
  appointment_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select
    private.is_same_clinic(appointment_clinic_id)
    and (
      private.has_role(array['admin'])
      or (
        private.has_role(array['staff'])
        and (
          appointment_type = 'clinic'
          or appointment_created_by = auth.uid()
          or appointment_assigned_to = auth.uid()
        )
      )
    );
$$;

create or replace function private.can_access_appointment(
  appointment_type text,
  appointment_created_by uuid,
  appointment_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_access_appointment(
    private.current_clinic_id(),
    appointment_type,
    appointment_created_by,
    appointment_assigned_to
  );
$$;

create or replace function public.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select private.current_clinic_id();
$$;

create or replace function public.has_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_role(allowed_roles);
$$;

create or replace function public.is_same_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.is_same_clinic(target_clinic_id);
$$;

create or replace function public.can_access_appointment(
  appointment_clinic_id uuid,
  appointment_type text,
  appointment_created_by uuid,
  appointment_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_access_appointment(
    appointment_clinic_id,
    appointment_type,
    appointment_created_by,
    appointment_assigned_to
  );
$$;

create or replace function public.can_access_appointment(
  appointment_type text,
  appointment_created_by uuid,
  appointment_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_access_appointment(
    appointment_type,
    appointment_created_by,
    appointment_assigned_to
  );
$$;

create or replace function private.reconcile_package_usage(target_package_id uuid)
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
      count(distinct appt.id)::integer as used_sessions
    from public.packages package_row
    left join public.package_session_allocations package_session_row
      on package_session_row.package_id = package_row.id
    left join public.appointments appt
      on appt.id = package_session_row.appointment_id
      and appt.status in ('scheduled', 'completed')
    where package_row.id = target_package_id
    group by package_row.id
  ) as usage_counts
  where package_row.id = usage_counts.package_id;
$$;

create or replace function private.assign_patient_package_sessions(target_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
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
    perform private.reconcile_package_usage(package_row.id);

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

    perform private.reconcile_package_usage(package_row.id);
  end loop;
end;
$$;

create or replace function private.allocate_patient_payment_credit(target_patient_id uuid)
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

create or replace function private.sync_patient_billing_allocations()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_patient_id uuid;
begin
  if tg_op = 'DELETE' then
    target_patient_id := old.patient_id;
  else
    target_patient_id := new.patient_id;
  end if;

  if target_patient_id is null then
    return null;
  end if;

  perform private.assign_patient_package_sessions(target_patient_id);
  perform private.allocate_patient_payment_credit(target_patient_id);

  return null;
end;
$$;

drop trigger if exists appointments_sync_patient_billing_allocations on public.appointments;
create trigger appointments_sync_patient_billing_allocations
  after insert or update of patient_id, status, date, time, fee on public.appointments
  for each row execute function private.sync_patient_billing_allocations();

drop trigger if exists packages_sync_patient_billing_allocations on public.packages;
create trigger packages_sync_patient_billing_allocations
  after insert or update of patient_id, status, total_sessions on public.packages
  for each row execute function private.sync_patient_billing_allocations();

drop trigger if exists payments_sync_patient_billing_allocations on public.payments;
create trigger payments_sync_patient_billing_allocations
  after insert or update of patient_id, amount on public.payments
  for each row execute function private.sync_patient_billing_allocations();

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
set search_path = public, private
as $$
declare
  target_clinic_id uuid;
  package_paid_amount numeric(10,2);
  package_total_amount numeric(10,2);
  new_payment_id uuid;
  linked_appointment_ids uuid[] := array[]::uuid[];
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to record payments.' using errcode = '42501';
  end if;

  select clinic_id into target_clinic_id
  from public.patients
  where id = p_patient_id;

  if target_clinic_id is null or not private.is_same_clinic(target_clinic_id) then
    raise exception 'Selected patient does not belong to your clinic.' using errcode = '42501';
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
      and clinic_id = target_clinic_id
    for update;

    if package_paid_amount is null then
      raise exception 'Selected package does not belong to the chosen patient.' using errcode = '22023';
    end if;

    if package_paid_amount + p_amount > package_total_amount then
      raise exception 'Payment exceeds the remaining package balance.' using errcode = '22023';
    end if;
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
    where id = p_package_id
      and clinic_id = target_clinic_id;
  end if;

  perform private.allocate_patient_payment_credit(p_patient_id);

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
security invoker
set search_path = public, private
as $$
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

    if p_package_payment_timing not in ('prepaid', 'postpaid') then
      raise exception 'Unsupported package billing style.' using errcode = '22023';
    end if;

    if p_package_total_sessions is null or p_package_total_sessions <= 0 then
      raise exception 'Total sessions must be greater than zero.' using errcode = '22023';
    end if;

    if p_package_per_session_amount is null or p_package_per_session_amount < 0 then
      raise exception 'Per-session charge cannot be negative.' using errcode = '22023';
    end if;

    package_total_amount := p_package_total_sessions * p_package_per_session_amount;

    if p_package_payment_timing = 'prepaid' and normalized_amount <= 0 then
      raise exception 'Enter the amount collected for this prepaid package.' using errcode = '22023';
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
      p_package_payment_timing
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
$$;

drop policy if exists "profiles_tenant_read" on public.profiles;
create policy "profiles_tenant_read" on public.profiles
  for select
  using (
    (
      id = auth.uid()
      and status = 'active'
      and clinic_id = private.current_clinic_id()
    )
    or (
      private.is_same_clinic(clinic_id)
      and private.has_role(array['admin', 'staff'])
    )
  );

drop policy if exists "profiles_tenant_admin_write" on public.profiles;
create policy "profiles_tenant_admin_write" on public.profiles
  for all
  using (private.is_same_clinic(clinic_id) and private.has_role(array['admin']))
  with check (private.is_same_clinic(clinic_id) and private.has_role(array['admin']));

drop policy if exists "user_invites_tenant_admin_read" on public.user_invites;
create policy "user_invites_tenant_admin_read" on public.user_invites
  for select
  using (private.is_same_clinic(clinic_id) and private.has_role(array['admin']));

drop policy if exists "user_invites_tenant_admin_write" on public.user_invites;
create policy "user_invites_tenant_admin_write" on public.user_invites
  for all
  using (private.is_same_clinic(clinic_id) and private.has_role(array['admin']))
  with check (private.is_same_clinic(clinic_id) and private.has_role(array['admin']));

revoke all on function public.reconcile_package_usage(uuid) from public, anon, authenticated;
revoke all on function public.assign_patient_package_sessions(uuid) from public, anon, authenticated;
revoke all on function public.allocate_patient_payment_credit(uuid) from public, anon, authenticated;
revoke all on function public.sync_patient_billing_allocations() from public, anon, authenticated;
revoke all on function public.current_clinic_id() from public, anon;
revoke all on function public.has_role(text[]) from public, anon;
revoke all on function public.is_same_clinic(uuid) from public, anon;
revoke all on function public.can_access_appointment(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.can_access_appointment(text, uuid, uuid) from public, anon;
revoke all on function public.record_payment(uuid, uuid, numeric, text, date, text) from public, anon;
revoke all on function public.record_billing_entry(uuid, text, text, integer, numeric, text, numeric, text, date, text) from public, anon;

grant execute on function private.current_clinic_id() to authenticated, service_role;
grant execute on function private.has_role(text[]) to authenticated, service_role;
grant execute on function private.is_same_clinic(uuid) to authenticated, service_role;
grant execute on function private.can_access_appointment(uuid, text, uuid, uuid) to authenticated, service_role;
grant execute on function private.can_access_appointment(text, uuid, uuid) to authenticated, service_role;
grant execute on function private.reconcile_package_usage(uuid) to authenticated, service_role;
grant execute on function private.assign_patient_package_sessions(uuid) to authenticated, service_role;
grant execute on function private.allocate_patient_payment_credit(uuid) to authenticated, service_role;
grant execute on function private.sync_patient_billing_allocations() to authenticated, service_role;

grant execute on function public.current_clinic_id() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.is_same_clinic(uuid) to authenticated;
grant execute on function public.can_access_appointment(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.can_access_appointment(text, uuid, uuid) to authenticated;
grant execute on function public.record_payment(uuid, uuid, numeric, text, date, text) to authenticated;
grant execute on function public.record_billing_entry(uuid, text, text, integer, numeric, text, numeric, text, date, text) to authenticated;
