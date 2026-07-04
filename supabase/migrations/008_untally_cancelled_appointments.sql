-- Untally billing links when an appointment is cancelled.
-- Payments remain recorded as received money/credit; only the appointment coverage is removed.

create or replace function public.untally_cancelled_appointment_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_package_ids uuid[] := array[]::uuid[];
  affected_package_id uuid;
begin
  if new.status = 'cancelled' then
    select coalesce(array_agg(distinct payment_row.package_id), array[]::uuid[])
    into affected_package_ids
    from public.appointment_payments appointment_payment_row
    join public.payments payment_row
      on payment_row.id = appointment_payment_row.payment_id
    where appointment_payment_row.appointment_id = new.id
      and payment_row.package_id is not null;

    delete from public.appointment_payments
    where appointment_id = new.id;

    new.payment_status := 'unpaid';

    foreach affected_package_id in array affected_package_ids loop
      perform public.reconcile_package_usage(affected_package_id);
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_untally_cancelled_billing on public.appointments;
create trigger appointments_untally_cancelled_billing
  before update of status on public.appointments
  for each row
  when (old.status is distinct from new.status)
  execute function public.untally_cancelled_appointment_billing();

do $$
declare
  affected_package_ids uuid[] := array[]::uuid[];
  affected_package_id uuid;
begin
  select coalesce(array_agg(distinct payment_row.package_id), array[]::uuid[])
  into affected_package_ids
  from public.appointment_payments appointment_payment_row
  join public.payments payment_row
    on payment_row.id = appointment_payment_row.payment_id
  join public.appointments appointment_row
    on appointment_row.id = appointment_payment_row.appointment_id
  where appointment_row.status = 'cancelled'
    and payment_row.package_id is not null;

  delete from public.appointment_payments appointment_payment_row
  using public.appointments appointment_row
  where appointment_payment_row.appointment_id = appointment_row.id
    and appointment_row.status = 'cancelled';

  update public.appointments
  set payment_status = 'unpaid'
  where status = 'cancelled'
    and payment_status <> 'unpaid';

  foreach affected_package_id in array affected_package_ids loop
    perform public.reconcile_package_usage(affected_package_id);
  end loop;
end;
$$;
