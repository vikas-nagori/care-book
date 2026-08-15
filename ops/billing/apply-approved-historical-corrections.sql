\set ON_ERROR_STOP on

-- NOT A NORMAL MIGRATION. Run only after migrations 031-033, the second verified backup,
-- maintenance-mode write pause, and a fresh impact report with zero invariant failures.
-- Required psql variables: source_fingerprint, plan_fingerprint, report_checksum,
-- live_db_fingerprint, bypass_token, actor_id.

begin;
set local carebook.ops.source_fingerprint to :'source_fingerprint';
set local carebook.ops.plan_fingerprint to :'plan_fingerprint';
set local carebook.ops.report_checksum to :'report_checksum';
set local carebook.ops.live_db_fingerprint to :'live_db_fingerprint';
set local carebook.ops.bypass_token to :'bypass_token';
set local carebook.ops.actor_id to :'actor_id';

do $carebook_ops$
declare
  v_fingerprint constant text := '8cb41a69c363db81ef421f7676a6dc1fc678d436674d25844145abfce9417145';
  v_plan_fingerprint constant text := 'ebed6813ce50f371c851c50e265ba0832b2b4daf33ded38d6cd39469ad62a2b8';
  v_report_checksum constant text := 'e3f381edd342de136387315c671c9d0df950c13e52cd912f2051da293e0591b9';
  v_actor uuid := current_setting('carebook.ops.actor_id')::uuid;
  v_live_db_fingerprint text := current_setting('carebook.ops.live_db_fingerprint');
  v_gate private.billing_ops_gate%rowtype;
  v_effective_role name := coalesce(nullif(current_setting('role', true), 'none'), session_user)::name;
  v_clinic constant uuid := 'd36983a1-e62d-41bd-8c3a-dfbdb4ce7968';
  v_smita constant uuid := '72881d5a-88d9-4937-93b2-5ae53cf8a471';
  v_pranav constant uuid := '24c77231-9973-4b21-b338-b1dfc092a2e3';
  v_reason constant text := 'Approved historical billing correction dated 2026-08-15';
  v_already_applied boolean;
begin
  if current_setting('carebook.ops.source_fingerprint') <> v_fingerprint then
    raise exception 'Production fingerprint mismatch; expected %, received %',
      v_fingerprint, current_setting('carebook.ops.source_fingerprint') using errcode = 'P0001';
  end if;
  if current_setting('carebook.ops.plan_fingerprint') <> v_plan_fingerprint
     or current_setting('carebook.ops.report_checksum') <> v_report_checksum then
    raise exception 'Approved plan/report fingerprint mismatch.' using errcode = 'P0001';
  end if;
  select * into v_gate from private.billing_ops_gate where id = true for update;
  if v_gate.id is null then
    raise exception 'Billing write-pause gate is missing.' using errcode = 'P0001';
  end if;
  if v_gate.status not in ('paused_verified', 'corrections_applied')
     or v_gate.paused_at < clock_timestamp() - interval '24 hours' then
    raise exception 'Billing write-pause gate is stale or not verified.' using errcode = 'P0001';
  end if;
  if v_gate.project_ref <> 'byhccyhbdnqslqdktybt'
     or v_gate.fingerprint_version <> 'carebook-billing-source-v1'
     or v_gate.source_fingerprint <> current_setting('carebook.ops.source_fingerprint')
     or v_gate.plan_fingerprint <> current_setting('carebook.ops.plan_fingerprint')
     or v_gate.report_checksum <> current_setting('carebook.ops.report_checksum')
     or v_gate.expected_live_db_fingerprint <> v_live_db_fingerprint
     or v_gate.observed_live_db_fingerprint <> v_live_db_fingerprint then
    raise exception 'Correction inputs do not match the durable production gate.' using errcode = 'P0001';
  end if;
  if v_effective_role <> v_gate.authorized_db_role
     or encode(extensions.digest(current_setting('carebook.ops.bypass_token'), 'sha256'), 'hex') <> v_gate.bypass_token_digest then
    raise exception 'Correction bypass authorization failed.' using errcode = '42501';
  end if;
  if to_regclass('public.billing_events') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'creation_origin') then
    raise exception 'Historical corrections require migrations 031-034.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_actor and clinic_id = v_clinic and role = 'admin' and status = 'active'
  ) then
    raise exception 'actor_id must identify an active Amruta clinic admin.' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.billing_events
    where event_type = 'approved_historical_corrections_20260815'
      and entity_type = 'patient' and entity_id = v_smita
  ) into v_already_applied;

  if not v_already_applied then
    -- Exact source-row gate. Any changed target aborts the whole transaction.
    if not exists (
      select 1 from public.payments
      where id = 'b53563c9-b4b4-4a02-b5f4-5937b4cf1225'
        and clinic_id = v_clinic and patient_id = v_smita
        and package_id = 'cb877a26-47f4-4ae7-8e15-416269db240f'
        and amount = 6000 and payment_method = 'upi' and date = date '2026-07-15'
        and notes = 'Self' and status = 'posted' and funding_scope = 'package'
        and created_at = timestamptz '2026-07-15 08:26:00.671693+00'
    ) then raise exception 'Smita original receipt precondition mismatch.' using errcode = 'P0001'; end if;
    if not exists (
      select 1 from public.packages
      where id = 'cb877a26-47f4-4ae7-8e15-416269db240f'
        and clinic_id = v_clinic and patient_id = v_smita
        and total_sessions = 10 and total_amount = 6000 and per_session_amount = 600
        and appointment_type_id = '2c08cb1e-13c2-4b86-be34-08a03cc6c399'
        and starts_on = date '2026-07-15' and status = 'active' and billing_version = 2
    ) then raise exception 'Smita package precondition mismatch.' using errcode = 'P0001'; end if;
    if not exists (
      select 1 from public.appointments
      where id = 'c1d8f6e6-d25d-4016-b496-77e187351b8f'
        and patient_id = v_smita and status = 'completed' and fee = 500
        and appointment_type_id = 'cd57ef69-f287-4f1e-9056-04e9dcbe96c2'
    ) then raise exception 'Smita Spinal Bed appointment precondition mismatch.' using errcode = 'P0001'; end if;
    if not exists (
      select 1 from public.packages
      where id = '28ecd64e-875d-42fa-b5df-c59191c58a7b'
        and patient_id = v_pranav and clinic_id = v_clinic and total_sessions = 5
        and total_amount = 3250 and starts_on = date '2026-08-11'
        and appointment_type_id = '2c08cb1e-13c2-4b86-be34-08a03cc6c399'
        and billing_version = 2
    ) then raise exception 'Pranav second package precondition mismatch.' using errcode = 'P0001'; end if;
    if exists (
      select 1 from public.payments where id in (
        '4bb5d6ca-08b4-4d8a-92aa-47cf7a265401', '6dc37185-3aa2-4590-9e18-acde15600600'
      )
    ) or exists (select 1 from public.refunds where id = '79b344fb-d5e2-4ea1-b6c2-202607300100') then
      raise exception 'Correction IDs already exist without the completion marker.' using errcode = 'P0001';
    end if;

    perform private.lock_patient_billing_v2(v_smita);
    perform private.lock_patient_billing_v2(v_pranav);
    perform set_config('carebook.billing_package_mutation_v2', 'on', true);
    update public.packages
    set total_sessions = 9, total_amount = 5400, per_session_amount = 600, paid_amount = 5400,
        appointment_type_id = '2c08cb1e-13c2-4b86-be34-08a03cc6c399', starts_on = date '2026-07-15'
    where id = 'cb877a26-47f4-4ae7-8e15-416269db240f';
    update public.packages
    set starts_on = date '2026-07-28', appointment_type_id = '2c08cb1e-13c2-4b86-be34-08a03cc6c399'
    where id = '28ecd64e-875d-42fa-b5df-c59191c58a7b';
    perform set_config('carebook.billing_package_mutation_v2', 'off', true);

    perform set_config('carebook.billing_payment_mutation_v2', 'on', true);
    update public.payments
    set status = 'voided', voided_at = now(), voided_by = v_actor,
        void_reason = v_reason || ': replace one mixed-scope receipt with two receipts'
    where id = 'b53563c9-b4b4-4a02-b5f4-5937b4cf1225';
    perform set_config('carebook.billing_payment_mutation_v2', 'off', true);

    insert into public.payments (
      id, clinic_id, patient_id, package_id, amount, payment_method, date, notes,
      created_at, funding_scope, status, billing_version, created_by, creation_origin
    ) values
      ('4bb5d6ca-08b4-4d8a-92aa-47cf7a265401', v_clinic, v_smita,
       'cb877a26-47f4-4ae7-8e15-416269db240f', 5400, 'upi', date '2026-07-15',
       'Self — approved package replacement receipt', timestamptz '2026-07-15 08:26:00.671694+00', 'package', 'posted', 2, v_actor, 'historical_correction'),
      ('6dc37185-3aa2-4590-9e18-acde15600600', v_clinic, v_smita,
       null, 600, 'upi', date '2026-07-15',
       'Self — approved ordinary replacement receipt', timestamptz '2026-07-15 08:26:00.671695+00', 'ordinary', 'posted', 2, v_actor, 'historical_correction');

    insert into public.refunds (
      id, clinic_id, patient_id, payment_id, amount, refund_method, refund_date,
      reason, created_by, created_at
    ) values (
      '79b344fb-d5e2-4ea1-b6c2-202607300100', v_clinic, v_smita,
      '6dc37185-3aa2-4590-9e18-acde15600600', 100, 'upi', date '2026-07-30',
      'Approved historical correction: return Smita package overpayment', v_actor,
      timestamptz '2026-07-30 00:00:00+00'
    );

    insert into public.billing_events (
      clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details
    ) values
      (v_clinic, v_smita, 'package_corrected_historical', 'package',
       'cb877a26-47f4-4ae7-8e15-416269db240f', v_reason, v_actor,
       jsonb_build_object(
         'previousTotalSessions', 10, 'totalSessions', 9,
         'previousTotalAmount', 6000, 'totalAmount', 5400,
         'perSessionAmount', 600, 'sourceFingerprint', v_fingerprint, 'liveDbFingerprint', v_live_db_fingerprint,
         'planFingerprint', v_plan_fingerprint, 'reportChecksum', v_report_checksum
       )),
      (v_clinic, v_smita, 'payment_replaced_historical', 'payment',
       'b53563c9-b4b4-4a02-b5f4-5937b4cf1225', v_reason, v_actor,
       jsonb_build_object('replacementPaymentIds', array['4bb5d6ca-08b4-4d8a-92aa-47cf7a265401','6dc37185-3aa2-4590-9e18-acde15600600'], 'sourceFingerprint', v_fingerprint, 'liveDbFingerprint', v_live_db_fingerprint, 'planFingerprint', v_plan_fingerprint, 'reportChecksum', v_report_checksum)),
      (v_clinic, v_pranav, 'package_start_corrected_historical', 'package',
       '28ecd64e-875d-42fa-b5df-c59191c58a7b', v_reason, v_actor,
       jsonb_build_object('previousStartsOn', '2026-08-11', 'startsOn', '2026-07-28', 'sourceFingerprint', v_fingerprint, 'liveDbFingerprint', v_live_db_fingerprint, 'planFingerprint', v_plan_fingerprint, 'reportChecksum', v_report_checksum));

    perform private.reconcile_patient_billing_v2(v_smita);
    perform private.reconcile_patient_billing_v2(v_pranav);

    insert into public.billing_events (
      clinic_id, patient_id, event_type, entity_type, entity_id, reason, actor_id, details
    ) values (
      v_clinic, v_smita, 'approved_historical_corrections_20260815', 'patient', v_smita,
      v_reason, v_actor, jsonb_build_object('sourceFingerprint', v_fingerprint, 'liveDbFingerprint', v_live_db_fingerprint, 'planFingerprint', v_plan_fingerprint, 'reportChecksum', v_report_checksum, 'patients', array[v_smita, v_pranav])
    );
  end if;

  -- Postconditions also protect idempotent re-runs.
  if not exists (
    select 1 from public.package_billing_balances_v2
    where package_id = 'cb877a26-47f4-4ae7-8e15-416269db240f'
      and quote_amount = 5400 and net_received = 5400 and applied_amount = 5400
      and due_amount = 0 and refundable_credit = 0
      and availed_sessions = 9 and scheduled_sessions = 0
  ) or not exists (
    select 1 from public.packages where id = 'cb877a26-47f4-4ae7-8e15-416269db240f'
      and total_sessions = 9 and status = 'completed' and completed_at is not null
  ) then raise exception 'Smita package outcome verification failed.' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.appointments appointment
    join public.appointment_charges charge on charge.appointment_id = appointment.id
    join public.payment_applications application on application.charge_id = charge.id
    where appointment.id = 'c1d8f6e6-d25d-4016-b496-77e187351b8f'
      and appointment.payment_status = 'paid' and application.status = 'active'
      and application.funding_scope = 'ordinary' and application.amount = 500
  ) then raise exception 'Smita ordinary application/refund outcome verification failed.' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.package_billing_balances_v2
    where package_id = 'dd3bf8eb-741f-40d9-a25d-bdea979871b4'
      and availed_sessions = 5 and scheduled_sessions = 0 and due_amount = 0
  ) or not exists (
    select 1 from public.package_billing_balances_v2
    where package_id = '28ecd64e-875d-42fa-b5df-c59191c58a7b'
      and starts_on = date '2026-07-28' and availed_sessions = 5
      and scheduled_sessions = 0 and due_amount = 50
  ) then raise exception 'Pranav package outcome verification failed.' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.package_billing_balances_v2
    where package_id = '44e48b86-bb08-49a2-89e0-060051f9b47a'
      and availed_sessions = 4 and scheduled_sessions = 1
  ) then raise exception 'Vikash package outcome verification failed.' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.package_billing_balances_v2
    where package_id = 'cacb4aea-4059-4671-806a-1e382dc3fa75'
      and availed_sessions = 3 and scheduled_sessions = 2 and refundable_credit = 1300
  ) then raise exception 'Sandeep package outcome verification failed.' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.package_billing_balances_v2
    where package_id = '705d245d-e107-4f13-b511-445f424208c0'
      and availed_sessions = 2 and scheduled_sessions = 1 and refundable_credit = 1300
  ) or not exists (
    select 1 from public.appointments
    where id = '89650eb0-d673-4d50-b481-403e704ad847' and payment_status = 'unpaid'
  ) then raise exception 'Nayana package/Spinal Bed outcome verification failed.' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.package_billing_balances_v2
    where package_id = '5e169151-db06-46c9-9736-dd0221afd749'
      and availed_sessions = 7 and scheduled_sessions = 0 and due_amount = 0 and refundable_credit = 0
  ) then raise exception 'Tresa unchanged outcome verification failed.' using errcode = 'P0001'; end if;

  update private.billing_ops_gate
  set status = 'corrections_applied', corrections_applied_at = coalesce(corrections_applied_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where id = true;
end
$carebook_ops$;
commit;
