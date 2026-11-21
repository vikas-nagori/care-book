-- Lets middleware read the caller's role in the same round trip as the session check.
--
-- Middleware confines External Staff by role on every request. It used to look the role up
-- only after getUser() returned the user id: two sequential Supabase round trips on every
-- navigation, prefetch and server action. This function keys on auth.uid() instead, so the read
-- can run alongside getUser(). Security invoker: profiles RLS applies exactly as it did to the
-- direct select it replaces (a blocked account or inactive clinic reads back no row).

begin;

create function public.current_profile_role()
returns text language sql stable security invoker set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

revoke all on function public.current_profile_role() from public, anon, authenticated, service_role;
grant execute on function public.current_profile_role() to authenticated;

commit;
