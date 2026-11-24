-- Patient age in whole years.
--
-- The patient form now asks for Age instead of a date of birth. An age alone goes stale, so it is
-- stored with the IST day it was entered; the app shows age_years plus the whole years elapsed
-- since age_recorded_on. Purely additive: `dob` is kept untouched and still drives the age of
-- patients who have one and no entered age. No backfill — existing rows stay as they are.

alter table public.patients
  add column if not exists age_years smallint,
  add column if not exists age_recorded_on date;

alter table public.patients drop constraint if exists patients_age_years_range;
alter table public.patients add constraint patients_age_years_range
  check (age_years between 0 and 120);

alter table public.patients drop constraint if exists patients_age_recorded_together;
alter table public.patients add constraint patients_age_recorded_together
  check ((age_years is null) = (age_recorded_on is null));

-- External Staff see a shared patient's age: return the age columns alongside dob. Identical to
-- 20261120194728_external_staff_patient_access.sql apart from the `shared` select list.
-- `create or replace` keeps the existing grants.
create or replace function private.external_workspace(p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_clinic uuid := private.current_clinic_id();
begin
  if v_actor is null or not private.eligible_external_profile(v_actor, v_clinic) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or not isfinite(p_start_date) or not isfinite(p_end_date)
    or p_start_date < date '0001-01-01' or p_end_date > date '9999-12-31'
    or p_end_date < p_start_date or p_end_date - p_start_date > 365 then
    raise exception 'Invalid date range.' using errcode = '22023';
  end if;
  return (
    with shared as materialized (
      select p.id, p.name, p.phone, p.dob, p.age_years, p.age_recorded_on, p.gender, p.email, p.address
      from public.patient_external_access g
      join public.patients p on p.id = g.patient_id and p.clinic_id = g.clinic_id
      where g.external_profile_id = v_actor and g.clinic_id = v_clinic
    )
    select jsonb_build_object(
      'patients', coalesce((select jsonb_agg(to_jsonb(p) order by p.name, p.id) from shared p),'[]'),
      'appointments', coalesce((select jsonb_agg(private.external_appointment_json(a,p.name) order by a.date,a.time,a.id)
        from public.appointments a join shared p on p.id = a.patient_id
        where a.external_profile_id = v_actor and a.clinic_id = v_clinic and a.date between p_start_date and p_end_date),'[]'),
      'appointment_types', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.sort_order,t.name,t.id)
        from public.appointment_types t where t.clinic_id = v_clinic),'[]')
    )
  );
end;
$$;
