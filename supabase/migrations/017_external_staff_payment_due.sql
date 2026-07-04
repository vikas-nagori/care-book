-- Add reusable external staff records and allow home-visit appointments to reference them.

create table if not exists public.external_staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  notes text,
  status text not null default 'active' check (status in ('active', 'onboarded', 'inactive')),
  linked_profile_id uuid references public.profiles(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_staff_name_present check (length(btrim(name)) > 0),
  constraint external_staff_phone_present check (length(btrim(phone)) > 0),
  constraint external_staff_email_present_when_set check (email is null or length(btrim(email)) > 0)
);

create index if not exists external_staff_status_created_at_idx
  on public.external_staff(status, created_at desc);

create index if not exists external_staff_linked_profile_id_idx
  on public.external_staff(linked_profile_id);

create unique index if not exists external_staff_email_unique
  on public.external_staff(lower(email))
  where email is not null;

alter table public.external_staff enable row level security;

drop policy if exists "external_staff_read_staff_admin" on public.external_staff;
drop policy if exists "external_staff_write_admin" on public.external_staff;

create policy "external_staff_read_staff_admin" on public.external_staff
  for select
  using (public.has_role(array['admin', 'staff']));

create policy "external_staff_write_admin" on public.external_staff
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));

alter table public.appointments
  add column if not exists external_staff_id uuid references public.external_staff(id) on delete set null;

create index if not exists idx_appointments_external_staff_id
  on public.appointments(external_staff_id);

alter table public.user_invites
  add column if not exists external_staff_id uuid references public.external_staff(id) on delete set null;

create index if not exists user_invites_external_staff_id_idx
  on public.user_invites(external_staff_id);

create or replace function public.set_appointment_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
  before insert or update of type, assigned_to, external_staff_id on public.appointments
  for each row
  execute function public.set_appointment_creator();

create or replace function public.touch_external_staff_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists external_staff_updated_at on public.external_staff;
create trigger external_staff_updated_at
  before update on public.external_staff
  for each row execute function public.touch_external_staff_updated_at();
