-- Read-only production proof for migrations 030 through 034.
--
-- Run with a role that can read PostgreSQL catalogs and the aggregate-only
-- invariants below. The result is deliberately one ordered JSON document: it
-- never reads business-row IDs, names, notes, reasons, or other row values.

begin transaction read only;

with
expected_relations(schema_name, relation_name, relation_kind) as (
  values
    ('public', 'appointments', 'r'),
    ('public', 'packages', 'r'),
    ('public', 'payments', 'r'),
    ('public', 'appointment_payments', 'r'),
    ('public', 'appointment_charges', 'r'),
    ('public', 'appointment_charge_adjustments', 'r'),
    ('public', 'refunds', 'r'),
    ('public', 'refund_reversals', 'r'),
    ('public', 'payment_applications', 'r'),
    ('public', 'package_session_allocations', 'r'),
    ('public', 'billing_events', 'r'),
    ('public', 'profiles', 'r'),
    ('public', 'package_billing_balances_v2', 'v'),
    ('public', 'patient_billing_balances_v2', 'v'),
    ('auth', 'users', 'r')
),
expected_indexes(index_name) as (
  values
    ('package_session_allocations_one_active_appointment_v2_idx'),
    ('package_session_allocations_patient_v2_idx'),
    ('payment_applications_one_active_pair_v2_idx'),
    ('payment_applications_patient_v2_idx'),
    ('appointment_charges_patient_v2_idx'),
    ('refunds_payment_v2_idx'),
    ('refund_reversals_patient_v2_idx'),
    ('payment_applications_package_status_v2_idx'),
    ('billing_events_patient_v2_idx')
),
expected_constraints(schema_name, relation_name, constraint_name) as (
  values
    ('public', 'appointments', 'appointments_payment_status_check'),
    ('public', 'packages', 'packages_v2_required_fields'),
    ('public', 'packages', 'packages_cancellation_audit'),
    ('public', 'packages', 'packages_creation_audit_check'),
    ('public', 'payments', 'payments_funding_scope_check'),
    ('public', 'payments', 'payments_scope_package_check'),
    ('public', 'payments', 'payments_ledger_status_check'),
    ('public', 'payments', 'payments_void_audit_check'),
    ('public', 'payments', 'payments_creation_audit_check'),
    ('public', 'package_session_allocations', 'package_session_allocations_lifecycle_check'),
    ('public', 'refunds', 'refunds_method_check'),
    ('public', 'profiles', 'profiles_status_check'),
    ('public', 'profiles', 'profiles_soft_delete_audit_check')
),
expected_columns(schema_name, relation_name, column_name, expected_type, expected_nullable) as (
  values
    ('public', 'packages', 'appointment_type_id', 'uuid', true),
    ('public', 'packages', 'starts_on', 'date', true),
    ('public', 'packages', 'completed_at', 'timestamptz', true),
    ('public', 'packages', 'cancelled_at', 'timestamptz', true),
    ('public', 'packages', 'cancelled_by', 'uuid', true),
    ('public', 'packages', 'cancellation_reason', 'text', true),
    ('public', 'packages', 'billing_version', 'int2', false),
    ('public', 'packages', 'created_by', 'uuid', true),
    ('public', 'packages', 'creation_origin', 'text', false),
    ('public', 'payments', 'funding_scope', 'text', false),
    ('public', 'payments', 'status', 'text', false),
    ('public', 'payments', 'voided_at', 'timestamptz', true),
    ('public', 'payments', 'voided_by', 'uuid', true),
    ('public', 'payments', 'void_reason', 'text', true),
    ('public', 'payments', 'billing_version', 'int2', false),
    ('public', 'payments', 'created_by', 'uuid', true),
    ('public', 'payments', 'creation_origin', 'text', false),
    ('public', 'package_session_allocations', 'clinic_id', 'uuid', false),
    ('public', 'package_session_allocations', 'patient_id', 'uuid', false),
    ('public', 'package_session_allocations', 'lifecycle', 'text', false),
    ('public', 'package_session_allocations', 'released_at', 'timestamptz', true),
    ('public', 'package_session_allocations', 'release_reason', 'text', true),
    ('public', 'refunds', 'refund_method', 'text', false),
    ('public', 'refunds', 'refund_date', 'date', false),
    ('public', 'profiles', 'deleted_at', 'timestamptz', true),
    ('public', 'profiles', 'deleted_by', 'uuid', true),
    ('public', 'profiles', 'deletion_reason', 'text', true)
),
expected_triggers(schema_name, relation_name, trigger_name) as (
  values
    ('public', 'appointments', 'appointments_staff_payment_fields'),
    ('public', 'appointments', 'appointments_reconcile_billing_v2'),
    ('public', 'appointments', 'appointments_guard_completed_fee_v2'),
    ('public', 'appointments', 'appointments_preserve_billing_before_delete_v2'),
    ('public', 'appointments', 'appointments_reconcile_billing_after_delete_v2'),
    ('public', 'appointments', 'zz_appointments_require_active_assignee'),
    ('public', 'packages', 'packages_no_hard_delete_v2'),
    ('public', 'packages', 'packages_guard_rewrite_v2'),
    ('public', 'packages', 'packages_reconcile_billing_v2'),
    ('public', 'packages', 'packages_capture_creation_audit_v2'),
    ('public', 'packages', 'packages_append_creation_event_v2'),
    ('public', 'packages', 'aa_packages_creation_audit_immutable_v2'),
    ('public', 'payments', 'payments_no_hard_delete_v2'),
    ('public', 'payments', 'payments_guard_rewrite_v2'),
    ('public', 'payments', 'payments_reconcile_billing_v2'),
    ('public', 'payments', 'payments_capture_creation_audit_v2'),
    ('public', 'payments', 'payments_append_creation_event_v2'),
    ('public', 'payments', 'aa_payments_creation_audit_immutable_v2'),
    ('public', 'refunds', 'refunds_immutable'),
    ('public', 'refunds', 'refunds_reconcile_billing_v2'),
    ('public', 'refund_reversals', 'refund_reversals_immutable'),
    ('public', 'refund_reversals', 'refund_reversals_reconcile_billing_v2'),
    ('public', 'appointment_charges', 'appointment_charges_set_reference_v2'),
    ('public', 'appointment_charge_adjustments', 'appointment_charge_adjustments_immutable'),
    ('public', 'appointment_charge_adjustments', 'appointment_charge_adjustments_set_reference_v2'),
    ('public', 'payment_applications', 'payment_applications_no_delete'),
    ('public', 'package_session_allocations', 'package_session_allocations_no_delete'),
    ('public', 'package_session_allocations', 'package_session_allocations_set_reference_v2'),
    ('public', 'billing_events', 'billing_events_immutable'),
    ('public', 'profiles', 'profiles_guard_soft_delete_lifecycle'),
    ('auth', 'users', 'users_guard_hard_delete')
),
expected_policies(schema_name, relation_name, policy_name) as (
  values
    ('public', 'packages', 'packages_tenant_admin_read_v2'),
    ('public', 'payments', 'payments_tenant_admin_read_v2'),
    ('public', 'appointment_payments', 'appointment_payments_tenant_admin_read_v2'),
    ('public', 'appointment_charges', 'appointment_charges_tenant_admin_read_v2'),
    ('public', 'appointment_charge_adjustments', 'appointment_charge_adjustments_tenant_admin_read_v2'),
    ('public', 'refunds', 'refunds_tenant_admin_read_v2'),
    ('public', 'refund_reversals', 'refund_reversals_tenant_admin_read_v2'),
    ('public', 'payment_applications', 'payment_applications_tenant_admin_read_v2'),
    ('public', 'package_session_allocations', 'package_session_allocations_tenant_admin_read_v2'),
    ('public', 'billing_events', 'billing_events_tenant_admin_read_v2')
),
expected_functions(schema_name, function_name) as (
  values
    ('private', 'enforce_staff_appointment_payment_fields'),
    ('private', 'reject_billing_ledger_mutation'),
    ('private', 'guard_payment_application_history_v2'),
    ('private', 'guard_package_allocation_history_v2'),
    ('private', 'guard_payment_rewrite_v2'),
    ('private', 'guard_package_rewrite_v2'),
    ('private', 'billing_patient_lock_key_v2'),
    ('private', 'lock_patient_billing_v2'),
    ('private', 'try_lock_patient_billing_v2'),
    ('private', 'reconcile_patient_billing_v2'),
    ('private', 'trigger_reconcile_patient_billing_v2'),
    ('private', 'trigger_reconcile_payment_refund_v2'),
    ('private', 'set_billing_appointment_reference_v2'),
    ('private', 'guard_completed_appointment_fee_v2'),
    ('private', 'preserve_deleted_appointment_billing_v2'),
    ('private', 'trigger_reconcile_refund_reversal_v2'),
    ('private', 'assign_patient_package_sessions'),
    ('private', 'allocate_patient_payment_credit'),
    ('private', 'reconcile_package_usage'),
    ('private', 'is_disposable_e2e_identity'),
    ('private', 'user_has_retained_history'),
    ('private', 'guard_profile_soft_delete_lifecycle'),
    ('private', 'guard_auth_user_hard_delete'),
    ('private', 'require_active_appointment_assignee'),
    ('private', 'capture_billing_creation_audit_v2'),
    ('private', 'append_billing_creation_event_v2'),
    ('private', 'guard_billing_creation_audit_v2'),
    ('public', 'reconcile_patient_billing_v2'),
    ('public', 'preview_billing_allocation_v2'),
    ('public', 'record_payment_v2'),
    ('public', 'record_billing_entry_v2'),
    ('public', 'record_refund'),
    ('public', 'void_refund'),
    ('public', 'void_payment'),
    ('public', 'cancel_package'),
    ('public', 'adjust_appointment_fee'),
    ('public', 'record_payment'),
    ('public', 'record_billing_entry'),
    ('public', 'delete_payment'),
    ('public', 'delete_package'),
    ('public', 'assign_patient_package_sessions'),
    ('public', 'allocate_patient_payment_credit'),
    ('public', 'reconcile_package_usage')
),
relation_catalog as (
  select
    expected.schema_name,
    expected.relation_name,
    expected.relation_kind,
    catalog.oid,
    catalog.relkind,
    catalog.relrowsecurity
  from expected_relations expected
  left join pg_namespace namespace_row on namespace_row.nspname = expected.schema_name
  left join pg_class catalog
    on catalog.relnamespace = namespace_row.oid
   and catalog.relname = expected.relation_name
),
schema_checks as (
  select jsonb_build_object(
    'check', 'pgcrypto_in_extensions_schema',
    'passed', exists (
      select 1
      from pg_extension extension_row
      join pg_namespace namespace_row on namespace_row.oid = extension_row.extnamespace
      where extension_row.extname = 'pgcrypto' and namespace_row.nspname = 'extensions'
    )
  ) as item
  union all
  select jsonb_build_object(
    'check', 'relation_' || schema_name || '_' || relation_name,
    'passed', oid is not null and relkind::text = relation_kind,
    'expectedKind', relation_kind,
    'observedKind', coalesce(relkind::text, 'missing'),
    'rlsEnabled', coalesce(relrowsecurity, false)
  )
  from relation_catalog
),
column_manifest as (
  select jsonb_build_object(
    'relation', relation_catalog.schema_name || '.' || relation_catalog.relation_name,
    'column', column_row.column_name,
    'type', column_row.udt_schema || '.' || column_row.udt_name,
    'nullable', column_row.is_nullable = 'YES',
    'default', coalesce(column_row.column_default, ''),
    'ordinal', column_row.ordinal_position
  ) as item
  from relation_catalog
  join information_schema.columns column_row
    on column_row.table_schema = relation_catalog.schema_name
   and column_row.table_name = relation_catalog.relation_name
  order by relation_catalog.schema_name, relation_catalog.relation_name, column_row.ordinal_position
),
column_checks as (
  select jsonb_build_object(
    'check', 'column_' || expected.schema_name || '_' || expected.relation_name || '_' || expected.column_name,
    'passed', coalesce(
      column_row.column_name is not null
        and column_row.udt_name = expected.expected_type
        and (column_row.is_nullable = 'YES') = expected.expected_nullable,
      false
    ),
    'expectedType', expected.expected_type,
    'expectedNullable', expected.expected_nullable,
    'observedType', coalesce(column_row.udt_name, 'missing'),
    'observedNullable', column_row.is_nullable = 'YES',
    'default', coalesce(column_row.column_default, '')
  ) as item
  from expected_columns expected
  left join information_schema.columns column_row
    on column_row.table_schema = expected.schema_name
   and column_row.table_name = expected.relation_name
   and column_row.column_name = expected.column_name
  order by expected.schema_name, expected.relation_name, expected.column_name
),
constraint_manifest as (
  select jsonb_build_object(
    'relation', namespace_row.nspname || '.' || relation_row.relname,
    'constraint', constraint_row.conname,
    'type', constraint_row.contype,
    'definition', pg_get_constraintdef(constraint_row.oid, true)
  ) as item
  from relation_catalog expected
  join pg_constraint constraint_row on constraint_row.conrelid = expected.oid
  join pg_class relation_row on relation_row.oid = constraint_row.conrelid
  join pg_namespace namespace_row on namespace_row.oid = relation_row.relnamespace
  order by namespace_row.nspname, relation_row.relname, constraint_row.conname
),
constraint_checks as (
  select jsonb_build_object(
    'check', 'constraint_' || expected.schema_name || '_' || expected.relation_name || '_' || expected.constraint_name,
    'passed', constraint_row.oid is not null,
    'definitionHash', coalesce(md5(pg_get_constraintdef(constraint_row.oid, true)), '')
  ) as item
  from expected_constraints expected
  left join pg_namespace namespace_row on namespace_row.nspname = expected.schema_name
  left join pg_class relation_row
    on relation_row.relnamespace = namespace_row.oid and relation_row.relname = expected.relation_name
  left join pg_constraint constraint_row
    on constraint_row.conrelid = relation_row.oid and constraint_row.conname = expected.constraint_name
  order by expected.schema_name, expected.relation_name, expected.constraint_name
),
index_manifest as (
  select jsonb_build_object(
    'index', expected.index_name,
    'passed', index_row.indexname is not null,
    'definition', coalesce(index_row.indexdef, '')
  ) as item
  from expected_indexes expected
  left join pg_indexes index_row
    on index_row.schemaname = 'public' and index_row.indexname = expected.index_name
  order by expected.index_name
),
view_manifest as (
  select jsonb_build_object(
    'view', relation_catalog.schema_name || '.' || relation_catalog.relation_name,
    'passed', relation_catalog.oid is not null and relation_catalog.relkind = 'v',
    'definitionHash', coalesce(md5(pg_get_viewdef(relation_catalog.oid, true)), '')
  ) as item
  from relation_catalog
  where relation_catalog.relation_kind = 'v'
  order by relation_catalog.schema_name, relation_catalog.relation_name
),
function_manifest as (
  select jsonb_build_object(
    'function', expected.schema_name || '.' || expected.function_name || '(' || pg_get_function_identity_arguments(procedure_row.oid) || ')',
    'passed', procedure_row.oid is not null,
    'definitionHash', md5(pg_get_functiondef(procedure_row.oid)),
    'owner', owner_role.rolname,
    'securityDefiner', procedure_row.prosecdef,
    'volatility', procedure_row.provolatile
  ) as item
  from expected_functions expected
  join pg_namespace namespace_row on namespace_row.nspname = expected.schema_name
  join pg_proc procedure_row
    on procedure_row.pronamespace = namespace_row.oid
   and procedure_row.proname = expected.function_name
  join pg_roles owner_role on owner_role.oid = procedure_row.proowner
  order by expected.schema_name, expected.function_name, pg_get_function_identity_arguments(procedure_row.oid)
),
function_missing_checks as (
  select jsonb_build_object(
    'check', 'function_' || expected.schema_name || '_' || expected.function_name,
    'passed', exists (
      select 1
      from pg_proc procedure_row
      join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
      where namespace_row.nspname = expected.schema_name
        and procedure_row.proname = expected.function_name
    )
  ) as item
  from expected_functions expected
),
trigger_manifest as (
  select jsonb_build_object(
    'trigger', expected.schema_name || '.' || expected.relation_name || '.' || expected.trigger_name,
    'passed', trigger_row.oid is not null,
    'definitionHash', coalesce(md5(pg_get_triggerdef(trigger_row.oid, true)), '')
  ) as item
  from expected_triggers expected
  left join pg_namespace namespace_row on namespace_row.nspname = expected.schema_name
  left join pg_class relation_row
    on relation_row.relnamespace = namespace_row.oid and relation_row.relname = expected.relation_name
  left join pg_trigger trigger_row
    on trigger_row.tgrelid = relation_row.oid and trigger_row.tgname = expected.trigger_name and not trigger_row.tgisinternal
  order by expected.schema_name, expected.relation_name, expected.trigger_name
),
policy_manifest as (
  select jsonb_build_object(
    'policy', expected.schema_name || '.' || expected.relation_name || '.' || expected.policy_name,
    'passed', policy_row.policyname is not null,
    'command', coalesce(policy_row.cmd, ''),
    'roles', coalesce(to_jsonb(policy_row.roles), '[]'::jsonb),
    'usingHash', coalesce(md5(policy_row.qual), ''),
    'withCheckHash', coalesce(md5(policy_row.with_check), '')
  ) as item
  from expected_policies expected
  left join pg_policies policy_row
    on policy_row.schemaname = expected.schema_name
   and policy_row.tablename = expected.relation_name
   and policy_row.policyname = expected.policy_name
  order by expected.schema_name, expected.relation_name, expected.policy_name
),
relation_acl_manifest as (
  select jsonb_build_object(
    'relation', namespace_row.nspname || '.' || relation_row.relname,
    'grantee', coalesce(grantee_role.rolname, 'public'),
    'privilege', acl_row.privilege_type,
    'grantable', acl_row.is_grantable
  ) as item
  from relation_catalog expected
  join pg_class relation_row on relation_row.oid = expected.oid
  join pg_namespace namespace_row on namespace_row.oid = relation_row.relnamespace
  cross join lateral aclexplode(coalesce(relation_row.relacl, acldefault('r', relation_row.relowner))) acl_row
  left join pg_roles grantee_role on grantee_role.oid = acl_row.grantee
  order by namespace_row.nspname, relation_row.relname, coalesce(grantee_role.rolname, 'public'), acl_row.privilege_type
),
function_acl_manifest as (
  select jsonb_build_object(
    'function', namespace_row.nspname || '.' || procedure_row.proname || '(' || pg_get_function_identity_arguments(procedure_row.oid) || ')',
    'grantee', coalesce(grantee_role.rolname, 'public'),
    'privilege', acl_row.privilege_type,
    'grantable', acl_row.is_grantable
  ) as item
  from expected_functions expected
  join pg_namespace namespace_row on namespace_row.nspname = expected.schema_name
  join pg_proc procedure_row on procedure_row.pronamespace = namespace_row.oid and procedure_row.proname = expected.function_name
  cross join lateral aclexplode(coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))) acl_row
  left join pg_roles grantee_role on grantee_role.oid = acl_row.grantee
  order by namespace_row.nspname, procedure_row.proname, pg_get_function_identity_arguments(procedure_row.oid),
    coalesce(grantee_role.rolname, 'public'), acl_row.privilege_type
),
data_checks as (
  select jsonb_build_object('check', 'packages_v2_fields_populated', 'passed', count(*) = 0, 'violations', count(*)) as item
  from public.packages where billing_version >= 2 and (appointment_type_id is null or starts_on is null)
  union all
  select jsonb_build_object('check', 'payments_v2_scope_populated', 'passed', count(*) = 0, 'violations', count(*))
  from public.payments where billing_version >= 2 and (funding_scope is null or status is null)
  union all
  select jsonb_build_object('check', 'allocation_v2_fields_populated', 'passed', count(*) = 0, 'violations', count(*))
  from public.package_session_allocations where clinic_id is null or patient_id is null or lifecycle is null
  union all
  select jsonb_build_object('check', 'refund_effective_fields_populated', 'passed', count(*) = 0, 'violations', count(*))
  from public.refunds where refund_method is null or refund_date is null
  union all
  select jsonb_build_object('check', 'profile_soft_delete_audit_complete', 'passed', count(*) = 0, 'violations', count(*))
  from public.profiles
  where (status = 'deleted' and (deleted_at is null or deleted_by is null or nullif(btrim(deletion_reason), '') is null))
     or (status <> 'deleted' and (deleted_at is not null or deleted_by is not null or deletion_reason is not null))
  union all
  select jsonb_build_object('check', 'billing_creation_audit_complete', 'passed', count(*) = 0, 'violations', count(*))
  from public.packages
  where creation_origin is null
     or (creation_origin in ('legacy_unknown', 'system') and created_by is not null)
     or (creation_origin in ('rpc', 'historical_correction') and created_by is null)
  union all
  select jsonb_build_object('check', 'payment_creation_audit_complete', 'passed', count(*) = 0, 'violations', count(*))
  from public.payments
  where creation_origin is null
     or (creation_origin in ('legacy_unknown', 'system') and created_by is not null)
     or (creation_origin in ('rpc', 'historical_correction') and created_by is null)
)
select jsonb_build_object(
  'manifestVersion', 'carebook-migrations-030-034-v1',
  'readOnly', true,
  'schemaChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from schema_checks), '[]'::jsonb),
  'columns', coalesce((select jsonb_agg(item order by item ->> 'relation', (item ->> 'ordinal')::integer) from column_manifest), '[]'::jsonb),
  'columnChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from column_checks), '[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(item order by item ->> 'relation', item ->> 'constraint') from constraint_manifest), '[]'::jsonb),
  'constraintChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from constraint_checks), '[]'::jsonb),
  'indexes', coalesce((select jsonb_agg(item order by item ->> 'index') from index_manifest), '[]'::jsonb),
  'views', coalesce((select jsonb_agg(item order by item ->> 'view') from view_manifest), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(item order by item ->> 'function') from function_manifest), '[]'::jsonb),
  'functionChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from function_missing_checks), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(item order by item ->> 'trigger') from trigger_manifest), '[]'::jsonb),
  'policies', coalesce((select jsonb_agg(item order by item ->> 'policy') from policy_manifest), '[]'::jsonb),
  'relationAcls', coalesce((select jsonb_agg(item order by item ->> 'relation', item ->> 'grantee', item ->> 'privilege') from relation_acl_manifest), '[]'::jsonb),
  'functionAcls', coalesce((select jsonb_agg(item order by item ->> 'function', item ->> 'grantee', item ->> 'privilege') from function_acl_manifest), '[]'::jsonb),
  'dataChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from data_checks), '[]'::jsonb)
) as migration_proof_manifest;

commit;
