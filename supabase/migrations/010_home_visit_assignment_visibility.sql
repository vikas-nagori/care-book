-- Allow staff to see all clinic appointments and only their own assigned/created home visits.

alter table public.appointments
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create index if not exists idx_appointments_created_by
  on public.appointments(created_by);

create index if not exists idx_appointments_assigned_to
  on public.appointments(assigned_to);

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
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_set_creator on public.appointments;
create trigger appointments_set_creator
  before insert or update of type, assigned_to on public.appointments
  for each row
  execute function public.set_appointment_creator();

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
  select
    public.has_role(array['admin'])
    or (
      public.has_role(array['staff'])
      and (
        appointment_type = 'clinic'
        or appointment_created_by = auth.uid()
        or appointment_assigned_to = auth.uid()
      )
    );
$$;

grant execute on function public.can_access_appointment(text, uuid, uuid) to authenticated;

drop policy if exists "Authenticated users can do anything" on public.appointments;
drop policy if exists "appointments_staff_admin_access" on public.appointments;
drop policy if exists "appointments_visibility_select" on public.appointments;
drop policy if exists "appointments_visibility_insert" on public.appointments;
drop policy if exists "appointments_visibility_update" on public.appointments;
drop policy if exists "appointments_visibility_delete" on public.appointments;

create policy "appointments_visibility_select" on public.appointments
  for select
  using (public.can_access_appointment(type, created_by, assigned_to));

create policy "appointments_visibility_insert" on public.appointments
  for insert
  with check (public.can_access_appointment(type, created_by, assigned_to));

create policy "appointments_visibility_update" on public.appointments
  for update
  using (public.can_access_appointment(type, created_by, assigned_to))
  with check (public.can_access_appointment(type, created_by, assigned_to));

create policy "appointments_visibility_delete" on public.appointments
  for delete
  using (public.can_access_appointment(type, created_by, assigned_to));

drop policy if exists "Authenticated users can do anything" on public.session_notes;
drop policy if exists "session_notes_staff_admin_access" on public.session_notes;
drop policy if exists "session_notes_appointment_visibility" on public.session_notes;

create policy "session_notes_appointment_visibility" on public.session_notes
  for all
  using (
    exists (
      select 1
      from public.appointments appointment_row
      where appointment_row.id = session_notes.appointment_id
        and public.can_access_appointment(
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
          appointment_row.type,
          appointment_row.created_by,
          appointment_row.assigned_to
        )
    )
  );

drop policy if exists "profiles_read_authenticated" on public.profiles;
drop policy if exists "profiles_read_self_or_admin" on public.profiles;
drop policy if exists "profiles_read_staff_admin" on public.profiles;

create policy "profiles_read_staff_admin" on public.profiles
  for select
  using (public.has_role(array['admin', 'staff']));

-- ===== formerly 010_make_phone_optional.sql (merged for a unique local migration version) =====
-- Make phone number optional on patients table
ALTER TABLE patients ALTER COLUMN phone DROP NOT NULL;
