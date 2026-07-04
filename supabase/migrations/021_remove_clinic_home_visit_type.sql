-- Remove the "clinic_home_visit" appointment type, reverting to just
-- "clinic" and "home_visit". Existing clinic_home_visit rows are folded back
-- into personal-practice home visits ("home_visit"), which keeps their
-- restricted visibility and assignee behavior intact.

-- 1. Backfill existing rows before tightening the constraint.
update public.appointments
  set type = 'home_visit'
  where type = 'clinic_home_visit';

-- 2. Narrow the appointment type CHECK constraint back to two values.
alter table public.appointments
  drop constraint if exists appointments_type_check;

alter table public.appointments
  add constraint appointments_type_check
    check (type in ('home_visit', 'clinic'));

-- 3. Drop the now-unused clinic-home-visit default fee.
alter table public.global_settings
  drop column if exists clinic_home_visit_fee;
