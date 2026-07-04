-- Convert all historical no_show appointments to cancelled, then tighten the CHECK constraint.

-- 1. Migrate existing data
update public.appointments
set status = 'cancelled'
where status = 'no_show';

-- 2. Replace the CHECK constraint to disallow no_show going forward
alter table public.appointments
  drop constraint if exists appointments_status_check;

alter table public.appointments
  add constraint appointments_status_check
    check (status in ('scheduled', 'completed', 'cancelled'));
