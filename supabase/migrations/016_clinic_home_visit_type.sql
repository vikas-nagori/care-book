-- Bifurcate the "home_visit" appointment type into personal-practice home visits
-- (still "home_visit") and clinic-arranged home visits ("clinic_home_visit").
-- Existing home_visit rows stay as personal home visits (no backfill).

-- 1. Widen the appointment type CHECK constraint to allow the new value.
alter table public.appointments
  drop constraint if exists appointments_type_check;

alter table public.appointments
  add constraint appointments_type_check
    check (type in ('home_visit', 'clinic', 'clinic_home_visit'));

-- 2. Separately configurable default fee for clinic home visits.
alter table public.global_settings
  add column if not exists clinic_home_visit_fee numeric(10,2) not null default 0;

-- Note: visibility (can_access_appointment) and the assignee-nulling trigger
-- (set_appointment_creator) from migration 010 are intentionally left unchanged.
-- A clinic_home_visit is a non-'clinic' type, so it automatically inherits the
-- restricted, assignee-retaining behavior we want.
