-- Add shared-schema multi-clinic tenancy and platform onboarding primitives.

create extension if not exists "pgcrypto";

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinics_name_present check (length(btrim(name)) > 0)
);

alter table public.clinics enable row level security;

create table if not exists public.clinic_onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_name text not null,
  owner_full_name text not null,
  owner_email text not null,
  owner_mobile_number text not null,
  clinic_phone text,
  clinic_address text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  clinic_id uuid references public.clinics(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_onboarding_clinic_name_present check (length(btrim(clinic_name)) > 0),
  constraint clinic_onboarding_owner_name_present check (length(btrim(owner_full_name)) > 0),
  constraint clinic_onboarding_owner_email_present check (length(btrim(owner_email)) > 0),
  constraint clinic_onboarding_owner_mobile_present check (length(btrim(owner_mobile_number)) > 0)
);

create index if not exists clinic_onboarding_requests_status_created_at_idx
  on public.clinic_onboarding_requests(status, created_at desc);

alter table public.clinic_onboarding_requests enable row level security;

drop policy if exists "clinic_onboarding_requests_public_insert" on public.clinic_onboarding_requests;
create policy "clinic_onboarding_requests_public_insert" on public.clinic_onboarding_requests
  for insert
  with check (true);

insert into public.clinics (name, status)
select 'Care-Book Default Clinic', 'active'
where not exists (select 1 from public.clinics);

alter table public.profiles add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.patients add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.appointments add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.treatment_plans add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.packages add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.payments add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.global_settings add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.external_staff add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.user_invites add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;
alter table public.doctors add column if not exists clinic_id uuid references public.clinics(id) on delete restrict;

do $$
declare
  default_clinic_id uuid;
begin
  select id into default_clinic_id
  from public.clinics
  order by created_at, id
  limit 1;

  update public.profiles set clinic_id = default_clinic_id where clinic_id is null;
  update public.patients set clinic_id = default_clinic_id where clinic_id is null;
  update public.doctors set clinic_id = default_clinic_id where clinic_id is null;
  update public.external_staff set clinic_id = default_clinic_id where clinic_id is null;
  update public.global_settings set clinic_id = default_clinic_id where clinic_id is null;

  update public.appointments appointment_row
  set clinic_id = patient_row.clinic_id
  from public.patients patient_row
  where appointment_row.patient_id = patient_row.id
    and appointment_row.clinic_id is null;

  update public.treatment_plans treatment_plan_row
  set clinic_id = patient_row.clinic_id
  from public.patients patient_row
  where treatment_plan_row.patient_id = patient_row.id
    and treatment_plan_row.clinic_id is null;

  update public.packages package_row
  set clinic_id = patient_row.clinic_id
  from public.patients patient_row
  where package_row.patient_id = patient_row.id
    and package_row.clinic_id is null;

  update public.payments payment_row
  set clinic_id = patient_row.clinic_id
  from public.patients patient_row
  where payment_row.patient_id = patient_row.id
    and payment_row.clinic_id is null;

  update public.user_invites invite_row
  set clinic_id = coalesce(profile_row.clinic_id, default_clinic_id)
  from public.profiles profile_row
  where invite_row.invited_by = profile_row.id
    and invite_row.clinic_id is null;

  update public.user_invites set clinic_id = default_clinic_id where clinic_id is null;
end
$$;

create sequence if not exists public.global_settings_id_seq;
alter sequence public.global_settings_id_seq owned by public.global_settings.id;
select setval(
  'public.global_settings_id_seq',
  greatest((select coalesce(max(id), 1) from public.global_settings), 1),
  true
);
alter table public.global_settings alter column id set default nextval('public.global_settings_id_seq');
alter table public.global_settings drop constraint if exists global_settings_id_check;

create unique index if not exists global_settings_clinic_id_unique
  on public.global_settings(clinic_id);

drop index if exists public.doctors_name_unique;
create unique index if not exists doctors_clinic_name_unique
  on public.doctors(clinic_id, lower(btrim(name)));

drop index if exists public.external_staff_email_unique;
create unique index if not exists external_staff_clinic_email_unique
  on public.external_staff(clinic_id, lower(email))
  where email is not null;

create index if not exists profiles_clinic_id_idx on public.profiles(clinic_id);
create index if not exists patients_clinic_id_idx on public.patients(clinic_id);
create index if not exists appointments_clinic_id_idx on public.appointments(clinic_id);
create index if not exists treatment_plans_clinic_id_idx on public.treatment_plans(clinic_id);
create index if not exists packages_clinic_id_idx on public.packages(clinic_id);
create index if not exists payments_clinic_id_idx on public.payments(clinic_id);
create index if not exists external_staff_clinic_id_idx on public.external_staff(clinic_id);
create index if not exists user_invites_clinic_id_idx on public.user_invites(clinic_id);
create index if not exists doctors_clinic_id_idx on public.doctors(clinic_id);

alter table public.patients alter column clinic_id set not null;
alter table public.appointments alter column clinic_id set not null;
alter table public.treatment_plans alter column clinic_id set not null;
alter table public.packages alter column clinic_id set not null;
alter table public.payments alter column clinic_id set not null;
alter table public.global_settings alter column clinic_id set not null;
alter table public.external_staff alter column clinic_id set not null;
alter table public.user_invites alter column clinic_id set not null;
alter table public.doctors alter column clinic_id set not null;

create or replace function public.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select clinic_id
  from public.profiles
  where id = auth.uid();
$$;

grant execute on function public.current_clinic_id() to authenticated;

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
      and clinic_id is not null
      and role = any(allowed_roles)
  );
$$;

grant execute on function public.has_role(text[]) to authenticated;

create or replace function public.is_same_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_clinic_id is not null
    and target_clinic_id = public.current_clinic_id();
$$;

grant execute on function public.is_same_clinic(uuid) to authenticated;

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
set search_path = public
as $$
  select
    public.is_same_clinic(appointment_clinic_id)
    and (
      public.has_role(array['admin'])
      or (
        public.has_role(array['staff'])
        and (
          appointment_type = 'clinic'
          or appointment_created_by = auth.uid()
          or appointment_assigned_to = auth.uid()
        )
      )
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
set search_path = public
as $$
  select public.can_access_appointment(
    public.current_clinic_id(),
    appointment_type,
    appointment_created_by,
    appointment_assigned_to
  );
$$;

grant execute on function public.can_access_appointment(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.can_access_appointment(text, uuid, uuid) to authenticated;

create or replace function public.set_patient_clinic_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clinic_id is null then
    new.clinic_id := public.current_clinic_id();
  end if;
  return new;
end;
$$;

drop trigger if exists patients_set_clinic_id on public.patients;
create trigger patients_set_clinic_id
  before insert on public.patients
  for each row execute function public.set_patient_clinic_id();

create or replace function public.set_doctor_clinic_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clinic_id is null then
    new.clinic_id := public.current_clinic_id();
  end if;
  return new;
end;
$$;

drop trigger if exists doctors_set_clinic_id on public.doctors;
create trigger doctors_set_clinic_id
  before insert on public.doctors
  for each row execute function public.set_doctor_clinic_id();

create or replace function public.set_external_staff_clinic_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clinic_id is null then
    new.clinic_id := public.current_clinic_id();
  end if;
  return new;
end;
$$;

drop trigger if exists external_staff_set_clinic_id on public.external_staff;
create trigger external_staff_set_clinic_id
  before insert on public.external_staff
  for each row execute function public.set_external_staff_clinic_id();

create or replace function public.set_appointment_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_clinic_id uuid;
begin
  select clinic_id into patient_clinic_id
  from public.patients
  where id = new.patient_id;

  if patient_clinic_id is null then
    raise exception 'Appointment patient was not found.' using errcode = '23503';
  end if;

  if new.clinic_id is null then
    new.clinic_id := patient_clinic_id;
  end if;

  if new.clinic_id is distinct from patient_clinic_id then
    raise exception 'Appointment clinic must match patient clinic.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.type = 'clinic' then
    new.assigned_to := null;
    new.external_staff_id := null;
  end if;

  if new.assigned_to is not null and new.external_staff_id is not null then
    raise exception 'Appointment cannot be assigned to both internal and external staff.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_set_creator on public.appointments;
create trigger appointments_set_creator
  before insert or update of patient_id, type, assigned_to, external_staff_id, clinic_id on public.appointments
  for each row
  execute function public.set_appointment_creator();

create or replace function public.set_patient_child_clinic_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_clinic_id uuid;
begin
  select clinic_id into patient_clinic_id
  from public.patients
  where id = new.patient_id;

  if patient_clinic_id is null then
    raise exception 'Patient was not found.' using errcode = '23503';
  end if;

  if new.clinic_id is null then
    new.clinic_id := patient_clinic_id;
  end if;

  if new.clinic_id is distinct from patient_clinic_id then
    raise exception 'Record clinic must match patient clinic.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists treatment_plans_set_clinic_id on public.treatment_plans;
create trigger treatment_plans_set_clinic_id
  before insert or update of patient_id, clinic_id on public.treatment_plans
  for each row execute function public.set_patient_child_clinic_id();

drop trigger if exists packages_set_clinic_id on public.packages;
create trigger packages_set_clinic_id
  before insert or update of patient_id, clinic_id on public.packages
  for each row execute function public.set_patient_child_clinic_id();

drop trigger if exists payments_set_clinic_id on public.payments;
create trigger payments_set_clinic_id
  before insert or update of patient_id, clinic_id on public.payments
  for each row execute function public.set_patient_child_clinic_id();

drop policy if exists "clinics_read_same_clinic" on public.clinics;
create policy "clinics_read_same_clinic" on public.clinics
  for select
  using (public.is_same_clinic(id));

drop policy if exists "patients_staff_admin_access" on public.patients;
drop policy if exists "patients_tenant_staff_admin_access" on public.patients;
create policy "patients_tenant_staff_admin_access" on public.patients
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']));

drop policy if exists "doctors_staff_admin_access" on public.doctors;
drop policy if exists "doctors_tenant_staff_admin_access" on public.doctors;
create policy "doctors_tenant_staff_admin_access" on public.doctors
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']));

drop policy if exists "appointments_visibility_select" on public.appointments;
drop policy if exists "appointments_visibility_insert" on public.appointments;
drop policy if exists "appointments_visibility_update" on public.appointments;
drop policy if exists "appointments_visibility_delete" on public.appointments;

create policy "appointments_tenant_visibility_select" on public.appointments
  for select
  using (public.can_access_appointment(clinic_id, type, created_by, assigned_to));

create policy "appointments_tenant_visibility_insert" on public.appointments
  for insert
  with check (public.can_access_appointment(clinic_id, type, created_by, assigned_to));

create policy "appointments_tenant_visibility_update" on public.appointments
  for update
  using (public.can_access_appointment(clinic_id, type, created_by, assigned_to))
  with check (public.can_access_appointment(clinic_id, type, created_by, assigned_to));

create policy "appointments_tenant_visibility_delete" on public.appointments
  for delete
  using (public.can_access_appointment(clinic_id, type, created_by, assigned_to));

drop policy if exists "treatment_plans_staff_admin_access" on public.treatment_plans;
drop policy if exists "treatment_plans_tenant_staff_admin_access" on public.treatment_plans;
create policy "treatment_plans_tenant_staff_admin_access" on public.treatment_plans
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']));

drop policy if exists "session_notes_appointment_visibility" on public.session_notes;
create policy "session_notes_tenant_appointment_visibility" on public.session_notes
  for all
  using (
    exists (
      select 1
      from public.appointments appointment_row
      where appointment_row.id = session_notes.appointment_id
        and public.can_access_appointment(
          appointment_row.clinic_id,
          appointment_row.type,
          appointment_row.created_by,
          appointment_row.assigned_to
        )
    )
  )
  with check (
    exists (
      select 1
      from public.appointments appointment_row
      where appointment_row.id = session_notes.appointment_id
        and public.can_access_appointment(
          appointment_row.clinic_id,
          appointment_row.type,
          appointment_row.created_by,
          appointment_row.assigned_to
        )
    )
  );

drop policy if exists "packages_admin_access" on public.packages;
drop policy if exists "payments_admin_access" on public.payments;
drop policy if exists "appointment_payments_admin_access" on public.appointment_payments;
drop policy if exists "package_session_allocations_admin_access" on public.package_session_allocations;

create policy "packages_tenant_admin_access" on public.packages
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

create policy "payments_tenant_admin_access" on public.payments
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

create policy "appointment_payments_tenant_admin_access" on public.appointment_payments
  for all
  using (
    public.has_role(array['admin'])
    and exists (
      select 1 from public.payments payment_row
      where payment_row.id = appointment_payments.payment_id
        and public.is_same_clinic(payment_row.clinic_id)
    )
  )
  with check (
    public.has_role(array['admin'])
    and exists (
      select 1 from public.payments payment_row
      where payment_row.id = appointment_payments.payment_id
        and public.is_same_clinic(payment_row.clinic_id)
    )
  );

create policy "package_session_allocations_tenant_admin_access" on public.package_session_allocations
  for all
  using (
    public.has_role(array['admin'])
    and exists (
      select 1 from public.packages package_row
      where package_row.id = package_session_allocations.package_id
        and public.is_same_clinic(package_row.clinic_id)
    )
  )
  with check (
    public.has_role(array['admin'])
    and exists (
      select 1 from public.packages package_row
      where package_row.id = package_session_allocations.package_id
        and public.is_same_clinic(package_row.clinic_id)
    )
  );

drop policy if exists "global_settings_staff_admin_read" on public.global_settings;
drop policy if exists "global_settings_admin_write" on public.global_settings;
create policy "global_settings_tenant_staff_admin_read" on public.global_settings
  for select
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']));

create policy "global_settings_tenant_admin_write" on public.global_settings
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

drop policy if exists "profiles_read_self_or_admin" on public.profiles;
drop policy if exists "profiles_write_admin" on public.profiles;
drop policy if exists "profiles_read_staff_admin" on public.profiles;
create policy "profiles_tenant_read" on public.profiles
  for select
  using (
    id = auth.uid()
    or (
      public.is_same_clinic(clinic_id)
      and public.has_role(array['admin', 'staff'])
    )
  );

create policy "profiles_tenant_admin_write" on public.profiles
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

drop policy if exists "user_invites_admin_read" on public.user_invites;
drop policy if exists "user_invites_admin_write" on public.user_invites;
create policy "user_invites_tenant_admin_read" on public.user_invites
  for select
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

create policy "user_invites_tenant_admin_write" on public.user_invites
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

drop policy if exists "external_staff_read_staff_admin" on public.external_staff;
drop policy if exists "external_staff_write_admin" on public.external_staff;
create policy "external_staff_tenant_read_staff_admin" on public.external_staff
  for select
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']));

create policy "external_staff_tenant_write_admin" on public.external_staff
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

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
  target_clinic_id uuid;
  package_paid_amount numeric(10,2);
  package_total_amount numeric(10,2);
  new_payment_id uuid;
  linked_appointment_ids uuid[] := array[]::uuid[];
begin
  if not public.has_role(array['admin']) then
    raise exception 'You are not allowed to record payments.' using errcode = '42501';
  end if;

  select clinic_id into target_clinic_id
  from public.patients
  where id = p_patient_id;

  if target_clinic_id is null or not public.is_same_clinic(target_clinic_id) then
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
set search_path = public
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
  if not public.has_role(array['admin']) then
    raise exception 'You are not allowed to manage billing.' using errcode = '42501';
  end if;

  select clinic_id into target_clinic_id
  from public.patients
  where id = p_patient_id;

  if target_clinic_id is null or not public.is_same_clinic(target_clinic_id) then
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

    perform public.assign_patient_package_sessions(p_patient_id);
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

    perform public.allocate_patient_payment_credit(p_patient_id);

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

create or replace function public.approve_clinic_onboarding_request(
  p_request_id uuid,
  p_approved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.clinic_onboarding_requests%rowtype;
  new_clinic_id uuid;
begin
  select *
  into request_row
  from public.clinic_onboarding_requests
  where id = p_request_id
    and status = 'pending'
  for update;

  if request_row.id is null then
    raise exception 'Pending onboarding request was not found.' using errcode = '22023';
  end if;

  insert into public.clinics (name, phone, address, status)
  values (
    btrim(request_row.clinic_name),
    nullif(btrim(coalesce(request_row.clinic_phone, '')), ''),
    nullif(btrim(coalesce(request_row.clinic_address, '')), ''),
    'active'
  )
  returning id into new_clinic_id;

  insert into public.global_settings (clinic_id)
  values (new_clinic_id);

  insert into public.user_invites (
    clinic_id,
    email,
    role,
    status,
    invited_by,
    accepted_at,
    revoked_at
  )
  values (
    new_clinic_id,
    lower(btrim(request_row.owner_email)),
    'admin',
    'pending',
    p_approved_by,
    null,
    null
  );

  update public.clinic_onboarding_requests
  set
    status = 'approved',
    approved_by = p_approved_by,
    approved_at = now(),
    rejected_by = null,
    rejected_at = null,
    rejection_reason = null,
    clinic_id = new_clinic_id,
    updated_at = now()
  where id = p_request_id;

  return new_clinic_id;
end;
$$;

create or replace function public.reject_clinic_onboarding_request(
  p_request_id uuid,
  p_rejected_by uuid,
  p_rejection_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clinic_onboarding_requests
  set
    status = 'rejected',
    rejected_by = p_rejected_by,
    rejected_at = now(),
    rejection_reason = nullif(btrim(coalesce(p_rejection_reason, '')), ''),
    updated_at = now()
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'Pending onboarding request was not found.' using errcode = '22023';
  end if;
end;
$$;

grant execute on function public.record_payment(uuid, uuid, numeric, text, date, text) to authenticated;
grant execute on function public.record_billing_entry(uuid, text, text, integer, numeric, text, numeric, text, date, text) to authenticated;
grant execute on function public.approve_clinic_onboarding_request(uuid, uuid) to service_role;
grant execute on function public.reject_clinic_onboarding_request(uuid, uuid, text) to service_role;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant insert on public.clinic_onboarding_requests to anon;
grant usage, select on all sequences in schema public to authenticated;
