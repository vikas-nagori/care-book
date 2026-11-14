-- Evaluate tenant/role RLS helpers once per statement instead of once per row.
--
-- has_role(...) and current_clinic_id() depend only on the caller (auth.uid()), yet called bare
-- inside a policy they run per candidate row, and each call joins profiles + clinics. The billing
-- balance views fan out over appointment_charges/payments/payment_applications/refunds per patient,
-- so a clinic with ~100 patients paid for thousands of helper calls on every billing page load
-- (1–3 s in production). Wrapping them in scalar subqueries turns them into InitPlans.
--
-- Equivalence: is_same_clinic(x) is `x is not null and x = current_clinic_id()`. The rewrite
-- `x = (select current_clinic_id())` yields NULL instead of false when x or the caller's clinic is
-- NULL, and RLS treats NULL exactly like false in both USING and WITH CHECK, so every policy admits
-- the same rows. Each policy keeps the schema (public vs private) of the helpers it already used.

-- Billing ledger v2 (admin-only reads).
alter policy appointment_charge_adjustments_tenant_admin_read_v2 on public.appointment_charge_adjustments
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));
alter policy appointment_charges_tenant_admin_read_v2 on public.appointment_charges
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));
alter policy billing_events_tenant_admin_read_v2 on public.billing_events
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));
alter policy appointment_payments_tenant_admin_read_v2 on public.appointment_payments using (
  (select private.has_role(array['admin']))
  and exists (select 1 from public.payments payment
    where payment.id = appointment_payments.payment_id
      and payment.clinic_id = (select private.current_clinic_id()))
);
alter policy package_session_allocations_tenant_admin_read_v2 on public.package_session_allocations
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));
alter policy packages_tenant_admin_read_v2 on public.packages
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));
alter policy payment_applications_tenant_admin_read_v2 on public.payment_applications
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));
alter policy payments_tenant_admin_read_v2 on public.payments
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));
alter policy refund_reversals_tenant_admin_read_v2 on public.refund_reversals
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));
alter policy refunds_tenant_admin_read_v2 on public.refunds
  using ((select private.has_role(array['admin'])) and clinic_id = (select private.current_clinic_id()));

-- Clinic-scoped reference and clinical tables.
alter policy clinics_read_same_clinic on public.clinics
  using (id = (select public.current_clinic_id()));
alter policy patients_tenant_staff_admin_access on public.patients
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])));
alter policy treatment_plans_tenant_staff_admin_access on public.treatment_plans
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])));
alter policy doctors_tenant_staff_admin_access on public.doctors
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])));
alter policy appointment_types_tenant_read_staff_admin on public.appointment_types
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])));
alter policy appointment_types_tenant_write_admin on public.appointment_types
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin'])))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin'])));
alter policy external_staff_tenant_read_staff_admin on public.external_staff
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])));
alter policy external_staff_tenant_write_admin on public.external_staff
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin'])))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin'])));
alter policy global_settings_tenant_staff_admin_read on public.global_settings
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])));
alter policy global_settings_tenant_admin_write on public.global_settings
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin'])))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin'])));
alter policy package_templates_tenant_read_staff_admin on public.package_templates
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin', 'staff'])));
alter policy package_templates_tenant_write_admin on public.package_templates
  using (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin'])))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.has_role(array['admin'])));

alter policy mcp_invocations_select_own_or_clinic_admin on public.mcp_tool_invocations using (
  user_id = (select auth.uid())
  or ((select public.has_role(array['admin'])) and clinic_id = (select public.current_clinic_id()))
);

-- Profiles, invites, reminders (private helpers).
alter policy profiles_tenant_read on public.profiles using (
  (id = (select auth.uid()) and status = 'active' and clinic_id = (select private.current_clinic_id()))
  or (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin', 'staff'])))
);
alter policy profiles_tenant_admin_write on public.profiles
  using (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin'])))
  with check (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin'])));
alter policy user_invites_tenant_admin_read on public.user_invites
  using (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin'])));
alter policy user_invites_tenant_admin_write on public.user_invites
  using (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin'])))
  with check (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin'])));
alter policy reminders_read on public.reminders
  using (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin', 'staff'])));
alter policy reminders_create on public.reminders with check (
  clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin', 'staff']))
  and created_by = (select auth.uid())
);
alter policy reminders_update on public.reminders
  using (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin', 'staff'])))
  with check (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin', 'staff'])));
alter policy reminders_delete on public.reminders
  using (clinic_id = (select private.current_clinic_id()) and (select private.has_role(array['admin', 'staff'])));
