\set ON_ERROR_STOP on

-- Run only after apply-approved-historical-corrections.sql commits every postcondition.
-- Required psql variable: bypass_token.

begin;
select set_config('carebook.ops.bypass_token', :'bypass_token', true);

do $resume$
declare
  gate private.billing_ops_gate%rowtype;
  marker_details jsonb;
  effective_role name := coalesce(nullif(current_setting('role', true), 'none'), session_user)::name;
begin
  select * into gate from private.billing_ops_gate where id = true for update;
  if gate.id is null then
    raise exception 'Billing write-pause gate is missing; refusing to resume.' using errcode = 'P0001';
  end if;
  if gate.paused_at < clock_timestamp() - interval '24 hours' then
    raise exception 'Billing write-pause gate is stale; run a fresh report, fingerprint and backup.' using errcode = 'P0001';
  end if;
  if gate.status <> 'corrections_applied' or gate.corrections_applied_at is null then
    raise exception 'Approved billing corrections have not completed; writes remain paused.' using errcode = 'P0001';
  end if;
  if effective_role <> gate.authorized_db_role
     or encode(extensions.digest(current_setting('carebook.ops.bypass_token'), 'sha256'), 'hex') <> gate.bypass_token_digest then
    raise exception 'Billing resume bypass authorization failed.' using errcode = '42501';
  end if;
  select details into marker_details
  from public.billing_events
  where event_type = 'approved_historical_corrections_20260815'
    and entity_type = 'patient'
    and entity_id = '72881d5a-88d9-4937-93b2-5ae53cf8a471'
  order by created_at desc limit 1;
  if marker_details is null
     or marker_details ->> 'sourceFingerprint' <> gate.source_fingerprint
     or marker_details ->> 'planFingerprint' <> gate.plan_fingerprint
     or marker_details ->> 'reportChecksum' <> gate.report_checksum
     or marker_details ->> 'liveDbFingerprint' <> gate.observed_live_db_fingerprint then
    raise exception 'Approved correction marker does not match the durable write-pause gate.' using errcode = 'P0001';
  end if;

  update private.billing_ops_gate
  set status = 'resumed', resumed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = true;
  execute format(
    'alter role %I in database %I reset carebook.ops.bypass_token',
    gate.authorized_db_role, current_database()
  );
end
$resume$;
commit;

select project_ref, status, paused_at, corrections_applied_at, resumed_at
from private.billing_ops_gate where id = true;
