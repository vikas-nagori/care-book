-- Legacy platform mutations must never be callable through anonymous/user Data API roles.
-- Current platform actions authenticate the operator and use the service-role client.
revoke execute on function public.approve_clinic_onboarding_request(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.reject_clinic_onboarding_request(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.approve_clinic_onboarding_request(uuid, uuid)
  to service_role;
grant execute on function public.reject_clinic_onboarding_request(uuid, uuid, text)
  to service_role;
