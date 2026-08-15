\set ON_ERROR_STOP on

-- PRE-MIGRATION 029 PRODUCTION GATE. Required psql variables:
-- expected_live_db_fingerprint, source_row_counts, source_fingerprint, plan_fingerprint, report_checksum,
-- bypass_token. The token must be a fresh random value of at least 32 characters.

begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $normalize_pgcrypto$
begin
  if exists (
    select 1
    from pg_extension extension_row
    join pg_namespace extension_schema on extension_schema.oid = extension_row.extnamespace
    where extension_row.extname = 'pgcrypto'
      and extension_schema.nspname <> 'extensions'
  ) then
    alter extension pgcrypto set schema extensions;
  end if;
end
$normalize_pgcrypto$;
create schema if not exists private;

create table if not exists private.billing_ops_gate (
  id boolean primary key default true check (id),
  project_ref text not null,
  fingerprint_version text not null,
  source_fingerprint text not null,
  plan_fingerprint text not null,
  report_checksum text not null,
  expected_live_db_fingerprint text not null,
  observed_live_db_fingerprint text not null,
  expected_source_row_counts jsonb not null,
  observed_source_row_counts jsonb not null,
  status text not null check (status in ('paused_verified','paused_mismatch','corrections_applied','resumed')),
  authorized_db_role name not null,
  bypass_token_digest text not null,
  paused_at timestamptz not null,
  corrections_applied_at timestamptz,
  resumed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.billing_ops_gate add column if not exists expected_source_row_counts jsonb;
alter table private.billing_ops_gate add column if not exists observed_source_row_counts jsonb;

create table if not exists private.billing_ops_bypass_log (
  id bigint generated always as identity primary key,
  gate_paused_at timestamptz not null,
  db_role name not null,
  relation_name text not null,
  operation text not null,
  transaction_id bigint not null,
  occurred_at timestamptz not null default clock_timestamp()
);

revoke all on private.billing_ops_gate, private.billing_ops_bypass_log from public, anon, authenticated, service_role;

create or replace function private.billing_fp_encode(p_value text)
returns text language sql immutable parallel safe as $$
  select case when p_value is null then '-1:' else octet_length(p_value)::text || ':' || p_value end
$$;

create or replace function private.billing_source_payload_v1()
returns text
language plpgsql
stable
set search_path = public, private, pg_temp
as $$
declare
  payload text := 'version=' || private.billing_fp_encode('carebook-billing-source-v1') || E'\n';
begin
  payload := payload || 'table=' || private.billing_fp_encode('clinics') || ';count=' || (select count(*) from public.clinics) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';name=' || private.billing_fp_encode(name), E'\n' order by id
    ) || E'\n' from public.clinics), '');
  payload := payload || 'table=' || private.billing_fp_encode('patients') || ';count=' || (select count(*) from public.patients) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';clinic_id=' || private.billing_fp_encode(clinic_id::text)
      || ';name=' || private.billing_fp_encode(name), E'\n' order by id
    ) || E'\n' from public.patients), '');
  payload := payload || 'table=' || private.billing_fp_encode('appointment_types') || ';count=' || (select count(*) from public.appointment_types) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';clinic_id=' || private.billing_fp_encode(clinic_id::text)
      || ';name=' || private.billing_fp_encode(name) || ';session_rate=' || private.billing_fp_encode(session_rate::text)
      || ';is_shared=' || private.billing_fp_encode(is_shared::text) || ';is_default=' || private.billing_fp_encode(is_default::text)
      || ';sort_order=' || private.billing_fp_encode(sort_order::text)
      || ';created_at=' || private.billing_fp_encode((extract(epoch from created_at) * 1000000)::bigint::text), E'\n' order by id
    ) || E'\n' from public.appointment_types), '');
  payload := payload || 'table=' || private.billing_fp_encode('global_settings') || ';count=' || (select count(*) from public.global_settings) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';clinic_id=' || private.billing_fp_encode(clinic_id::text)
      || ';home_visit_fee=' || private.billing_fp_encode(home_visit_fee::text)
      || ';clinic_fee=' || private.billing_fp_encode(clinic_fee::text), E'\n' order by id
    ) || E'\n' from public.global_settings), '');
  payload := payload || 'table=' || private.billing_fp_encode('package_templates') || ';count=' || (select count(*) from public.package_templates) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';clinic_id=' || private.billing_fp_encode(clinic_id::text)
      || ';name=' || private.billing_fp_encode(name) || ';min_sessions=' || private.billing_fp_encode(min_sessions::text)
      || ';per_session_amount=' || private.billing_fp_encode(per_session_amount::text)
      || ';created_at=' || private.billing_fp_encode((extract(epoch from created_at) * 1000000)::bigint::text), E'\n' order by id
    ) || E'\n' from public.package_templates), '');
  payload := payload || 'table=' || private.billing_fp_encode('appointments') || ';count=' || (select count(*) from public.appointments) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';clinic_id=' || private.billing_fp_encode(clinic_id::text)
      || ';patient_id=' || private.billing_fp_encode(patient_id::text)
      || ';appointment_type_id=' || private.billing_fp_encode(appointment_type_id::text)
      || ';date=' || private.billing_fp_encode(date::text) || ';time=' || private.billing_fp_encode(time::text)
      || ';status=' || private.billing_fp_encode(status) || ';fee=' || private.billing_fp_encode(fee::text)
      || ';payment_status=' || private.billing_fp_encode(payment_status)
      || ';created_at=' || private.billing_fp_encode((extract(epoch from created_at) * 1000000)::bigint::text), E'\n' order by id
    ) || E'\n' from public.appointments), '');
  payload := payload || 'table=' || private.billing_fp_encode('packages') || ';count=' || (select count(*) from public.packages) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';clinic_id=' || private.billing_fp_encode(clinic_id::text)
      || ';patient_id=' || private.billing_fp_encode(patient_id::text) || ';name=' || private.billing_fp_encode(name)
      || ';total_sessions=' || private.billing_fp_encode(total_sessions::text)
      || ';used_sessions=' || private.billing_fp_encode(used_sessions::text)
      || ';total_amount=' || private.billing_fp_encode(total_amount::text)
      || ';per_session_amount=' || private.billing_fp_encode(per_session_amount::text)
      || ';paid_amount=' || private.billing_fp_encode(paid_amount::text)
      || ';payment_timing=' || private.billing_fp_encode(payment_timing)
      || ';status=' || private.billing_fp_encode(status)
      || ';created_at=' || private.billing_fp_encode((extract(epoch from created_at) * 1000000)::bigint::text), E'\n' order by id
    ) || E'\n' from public.packages), '');
  payload := payload || 'table=' || private.billing_fp_encode('payments') || ';count=' || (select count(*) from public.payments) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';clinic_id=' || private.billing_fp_encode(clinic_id::text)
      || ';patient_id=' || private.billing_fp_encode(patient_id::text)
      || ';package_id=' || private.billing_fp_encode(package_id::text)
      || ';appointment_id=' || private.billing_fp_encode(appointment_id::text)
      || ';amount=' || private.billing_fp_encode(amount::text)
      || ';payment_method=' || private.billing_fp_encode(payment_method)
      || ';date=' || private.billing_fp_encode(date::text) || ';notes=' || private.billing_fp_encode(notes)
      || ';created_at=' || private.billing_fp_encode((extract(epoch from created_at) * 1000000)::bigint::text), E'\n' order by id
    ) || E'\n' from public.payments), '');
  payload := payload || 'table=' || private.billing_fp_encode('appointment_payments') || ';count=' || (select count(*) from public.appointment_payments) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';payment_id=' || private.billing_fp_encode(payment_id::text)
      || ';appointment_id=' || private.billing_fp_encode(appointment_id::text)
      || ';amount_applied=' || private.billing_fp_encode(amount_applied::text)
      || ';created_at=' || private.billing_fp_encode((extract(epoch from created_at) * 1000000)::bigint::text), E'\n' order by id
    ) || E'\n' from public.appointment_payments), '');
  payload := payload || 'table=' || private.billing_fp_encode('package_session_allocations') || ';count=' || (select count(*) from public.package_session_allocations) || E'\n'
    || coalesce((select string_agg(
      'id=' || private.billing_fp_encode(id::text) || ';package_id=' || private.billing_fp_encode(package_id::text)
      || ';appointment_id=' || private.billing_fp_encode(appointment_id::text)
      || ';created_at=' || private.billing_fp_encode((extract(epoch from created_at) * 1000000)::bigint::text), E'\n' order by id
    ) || E'\n' from public.package_session_allocations), '');
  return payload;
end
$$;

create or replace function private.billing_source_fingerprint_v1()
returns text language sql stable set search_path = public, private, pg_temp as $$
  select encode(extensions.digest(private.billing_source_payload_v1(), 'sha256'), 'hex')
$$;

create or replace function private.billing_source_row_counts_v1()
returns jsonb language sql stable set search_path = public, private, pg_temp as $$
  select jsonb_build_object(
    'clinics', (select count(*) from public.clinics),
    'patients', (select count(*) from public.patients),
    'appointment_types', (select count(*) from public.appointment_types),
    'global_settings', (select count(*) from public.global_settings),
    'package_templates', (select count(*) from public.package_templates),
    'appointments', (select count(*) from public.appointments),
    'packages', (select count(*) from public.packages),
    'payments', (select count(*) from public.payments),
    'appointment_payments', (select count(*) from public.appointment_payments),
    'package_session_allocations', (select count(*) from public.package_session_allocations)
  )
$$;

create or replace function private.enforce_billing_ops_write_pause()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  gate private.billing_ops_gate%rowtype;
  supplied_token text := nullif(current_setting('carebook.ops.bypass_token', true), '');
  effective_role name := coalesce(nullif(current_setting('role', true), 'none'), session_user)::name;
begin
  select * into gate from private.billing_ops_gate where id = true;
  if gate.id is null then
    raise exception 'Care-Book billing write-pause gate is missing; writes remain paused.' using errcode = '55000';
  end if;
  if gate.status = 'resumed' then return null; end if;
  if gate.status in ('paused_verified', 'corrections_applied')
     and gate.paused_at >= clock_timestamp() - interval '24 hours'
     and effective_role = gate.authorized_db_role
     and supplied_token is not null
     and encode(extensions.digest(supplied_token, 'sha256'), 'hex') = gate.bypass_token_digest then
    insert into private.billing_ops_bypass_log (
      gate_paused_at, db_role, relation_name, operation, transaction_id
    ) values (gate.paused_at, session_user, tg_table_name, tg_op, txid_current());
    return null;
  end if;
  raise exception 'Care-Book billing writes are paused for verified migration operations.' using errcode = '55000';
end
$$;

do $install_guards$
declare relation_name text;
begin
  foreach relation_name in array array[
    'clinics','patients','appointment_types','global_settings','package_templates',
    'appointments','packages','payments','appointment_payments','package_session_allocations'
  ] loop
    execute format('drop trigger if exists billing_ops_write_pause on public.%I', relation_name);
    execute format(
      'create trigger billing_ops_write_pause before insert or update or delete or truncate on public.%I for each statement execute function private.enforce_billing_ops_write_pause()',
      relation_name
    );
  end loop;
end
$install_guards$;

select set_config('carebook.ops.expected_live_db_fingerprint', :'expected_live_db_fingerprint', false);
select set_config('carebook.ops.source_row_counts', :'source_row_counts', false);
select set_config('carebook.ops.source_fingerprint', :'source_fingerprint', false);
select set_config('carebook.ops.plan_fingerprint', :'plan_fingerprint', false);
select set_config('carebook.ops.report_checksum', :'report_checksum', false);
select set_config('carebook.ops.bypass_token', :'bypass_token', false);

do $activate_gate$
declare
  expected_fingerprint text := current_setting('carebook.ops.expected_live_db_fingerprint');
  observed_fingerprint text := private.billing_source_fingerprint_v1();
  token text := current_setting('carebook.ops.bypass_token');
  source_fingerprint text := current_setting('carebook.ops.source_fingerprint');
  plan_fingerprint text := current_setting('carebook.ops.plan_fingerprint');
  report_checksum text := current_setting('carebook.ops.report_checksum');
  expected_row_counts jsonb := current_setting('carebook.ops.source_row_counts')::jsonb;
  observed_row_counts jsonb := private.billing_source_row_counts_v1();
  operator_role name := session_user;
begin
  if source_fingerprint = '' or plan_fingerprint = '' or report_checksum = '' then
    raise exception 'Source, plan and report fingerprints are required.' using errcode = '22023';
  end if;
  if expected_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Expected live database fingerprint must be a lowercase SHA-256.' using errcode = '22023';
  end if;
  if length(token) < 32 then
    raise exception 'Billing migration bypass token must contain at least 32 characters.' using errcode = '22023';
  end if;
  insert into private.billing_ops_gate (
    id, project_ref, fingerprint_version, source_fingerprint, plan_fingerprint, report_checksum,
    expected_live_db_fingerprint, observed_live_db_fingerprint, expected_source_row_counts, observed_source_row_counts, status, authorized_db_role,
    bypass_token_digest, paused_at, corrections_applied_at, resumed_at, updated_at
  ) values (
    true, 'byhccyhbdnqslqdktybt', 'carebook-billing-source-v1', source_fingerprint, plan_fingerprint, report_checksum,
    expected_fingerprint, observed_fingerprint, expected_row_counts, observed_row_counts,
    case when observed_fingerprint = expected_fingerprint and observed_row_counts = expected_row_counts then 'paused_verified' else 'paused_mismatch' end,
    operator_role, encode(extensions.digest(token, 'sha256'), 'hex'), clock_timestamp(), null, null, clock_timestamp()
  ) on conflict (id) do update set
    project_ref = excluded.project_ref, fingerprint_version = excluded.fingerprint_version,
    source_fingerprint = excluded.source_fingerprint, plan_fingerprint = excluded.plan_fingerprint,
    report_checksum = excluded.report_checksum,
    expected_live_db_fingerprint = excluded.expected_live_db_fingerprint,
    observed_live_db_fingerprint = excluded.observed_live_db_fingerprint,
    expected_source_row_counts = excluded.expected_source_row_counts,
    observed_source_row_counts = excluded.observed_source_row_counts,
    status = excluded.status, authorized_db_role = excluded.authorized_db_role,
    bypass_token_digest = excluded.bypass_token_digest, paused_at = excluded.paused_at,
    corrections_applied_at = null, resumed_at = null, updated_at = excluded.updated_at;
  perform set_config('carebook.ops.bypass_token', token, false);
end
$activate_gate$;
commit;

-- Deliberately raise only after the pause transaction commits. A mismatch exits nonzero but
-- cannot accidentally reopen writes.
do $verify_gate$
declare gate private.billing_ops_gate%rowtype;
begin
  select * into gate from private.billing_ops_gate where id = true;
  if gate.status <> 'paused_verified' then
    raise exception 'Live database fingerprint/count mismatch: expected % / %, observed % / %. Writes remain paused.',
      gate.expected_live_db_fingerprint, gate.expected_source_row_counts,
      gate.observed_live_db_fingerprint, gate.observed_source_row_counts using errcode = 'P0001';
  end if;
end
$verify_gate$;

select project_ref, fingerprint_version, source_fingerprint, plan_fingerprint, report_checksum,
       expected_live_db_fingerprint, observed_live_db_fingerprint,
       expected_source_row_counts, observed_source_row_counts, status, paused_at, authorized_db_role
from private.billing_ops_gate where id = true;
