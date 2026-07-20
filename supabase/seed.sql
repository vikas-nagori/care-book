-- Local-stack seed, run after migrations on `supabase db reset` / first `supabase start`.
--
-- Migrations 027 and 028 add RLS-protected tables after the original application grants in
-- migration 019. Hosted Supabase applies role defaults, while a clean local reset does not.
-- Keep the local role grants explicit: application roles get ordinary row DML (RLS still
-- applies), and the service-role seed/factory harness gets the same DML without broad table,
-- sequence, or function ownership privileges.

grant usage on schema public to service_role;

-- Local role defaults include ownership-style capabilities that bypass the intended row/RLS
-- access model. Neither the app nor the E2E harness needs them.
revoke truncate, references, trigger, maintain on all tables in schema public
from anon, authenticated, service_role;
revoke update on all sequences in schema public from anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.appointment_payments,
  public.appointment_types,
  public.appointments,
  public.clinic_onboarding_requests,
  public.clinics,
  public.doctors,
  public.external_staff,
  public.global_settings,
  public.package_session_allocations,
  public.package_templates,
  public.packages,
  public.patients,
  public.payments,
  public.profiles,
  public.session_notes,
  public.treatment_plans,
  public.user_invites
to service_role;

grant select, insert, update, delete on table
  public.appointment_types,
  public.package_templates
to authenticated;

grant usage, select on sequence public.global_settings_id_seq to authenticated, service_role;

grant execute on function public.approve_clinic_onboarding_request(uuid, uuid) to service_role;
grant execute on function public.reject_clinic_onboarding_request(uuid, uuid, text) to service_role;
