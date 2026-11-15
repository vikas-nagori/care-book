-- Evaluate appointment visibility once per statement instead of once per row.
--
-- 20261114144100_tenant_policy_initplans moved every bare has_role()/current_clinic_id() call into
-- an InitPlan, but the appointments and session_notes policies were left calling
-- can_access_appointment(clinic_id, type_is_shared, created_by, assigned_to). Because it takes row
-- columns, Postgres must call it per row, and as a SECURITY DEFINER function with a pinned
-- search_path it can never be inlined — so each candidate appointment paid for three profiles ⨝
-- clinics lookups (is_same_clinic + two has_role). Reading a clinic's ~900 billable appointments
-- took ~500 ms in production versus ~1.5 ms with the expression below, and appointments back the
-- dashboard, schedule, billing, patient detail, session notes and the booking conflict check.
--
-- Equivalence with private.can_access_appointment(clinic, shared, creator, assignee), which is
--   is_same_clinic(clinic) and (has_role('{admin}') or (has_role('{staff}') and (shared or creator =
--   auth.uid() or assignee = auth.uid())))
-- and is_same_clinic(x) is `x is not null and x = current_clinic_id()`:
--   * every helper depends only on the caller, so hoisting it into a scalar subquery cannot change
--     its value within a statement;
--   * `clinic_id = (select current_clinic_id())` is NULL rather than false when either side is NULL,
--     and RLS treats NULL exactly like false in both USING and WITH CHECK; the remaining terms are
--     unchanged, so every policy admits exactly the same rows for every caller.
-- can_access_appointment itself is kept: RPCs and the booking path still call it.
--
-- get_billed_month_totals_v1 had the same shape (a bare private.has_role per appointment); it now
-- evaluates the admin check once. Signature, volatility, security and grants are unchanged
-- (`create or replace` preserves the ACL).

alter policy appointments_tenant_visibility_select on public.appointments using (
  clinic_id = (select public.current_clinic_id())
  and (
    (select public.has_role(array['admin']))
    or (
      (select public.has_role(array['staff']))
      and (type_is_shared or created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
    )
  )
);

alter policy appointments_tenant_visibility_insert on public.appointments with check (
  clinic_id = (select public.current_clinic_id())
  and (
    (select public.has_role(array['admin']))
    or (
      (select public.has_role(array['staff']))
      and (type_is_shared or created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
    )
  )
);

alter policy appointments_tenant_visibility_update on public.appointments
  using (
    clinic_id = (select public.current_clinic_id())
    and (
      (select public.has_role(array['admin']))
      or (
        (select public.has_role(array['staff']))
        and (type_is_shared or created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
      )
    )
  )
  with check (
    clinic_id = (select public.current_clinic_id())
    and (
      (select public.has_role(array['admin']))
      or (
        (select public.has_role(array['staff']))
        and (type_is_shared or created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
      )
    )
  );

alter policy appointments_tenant_visibility_delete on public.appointments using (
  clinic_id = (select public.current_clinic_id())
  and (
    (select public.has_role(array['admin']))
    or (
      (select public.has_role(array['staff']))
      and (type_is_shared or created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
    )
  )
);

alter policy session_notes_tenant_appointment_visibility on public.session_notes
  using (
    exists (
      select 1
      from public.appointments appointment_row
      where appointment_row.id = session_notes.appointment_id
        and appointment_row.clinic_id = (select public.current_clinic_id())
        and (
          (select public.has_role(array['admin']))
          or (
            (select public.has_role(array['staff']))
            and (
              appointment_row.type_is_shared
              or appointment_row.created_by = (select auth.uid())
              or appointment_row.assigned_to = (select auth.uid())
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.appointments appointment_row
      where appointment_row.id = session_notes.appointment_id
        and appointment_row.clinic_id = (select public.current_clinic_id())
        and (
          (select public.has_role(array['admin']))
          or (
            (select public.has_role(array['staff']))
            and (
              appointment_row.type_is_shared
              or appointment_row.created_by = (select auth.uid())
              or appointment_row.assigned_to = (select auth.uid())
            )
          )
        )
    )
  );

create or replace function public.get_billed_month_totals_v1(p_till_day integer default null)
returns table (
  month text,
  appointment_type text,
  amount numeric,
  session_count bigint
)
language sql
stable
security invoker
set search_path = public, private
as $$
  select
    to_char(appointment.date, 'YYYY-MM') as month,
    coalesce(nullif(btrim(appointment.type), ''), 'Untyped') as appointment_type,
    coalesce(sum(appointment.fee), 0)::numeric(12,2) as amount,
    count(*) as session_count
  from public.appointments appointment
  where appointment.status = 'completed'
    and (select private.has_role(array['admin']))
    and (p_till_day is null or extract(day from appointment.date) <= p_till_day)
  group by 1, 2;
$$;
