-- auth.uid() is request-invariant. Scalar subqueries let Postgres compute it once;
-- all tenant, role, ownership, USING and WITH CHECK predicates stay equivalent.
alter policy profiles_tenant_read on public.profiles using (
  (id = (select auth.uid()) and status = 'active' and clinic_id = private.current_clinic_id())
  or (private.is_same_clinic(clinic_id) and private.has_role(array['admin', 'staff']))
);
alter policy mcp_clients_select_linked on public.mcp_oauth_clients using (
  exists (select 1 from public.mcp_access_grants grant_row
    where grant_row.client_id = mcp_oauth_clients.client_id
      and grant_row.user_id = (select auth.uid()))
);
alter policy mcp_grants_select_own on public.mcp_access_grants
  using (user_id = (select auth.uid()));
alter policy mcp_grants_revoke_own on public.mcp_access_grants
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy mcp_invocations_select_own_or_clinic_admin on public.mcp_tool_invocations using (
  user_id = (select auth.uid())
  or (public.has_role(array['admin']) and public.is_same_clinic(clinic_id))
);
alter policy reminders_create on public.reminders with check (
  private.is_same_clinic(clinic_id) and private.has_role(array['admin', 'staff'])
  and created_by = (select auth.uid())
);
