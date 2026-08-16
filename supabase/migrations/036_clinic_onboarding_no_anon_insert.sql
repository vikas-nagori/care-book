-- Remove the anonymous insert grant on clinic onboarding requests.
--
-- `clinic_onboarding_requests_public_insert` was created with `with check (true)` and no `to`
-- clause, so it applied to PUBLIC — including `anon`. The anon key is public by design, so
-- anyone could POST /rest/v1/clinic_onboarding_requests directly with arbitrary column values,
-- skipping the input validation, duplicate check and fingerprint throttle in
-- src/app/clinic-onboarding/actions.ts, and choosing their own `status`, `clinic_id`,
-- `request_ip` and `request_fingerprint`. There was no matching select policy, so nothing
-- leaked — the impact was unvalidated, unthrottled rows landing in the superadmin console.
--
-- The public onboarding form does not need this policy: createClinicOnboardingRequest inserts
-- through the service-role client (src/lib/supabase/admin.ts), which bypasses RLS entirely.
-- Dropping the policy therefore closes the direct PostgREST path and leaves the server action
-- as the only way in. RLS stays enabled, so with no insert policy every non-service-role
-- insert is denied — matching the table's existing read posture, which has no select policy
-- either and is served to the platform console through the service-role client.

drop policy if exists "clinic_onboarding_requests_public_insert" on public.clinic_onboarding_requests;

-- Belt and braces: revoke the table-level DML grants PostgREST relies on, so the table is not
-- reachable by `anon`/`authenticated` even if a future migration adds a permissive policy.
revoke all on table public.clinic_onboarding_requests from anon;
revoke insert, update, delete on table public.clinic_onboarding_requests from authenticated;
