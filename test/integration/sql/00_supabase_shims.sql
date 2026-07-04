-- Supabase-compatibility shims so the production migrations apply on a vanilla local Postgres.
--
-- Supabase normally provides the `auth` schema, the `auth.uid()` / `auth.role()` helpers, and the
-- `anon` / `authenticated` / `service_role` platform roles. A bare local Postgres has none of them,
-- so the migrations (which grant to `authenticated`, reference `auth.users`, and call `auth.uid()`)
-- would fail to apply. This file recreates the minimal surface the migrations actually depend on.
-- It is applied BEFORE supabase/schema.sql and the migrations.

-- Platform roles (cluster-global). Each create is guarded against duplicate_object so concurrent
-- test databases building at the same time don't race on role creation.
do $$
begin
  begin create role anon nologin noinherit; exception when duplicate_object then null; end;
  begin create role authenticated nologin noinherit; exception when duplicate_object then null; end;
  begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end;
end
$$;

create schema if not exists auth;

-- Minimal auth.users: the migrations only read id + email (002 handle_new_user, 004 backfill).
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz default now()
);

-- auth.uid() / auth.role() mirror Supabase by reading the request JWT claims from session GUCs.
-- Tests set `request.jwt.claim.sub` / `.role` via set_config() to act as a given user.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;
