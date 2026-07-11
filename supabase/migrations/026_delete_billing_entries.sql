-- Admin-only deletion of payments and packages, with automatic balance rebuild.
--
-- There is no AFTER DELETE trigger on payments/packages (only on appointments),
-- so these RPCs delete the row(s) and then re-run the idempotent allocators
-- (private.assign_patient_package_sessions + private.allocate_patient_payment_credit,
-- migrations 022/023). Because credit is allocated oldest-first, shrinking the pool
-- naturally leaves the most-recent completed sessions unpaid.
--
-- FK cascades already clean up dependent rows:
--   appointment_payments.payment_id        ON DELETE CASCADE
--   package_session_allocations.package_id ON DELETE CASCADE
--   payments.package_id                    ON DELETE SET NULL
-- Packages are prepaid-only, so deleting a package also deletes its linked
-- payment(s) to withdraw the collected money from the credit pool.

create or replace function public.delete_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  target_patient_id uuid;
  target_clinic_id uuid;
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to delete payments.' using errcode = '42501';
  end if;

  select patient_id, clinic_id
  into target_patient_id, target_clinic_id
  from public.payments
  where id = p_payment_id;

  if target_patient_id is null then
    raise exception 'Payment not found.' using errcode = '22023';
  end if;

  if not private.is_same_clinic(target_clinic_id) then
    raise exception 'Payment does not belong to your clinic.' using errcode = '42501';
  end if;

  delete from public.payments where id = p_payment_id;

  perform private.assign_patient_package_sessions(target_patient_id);
  perform private.allocate_patient_payment_credit(target_patient_id);

  return jsonb_build_object('success', true, 'patientId', target_patient_id);
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'errorCode', SQLSTATE,
      'message', SQLERRM
    );
end;
$$;

create or replace function public.delete_package(p_package_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  target_patient_id uuid;
  target_clinic_id uuid;
begin
  if not private.has_role(array['admin']) then
    raise exception 'You are not allowed to delete packages.' using errcode = '42501';
  end if;

  select patient_id, clinic_id
  into target_patient_id, target_clinic_id
  from public.packages
  where id = p_package_id;

  if target_patient_id is null then
    raise exception 'Package not found.' using errcode = '22023';
  end if;

  if not private.is_same_clinic(target_clinic_id) then
    raise exception 'Package does not belong to your clinic.' using errcode = '42501';
  end if;

  -- Prepaid packages carry collected money via linked payments; remove them so
  -- the freed credit leaves the pool before the package row itself is deleted.
  delete from public.payments where package_id = p_package_id;
  delete from public.packages where id = p_package_id;

  perform private.assign_patient_package_sessions(target_patient_id);
  perform private.allocate_patient_payment_credit(target_patient_id);

  return jsonb_build_object('success', true, 'patientId', target_patient_id);
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'errorCode', SQLSTATE,
      'message', SQLERRM
    );
end;
$$;

revoke all on function public.delete_payment(uuid) from public, anon;
revoke all on function public.delete_package(uuid) from public, anon;

grant execute on function public.delete_payment(uuid) to authenticated;
grant execute on function public.delete_package(uuid) to authenticated;
