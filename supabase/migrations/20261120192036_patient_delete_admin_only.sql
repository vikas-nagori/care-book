-- Replace the broad FOR ALL policy: staff may manage patient details, but only
-- clinic admins may delete patients. Keep every operation scoped to an active clinic.
begin;

drop policy if exists patients_tenant_staff_admin_access on public.patients;

create policy patients_tenant_staff_admin_select on public.patients
  for select to authenticated
  using (
    clinic_id = (select private.current_clinic_id())
    and (select private.has_role(array['admin', 'staff']))
  );

create policy patients_tenant_staff_admin_insert on public.patients
  for insert to authenticated
  with check (
    clinic_id = (select private.current_clinic_id())
    and (select private.has_role(array['admin', 'staff']))
  );

create policy patients_tenant_staff_admin_update on public.patients
  for update to authenticated
  using (
    clinic_id = (select private.current_clinic_id())
    and (select private.has_role(array['admin', 'staff']))
  )
  with check (
    clinic_id = (select private.current_clinic_id())
    and (select private.has_role(array['admin', 'staff']))
  );

create policy patients_tenant_admin_delete on public.patients
  for delete to authenticated
  using (
    clinic_id = (select private.current_clinic_id())
    and (select private.has_role(array['admin']))
  );

commit;
