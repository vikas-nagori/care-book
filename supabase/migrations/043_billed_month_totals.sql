-- Server-side aggregation for the "Billed last month" monthly trend.
--
-- The trend screen never displays an individual session — it shows per-month, per-appointment-type
-- totals. It used to compute those in the app from a select of EVERY completed appointment since
-- inception, which PostgREST silently truncates at max-rows (1000). At ~215 completed sessions a
-- month that cap was weeks away, and because the query orders by date ascending the rows dropped
-- would have been the most recent months — the trend would have quietly stopped moving.
--
-- Aggregating here bounds the result at (months × appointment types) instead: a couple of dozen rows
-- today, and roughly 1000 only after ~16 years of billing. appointments.type is the denormalized
-- label kept in sync by the set_appointment_creator trigger (migration 028), so no join is needed.
--
-- p_till_day restricts every month to its first N days, which is what powers the "billed till date"
-- comparison: with today being the 19th, each month counts days 1–19 only, so months are compared
-- like for like. Months shorter than N simply contribute all of their days.

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
    and private.has_role(array['admin'])
    and (p_till_day is null or extract(day from appointment.date) <= p_till_day)
  group by 1, 2;
$$;

revoke all on function public.get_billed_month_totals_v1(integer) from public, anon;
grant execute on function public.get_billed_month_totals_v1(integer) to authenticated;
