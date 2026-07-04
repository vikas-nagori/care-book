-- Prefer fee-matched appointments when filling a package's session slots.
--
-- The original assign_patient_package_sessions (009) claimed a patient's earliest
-- fee > 0 appointments into a package purely by date, ignoring the package's
-- per_session_amount. A "10 home visits @ ₹800" package could therefore consume two
-- earlier ₹500 clinic visits as package sessions, leaving the home visits it was meant
-- for uncovered.
--
-- A package is a flat-price entitlement to N sessions (its total_amount is a fixed price,
-- independent of the per-appointment fees it claims). To keep a package claiming sessions
-- priced like itself, this redefinition orders candidate appointments so those whose fee
-- equals the package's per_session_amount are claimed first, falling back to the previous
-- date-order behaviour when none match. Only the inner ORDER BY changes vs. 009.

create or replace function public.assign_patient_package_sessions(target_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  package_row record;
  appointment_row record;
  remaining_slots integer;
begin
  delete from public.package_session_allocations allocation_row
  using public.appointments appointment_row
  where appointment_row.id = allocation_row.appointment_id
    and appointment_row.patient_id = target_patient_id
    and appointment_row.status not in ('scheduled', 'completed');

  for package_row in
    select *
    from public.packages
    where patient_id = target_patient_id
      and status = 'active'
    order by created_at, id
  loop
    perform public.reconcile_package_usage(package_row.id);

    select greatest(package_row.total_sessions - count(appointment_row.id)::integer, 0)
    into remaining_slots
    from public.package_session_allocations allocation_row
    join public.appointments appointment_row
      on appointment_row.id = allocation_row.appointment_id
    where allocation_row.package_id = package_row.id
      and appointment_row.status in ('scheduled', 'completed');

    if remaining_slots <= 0 then
      continue;
    end if;

    for appointment_row in
      select appointment_row.*
      from public.appointments appointment_row
      where appointment_row.patient_id = target_patient_id
        and appointment_row.status in ('completed', 'scheduled')
        and coalesce(appointment_row.fee, 0) > 0
        and not exists (
          select 1
          from public.package_session_allocations existing_allocation
          where existing_allocation.appointment_id = appointment_row.id
        )
      order by
        case when appointment_row.fee = package_row.per_session_amount then 0 else 1 end,
        appointment_row.date,
        appointment_row.time,
        appointment_row.id
      limit remaining_slots
    loop
      insert into public.package_session_allocations (package_id, appointment_id)
      values (package_row.id, appointment_row.id)
      on conflict (appointment_id) do nothing;
    end loop;

    perform public.reconcile_package_usage(package_row.id);
  end loop;
end;
$$;
