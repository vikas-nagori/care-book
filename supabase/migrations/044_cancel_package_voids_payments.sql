-- Cancelling a package now voids the payments recorded against it.
--
-- cancel_package used to keep the package's receipts posted, so the money stayed on the patient
-- as refundable credit. In practice a package is cancelled because it was entered by mistake or
-- entered twice, and the receipt that came with it was never real money: a cancelled duplicate
-- left ₹3,250 counted as received and inflated the patient's credit until it was voided by hand.
--
-- The package and its payments now go together, all or nothing, under the same reason:
--   * every posted package-scoped payment on the package is voided (row kept, audited — never
--     deleted), with one payment_voided billing event each;
--   * a payment voided earlier keeps its own void reason and is not touched again;
--   * sessions the package had used are released and fall back to their own fee, so they are
--     settled by the patient's other credit or show as due;
--   * a payment with an unreversed refund cannot be voided (void_payment's rule), so the
--     cancellation is refused until the refund is reversed, rather than half-applied.
--
-- Everything above the new block is the live definition (migrations 032 + 037) unchanged;
-- create or replace keeps the existing grants. delete_package delegates here, so legacy
-- deletes behave the same way.

create or replace function public.cancel_package(p_package_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare package_row public.packages%rowtype; target_patient_id uuid; payment_row public.payments%rowtype;
begin
  if not private.has_role(array['admin']) then raise exception 'You are not allowed to cancel packages.' using errcode = '42501'; end if;
  select patient_id into target_patient_id from public.packages where id = p_package_id;
  if target_patient_id is null then raise exception 'Package not found.' using errcode = '22023'; end if;
  perform private.lock_patient_billing_v2(target_patient_id);
  select * into package_row from public.packages where id = p_package_id for update;
  if package_row.id is null then raise exception 'Package not found.' using errcode = '22023'; end if;
  if not private.is_same_clinic(package_row.clinic_id) then raise exception 'Package does not belong to your clinic.' using errcode = '42501'; end if;
  if package_row.status = 'cancelled' then raise exception 'Package is already cancelled.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Cancellation reason is required.' using errcode = '22023'; end if;

  -- Checked before anything is written so a refused cancellation changes nothing.
  if exists (
    select 1
    from public.payments payment
    join public.refunds refund on refund.payment_id = payment.id
    where payment.package_id = p_package_id
      and payment.status = 'posted'
      and not exists (select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id)
  ) then
    raise exception 'This package''s payment has a refund. Reverse the refund first, then cancel the package.' using errcode = '22023';
  end if;

  for payment_row in
    select * from public.payments
    where package_id = p_package_id and status = 'posted'
    order by created_at, id
    for update
  loop
    perform set_config('carebook.billing_payment_mutation_v2', 'on', true);
    update public.payments set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = payment_row.id;
    perform set_config('carebook.billing_payment_mutation_v2', 'off', true);
    insert into public.billing_events (clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details)
    values (payment_row.clinic_id, payment_row.patient_id, 'payment_voided', 'payment', payment_row.id, btrim(p_reason), auth.uid(), jsonb_build_object('amount', payment_row.amount, 'packageId', p_package_id));
  end loop;

  perform set_config('carebook.billing_package_mutation_v2', 'on', true);
  update public.packages
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason), completed_at = null
  where id = p_package_id;
  perform set_config('carebook.billing_package_mutation_v2', 'off', true);
  insert into public.billing_events (clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details)
  values (package_row.clinic_id, package_row.patient_id, 'package_cancelled', 'package', package_row.id, btrim(p_reason), auth.uid(), jsonb_build_object('previousStatus', package_row.status));
  return jsonb_build_object('success', true, 'packageId', package_row.id, 'patientId', package_row.patient_id);
exception when others then
  return private.billing_error_response(sqlstate, sqlerrm);
end;
$$;
