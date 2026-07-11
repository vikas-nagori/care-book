-- Admin-configurable appointment types (replaces the hardcoded 'clinic' | 'home_visit').
--
-- Each clinic gets a per-type session rate and an is_shared flag that carries the
-- visibility/assignability semantics the magic string 'clinic' used to encode:
--   is_shared = true  → visible to all staff, no assignee (like the old 'clinic')
--   is_shared = false → visible to creator/assignee only, assignable (like 'home_visit')
--
-- appointments.appointment_type_id is the source of truth; appointments.type (now a
-- free label) and appointments.type_is_shared are denormalized copies kept in sync by
-- the set_appointment_creator trigger, so the display code reads appt.type directly and
-- the RLS .or() filter can key off type_is_shared without a join.

-- 1. Appointment types table --------------------------------------------------
create table if not exists public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  session_rate numeric(10,2) not null default 0 check (session_rate >= 0),
  is_shared boolean not null default false,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create index if not exists appointment_types_clinic_idx
  on public.appointment_types (clinic_id, sort_order);

alter table public.appointment_types enable row level security;

drop policy if exists "appointment_types_tenant_read_staff_admin" on public.appointment_types;
drop policy if exists "appointment_types_tenant_write_admin" on public.appointment_types;

create policy "appointment_types_tenant_read_staff_admin" on public.appointment_types
  for select
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin', 'staff']));

create policy "appointment_types_tenant_write_admin" on public.appointment_types
  for all
  using (public.is_same_clinic(clinic_id) and public.has_role(array['admin']))
  with check (public.is_same_clinic(clinic_id) and public.has_role(array['admin']));

-- 2. Seed the two defaults for existing clinics, rate sourced from global_settings ----
insert into public.appointment_types (clinic_id, name, session_rate, is_shared, is_default, sort_order)
select c.id, 'Clinic Visit', coalesce(gs.clinic_fee, 0), true, true, 0
from public.clinics c
left join public.global_settings gs on gs.clinic_id = c.id
on conflict (clinic_id, name) do nothing;

insert into public.appointment_types (clinic_id, name, session_rate, is_shared, is_default, sort_order)
select c.id, 'Home Visit', coalesce(gs.home_visit_fee, 0), false, true, 1
from public.clinics c
left join public.global_settings gs on gs.clinic_id = c.id
on conflict (clinic_id, name) do nothing;

-- 3. Extend appointments ------------------------------------------------------
alter table public.appointments drop constraint if exists appointments_type_check;

alter table public.appointments
  add column if not exists appointment_type_id uuid references public.appointment_types(id) on delete restrict,
  add column if not exists type_is_shared boolean not null default false;

-- 4. Backfill existing appointments from the legacy slug ----------------------
update public.appointments a
set appointment_type_id = at.id,
    type_is_shared = at.is_shared
from public.appointment_types at
where at.clinic_id = a.clinic_id
  and at.name = case a.type when 'clinic' then 'Clinic Visit' when 'home_visit' then 'Home Visit' else a.type end
  and a.appointment_type_id is null;

-- Denormalize the human-readable label onto the row (was 'clinic' / 'home_visit').
update public.appointments a
set type = at.name
from public.appointment_types at
where at.id = a.appointment_type_id;

alter table public.appointments alter column appointment_type_id set not null;

create index if not exists appointments_type_id_idx on public.appointments (appointment_type_id);

-- 5. set_appointment_creator: resolve type + denormalize name/visibility ------
-- Accepts either appointment_type_id (new path) or a legacy type slug/name (old
-- inserts / tests), resolving one from the other so both keep working.
create or replace function public.set_appointment_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_clinic_id uuid;
  resolved_type_id uuid;
  resolved_name text;
  resolved_is_shared boolean;
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

  if new.appointment_type_id is not null then
    select id, name, is_shared
    into resolved_type_id, resolved_name, resolved_is_shared
    from public.appointment_types
    where id = new.appointment_type_id and clinic_id = new.clinic_id;

    if resolved_type_id is null then
      raise exception 'Appointment type does not belong to the appointment clinic.' using errcode = '23503';
    end if;
  else
    -- Backward-compatible resolution from the legacy slug or a type name.
    select id, name, is_shared
    into resolved_type_id, resolved_name, resolved_is_shared
    from public.appointment_types
    where clinic_id = new.clinic_id
      and (
        name = new.type
        or (new.type = 'clinic' and lower(name) = 'clinic visit')
        or (new.type = 'home_visit' and lower(name) = 'home visit')
      )
    order by sort_order
    limit 1;

    if resolved_type_id is null then
      raise exception 'Appointment type % was not found for this clinic.', coalesce(new.type, '(null)') using errcode = '23503';
    end if;
  end if;

  new.appointment_type_id := resolved_type_id;
  new.type := resolved_name;
  new.type_is_shared := resolved_is_shared;

  if resolved_is_shared then
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
  before insert or update of patient_id, type, appointment_type_id, assigned_to, external_staff_id, clinic_id on public.appointments
  for each row
  execute function public.set_appointment_creator();

-- 6. Propagate type renames / visibility changes to existing appointments -----
create or replace function public.propagate_appointment_type_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name or new.is_shared is distinct from old.is_shared then
    update public.appointments
    set type = new.name,
        type_is_shared = new.is_shared,
        assigned_to = case when new.is_shared then null else assigned_to end,
        external_staff_id = case when new.is_shared then null else external_staff_id end
    where appointment_type_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists appointment_types_propagate on public.appointment_types;
create trigger appointment_types_propagate
  after update of name, is_shared on public.appointment_types
  for each row
  execute function public.propagate_appointment_type_change();

-- 7. Seed the two defaults for every new clinic ------------------------------
-- Fires on clinic creation so a clinic always has its default types (rate 0;
-- admins set rates in Settings). Existing clinics were seeded in step 2 above.
create or replace function public.seed_default_appointment_types()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.appointment_types (clinic_id, name, session_rate, is_shared, is_default, sort_order)
  values
    (new.id, 'Clinic Visit', 0, true, true, 0),
    (new.id, 'Home Visit', 0, false, true, 1)
  on conflict (clinic_id, name) do nothing;
  return new;
end;
$$;

drop trigger if exists clinics_seed_appointment_types on public.clinics;
create trigger clinics_seed_appointment_types
  after insert on public.clinics
  for each row
  execute function public.seed_default_appointment_types();

-- 8. Re-key visibility off is_shared instead of the 'clinic' magic string -----
create or replace function private.can_access_appointment(
  appointment_clinic_id uuid,
  appointment_is_shared boolean,
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
          appointment_is_shared
          or appointment_created_by = auth.uid()
          or appointment_assigned_to = auth.uid()
        )
      )
    );
$$;

create or replace function public.can_access_appointment(
  appointment_clinic_id uuid,
  appointment_is_shared boolean,
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
    appointment_is_shared,
    appointment_created_by,
    appointment_assigned_to
  );
$$;

-- Convenience overloads that assume the caller's own clinic.
create or replace function private.can_access_appointment(
  appointment_is_shared boolean,
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
    appointment_is_shared,
    appointment_created_by,
    appointment_assigned_to
  );
$$;

create or replace function public.can_access_appointment(
  appointment_is_shared boolean,
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
    appointment_is_shared,
    appointment_created_by,
    appointment_assigned_to
  );
$$;

-- Repoint appointment policies to the boolean overload.
drop policy if exists "appointments_tenant_visibility_select" on public.appointments;
drop policy if exists "appointments_tenant_visibility_insert" on public.appointments;
drop policy if exists "appointments_tenant_visibility_update" on public.appointments;
drop policy if exists "appointments_tenant_visibility_delete" on public.appointments;

create policy "appointments_tenant_visibility_select" on public.appointments
  for select
  using (public.can_access_appointment(clinic_id, type_is_shared, created_by, assigned_to));

create policy "appointments_tenant_visibility_insert" on public.appointments
  for insert
  with check (public.can_access_appointment(clinic_id, type_is_shared, created_by, assigned_to));

create policy "appointments_tenant_visibility_update" on public.appointments
  for update
  using (public.can_access_appointment(clinic_id, type_is_shared, created_by, assigned_to))
  with check (public.can_access_appointment(clinic_id, type_is_shared, created_by, assigned_to));

create policy "appointments_tenant_visibility_delete" on public.appointments
  for delete
  using (public.can_access_appointment(clinic_id, type_is_shared, created_by, assigned_to));

drop policy if exists "session_notes_tenant_appointment_visibility" on public.session_notes;
create policy "session_notes_tenant_appointment_visibility" on public.session_notes
  for all
  using (
    exists (
      select 1
      from public.appointments appointment_row
      where appointment_row.id = session_notes.appointment_id
        and public.can_access_appointment(
          appointment_row.clinic_id,
          appointment_row.type_is_shared,
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
          appointment_row.type_is_shared,
          appointment_row.created_by,
          appointment_row.assigned_to
        )
    )
  );

-- Drop the superseded text-based overloads now that nothing references them.
drop function if exists public.can_access_appointment(uuid, text, uuid, uuid);
drop function if exists public.can_access_appointment(text, uuid, uuid);
drop function if exists private.can_access_appointment(uuid, text, uuid, uuid);
drop function if exists private.can_access_appointment(text, uuid, uuid);

revoke all on function public.can_access_appointment(uuid, boolean, uuid, uuid) from public, anon;
revoke all on function public.can_access_appointment(boolean, uuid, uuid) from public, anon;
grant execute on function private.can_access_appointment(uuid, boolean, uuid, uuid) to authenticated, service_role;
grant execute on function private.can_access_appointment(boolean, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_access_appointment(uuid, boolean, uuid, uuid) to authenticated;
grant execute on function public.can_access_appointment(boolean, uuid, uuid) to authenticated;
