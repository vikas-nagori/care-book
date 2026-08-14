begin;

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete restrict,
  add column if not exists deletion_reason text;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('active', 'blocked', 'deleted'));

alter table public.profiles drop constraint if exists profiles_soft_delete_audit_check;
alter table public.profiles add constraint profiles_soft_delete_audit_check check (
  (
    status = 'deleted'
    and deleted_at is not null
    and deleted_by is not null
    and nullif(btrim(deletion_reason), '') is not null
  )
  or (
    status <> 'deleted'
    and deleted_at is null
    and deleted_by is null
    and deletion_reason is null
  )
);

create or replace function private.guard_profile_soft_delete_lifecycle()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  request_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
begin
  if tg_op = 'DELETE' then
    if request_role not in ('service_role', 'supabase_auth_admin') then
      raise exception 'Profiles must be soft-deleted so audit history remains intact.' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.status = 'deleted' then
    if new is distinct from old then
      raise exception 'Soft-deleted profile lifecycle is immutable.' using errcode = '55000';
    end if;
    return new;
  end if;

  if new.status = 'deleted' and request_role <> 'service_role' then
    raise exception 'Only the service role can soft-delete a user.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_soft_delete_lifecycle on public.profiles;
create trigger profiles_guard_soft_delete_lifecycle
  before update or delete on public.profiles
  for each row execute function private.guard_profile_soft_delete_lifecycle();

revoke all on function private.guard_profile_soft_delete_lifecycle() from public, anon, authenticated;
grant execute on function private.guard_profile_soft_delete_lifecycle() to service_role;

create or replace function private.require_active_appointment_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1
    from public.profiles profile
    where profile.id = new.assigned_to
      and profile.clinic_id = new.clinic_id
      and profile.status = 'active'
  ) then
    raise exception 'Appointment must use an active assignee from the same clinic.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists zz_appointments_require_active_assignee on public.appointments;
create trigger zz_appointments_require_active_assignee
  before insert or update of assigned_to, clinic_id on public.appointments
  for each row execute function private.require_active_appointment_assignee();

revoke all on function private.require_active_appointment_assignee() from public, anon, authenticated;
grant execute on function private.require_active_appointment_assignee() to service_role;

commit;
