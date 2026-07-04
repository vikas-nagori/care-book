-- Superadmin (platform admin) org/user management: user block status.
--
-- Clinic (org) blocking reuses the existing public.clinics.status column
-- ('active' | 'inactive') from migration 019. This migration adds a matching
-- per-user block flag on profiles. Enforcement is done at the auth layer via
-- Supabase Auth bans (see src/app/platform/*/actions.ts); these columns are the
-- source of truth the superadmin console reads for display and for composing
-- clinic-block vs user-block state.

alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'blocked'));

update public.profiles set status = 'active' where status is null;

create index if not exists profiles_status_idx on public.profiles(status);
