-- Read-only, single-snapshot source for patient payment-due statements.
-- The application applies the regular-session period in TypeScript; this function returns all
-- completed appointment charges and complete package history so packages are never month-filtered.

create or replace function public.get_payment_due_statement_source_v1(p_patient_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, private
as $$
with current_patient as (
  select
    patient.id,
    patient.clinic_id,
    patient.name,
    clinic.name as clinic_name
  from public.patients patient
  join public.clinics clinic on clinic.id = patient.clinic_id
  where patient.id = p_patient_id
    and private.has_role(array['admin'])
    and private.is_same_clinic(patient.clinic_id)
),
appointment_source as (
  select
    appointment.id,
    appointment.date,
    appointment.time,
    appointment.type,
    appointment.status,
    charge.id as charge_id,
    charge.amount as charge_amount,
    charge.status as charge_status,
    allocation.package_id,
    allocation.lifecycle as package_lifecycle,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('amount', application.amount::text, 'status', application.status)
        order by application.applied_at, application.id
      )
      from public.payment_applications application
      where application.charge_id = charge.id
    ), '[]'::jsonb) as applications
  from public.appointments appointment
  join current_patient patient on patient.id = appointment.patient_id
  left join public.appointment_charges charge on charge.appointment_id = appointment.id
  left join lateral (
    select package_allocation.package_id, package_allocation.lifecycle
    from public.package_session_allocations package_allocation
    where package_allocation.appointment_id = appointment.id
      and package_allocation.lifecycle <> 'released'
    order by package_allocation.created_at, package_allocation.id
    limit 1
  ) allocation on true
  where appointment.status = 'completed'
),
package_source as (
  select
    package.id,
    package.name,
    package.created_at,
    package.total_amount as quote_amount,
    coalesce(balance.net_received, 0)::numeric(12,2) as net_received,
    package.total_sessions
  from public.packages package
  join current_patient patient on patient.id = package.patient_id
  left join public.package_billing_balances_v2 balance on balance.package_id = package.id
  where package.status <> 'cancelled'
)
select case when exists (select 1 from current_patient) then jsonb_build_object(
  'snapshotAt', transaction_timestamp(),
  'clinic', jsonb_build_object('name', (select clinic_name from current_patient)),
  'patient', jsonb_build_object(
    'id', (select id from current_patient),
    'name', (select name from current_patient)
  ),
  'appointments', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'date', date::text,
      'time', time::text,
      'type', type,
      'status', status,
      'chargeId', charge_id,
      'chargeAmount', charge_amount::text,
      'chargeStatus', charge_status,
      'packageId', package_id,
      'packageLifecycle', package_lifecycle,
      'applications', applications
    ) order by date, time, id)
    from appointment_source
  ), '[]'::jsonb),
  'packages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'createdAt', created_at,
      'quoteAmount', quote_amount::text,
      'netReceived', net_received::text,
      'totalSessions', total_sessions
    ) order by created_at, id)
    from package_source
  ), '[]'::jsonb)
) else null end;
$$;

revoke all on function public.get_payment_due_statement_source_v1(uuid) from public, anon;
grant execute on function public.get_payment_due_statement_source_v1(uuid) to authenticated;
