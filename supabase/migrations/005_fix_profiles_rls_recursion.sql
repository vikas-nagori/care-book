-- Repair recursive profiles RLS from the original role migration.
-- The old profiles_write_admin FOR ALL policy queried public.profiles inside its
-- own USING clause, which causes infinite recursion on SELECT under RLS.

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
      and role = any(allowed_roles)
  );
$$;

grant execute on function public.has_role(text[]) to authenticated;

drop policy if exists "profiles_read_authenticated" on public.profiles;
drop policy if exists "profiles_read_self_or_admin" on public.profiles;
drop policy if exists "profiles_write_admin" on public.profiles;

create policy "profiles_read_self_or_admin" on public.profiles
  for select
  using (id = auth.uid() or public.has_role(array['admin']));

create policy "profiles_write_admin" on public.profiles
  for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));
