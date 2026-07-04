-- Add invite-based onboarding with name and mobile capture.

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists mobile_number text;

create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null check (role in ('admin', 'staff')),
  status text not null check (status in ('pending', 'accepted', 'revoked')) default 'pending',
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_invites_email_unique
  on public.user_invites (lower(email));

create index if not exists user_invites_status_created_at_idx
  on public.user_invites (status, created_at desc);

alter table public.user_invites enable row level security;

drop policy if exists "user_invites_admin_read" on public.user_invites;
drop policy if exists "user_invites_admin_write" on public.user_invites;

create policy "user_invites_admin_read" on public.user_invites
  for select
  using (public.has_role(array['admin']));

create policy "user_invites_admin_write" on public.user_invites
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));
