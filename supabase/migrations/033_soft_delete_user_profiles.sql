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

create or replace function private.is_disposable_e2e_identity(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = auth, pg_temp
as $$
  select coalesce((
    select lower(coalesce(email, '')) like '%@carebook.test'
      and raw_app_meta_data #>> '{carebook_e2e_cleanup,state}' = 'requested'
      and nullif(btrim(raw_app_meta_data #>> '{carebook_e2e_cleanup,reason}'), '') is not null
    from auth.users
    where id = p_user_id
  ), false);
$$;

create or replace function private.user_has_retained_history(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.packages where cancelled_by = p_user_id)
    or exists (select 1 from public.payments where voided_by = p_user_id)
    or exists (select 1 from public.billing_events where actor_id = p_user_id)
    or exists (select 1 from public.appointment_charge_adjustments where created_by = p_user_id)
    or exists (select 1 from public.refunds where created_by = p_user_id)
    or exists (select 1 from public.refund_reversals where created_by = p_user_id)
    or exists (select 1 from public.profiles where deleted_by = p_user_id)
    or exists (
      select 1 from public.appointments
      where created_by = p_user_id or assigned_to = p_user_id
    )
    or exists (
      select 1 from public.external_staff
      where created_by = p_user_id or linked_profile_id = p_user_id
    )
    or exists (select 1 from public.doctors where created_by = p_user_id)
    or exists (
      select 1 from public.clinic_onboarding_requests
      where approved_by = p_user_id or rejected_by = p_user_id
    )
    or exists (
      select 1 from public.user_invites
      where auth_user_id = p_user_id or invited_by = p_user_id
    );
$$;

create or replace function private.guard_profile_soft_delete_lifecycle()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none'),
    session_user
  );
  validated_cascade_id text := nullif(current_setting('carebook.validated_e2e_cleanup_user', true), '');
begin
  if tg_op = 'DELETE' then
    if request_role not in ('service_role', 'supabase_auth_admin')
      or not (
        (
          pg_trigger_depth() > 1
          and validated_cascade_id is not distinct from old.id::text
        )
        or private.is_disposable_e2e_identity(old.id)
      )
      or private.user_has_retained_history(old.id)
    then
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

create or replace function private.guard_auth_user_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = auth, public, private, pg_temp
as $$
declare
  request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none'),
    session_user
  );
begin
  if request_role not in ('service_role', 'supabase_auth_admin')
    or not private.is_disposable_e2e_identity(old.id)
    or private.user_has_retained_history(old.id)
  then
    raise exception 'Production identities cannot be hard-deleted; use audited soft deletion.' using errcode = '42501';
  end if;

  perform set_config('carebook.validated_e2e_cleanup_user', old.id::text, true);
  return old;
end;
$$;

drop trigger if exists users_guard_hard_delete on auth.users;
create trigger users_guard_hard_delete
  before delete on auth.users
  for each row execute function private.guard_auth_user_hard_delete();

revoke all on function private.is_disposable_e2e_identity(uuid) from public, anon, authenticated;
revoke all on function private.user_has_retained_history(uuid) from public, anon, authenticated;
revoke all on function private.guard_auth_user_hard_delete() from public, anon, authenticated;
grant execute on function private.is_disposable_e2e_identity(uuid) to service_role;
grant execute on function private.user_has_retained_history(uuid) to service_role;
grant execute on function private.guard_auth_user_hard_delete() to service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.is_disposable_e2e_identity(uuid) to supabase_auth_admin;
grant execute on function private.user_has_retained_history(uuid) to supabase_auth_admin;

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
