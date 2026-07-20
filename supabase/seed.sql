-- Local-stack seed, run after migrations on `supabase db reset` / first `supabase start`.
--
-- Our migrations grant table access to `authenticated` but not to `service_role`. A hosted
-- Supabase project grants service_role via default privileges; the local stack does not, so the
-- E2E seed harness (which uses the service-role key to create clinics/users/patients before any
-- spec) hits "permission denied". Grant it here. RLS is unaffected — service_role bypasses RLS
-- by design, and this file only runs against the local development stack.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
