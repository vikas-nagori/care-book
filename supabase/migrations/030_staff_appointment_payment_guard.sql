-- Keep appointment payment fields authoritative at the database boundary.
--
-- Supabase maps both clinic admins and staff to the PostgreSQL `authenticated`
-- role, so the application role must be resolved from profiles. Staff-created
-- appointments always use the selected appointment type's configured rate and
-- start unpaid. On staff updates, fee/payment_status retain their stored values.
-- Admin writes and trusted nested billing-trigger writes remain unchanged.

create or replace function private.enforce_staff_appointment_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  configured_rate numeric(10,2);
begin
  -- Billing allocation functions update payment_status from inside other
  -- triggers. Those trusted nested writes must not be mistaken for client DML.
  if pg_trigger_depth() > 1 or not private.has_role(array['staff']) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select appointment_type.session_rate
    into configured_rate
    from public.appointment_types appointment_type
    where appointment_type.id = new.appointment_type_id
      and appointment_type.clinic_id = new.clinic_id;

    if configured_rate is null then
      raise exception 'Appointment type rate was not found for the appointment clinic.'
        using errcode = '23503';
    end if;

    new.fee := configured_rate;
    new.payment_status := 'unpaid';
  else
    new.fee := old.fee;
    new.payment_status := old.payment_status;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_staff_appointment_payment_fields() from public, anon, authenticated;

drop trigger if exists appointments_staff_payment_fields on public.appointments;
create trigger appointments_staff_payment_fields
  before insert or update on public.appointments
  for each row
  execute function private.enforce_staff_appointment_payment_fields();

-- PostgreSQL runs same-kind triggers alphabetically. This name intentionally
-- follows appointments_set_creator (which resolves appointment_type_id/clinic)
-- and precedes appointments_untally_cancelled_billing (which may legitimately
-- set a cancelled appointment back to unpaid).
