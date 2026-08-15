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
    ('public', 'appointment_charges', 'appointment_reference_id', 'uuid', false),
    ('public', 'appointment_charges', 'appointment_id', 'uuid', true),
    ('public', 'appointment_charge_adjustments', 'appointment_reference_id', 'uuid', false),
    ('public', 'appointment_charge_adjustments', 'appointment_id', 'uuid', true),
    ('public', 'package_session_allocations', 'appointment_reference_id', 'uuid', false),
    ('public', 'package_session_allocations', 'appointment_id', 'uuid', true),
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
forbidden_triggers(schema_name, relation_name, trigger_name) as (
  values
    ('public', 'appointments', 'appointments_sync_patient_billing_allocations'),
    ('public', 'packages', 'packages_sync_patient_billing_allocations'),
    ('public', 'payments', 'payments_sync_patient_billing_allocations'),
    ('public', 'appointments', 'appointments_untally_cancelled_billing'),
    ('public', 'appointment_payments', 'appointment_payments_reconcile_usage'),
    ('public', 'appointments', 'appointments_reconcile_usage'),
    ('public', 'payments', 'payments_reconcile_usage'),
    ('public', 'appointments', 'appointments_delete_sync_billing')
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
forbidden_policies(schema_name, relation_name, policy_name) as (
  values
    ('public', 'packages', 'packages_tenant_admin_access'),
    ('public', 'payments', 'payments_tenant_admin_access'),
    ('public', 'appointment_payments', 'appointment_payments_tenant_admin_access'),
    ('public', 'package_session_allocations', 'package_session_allocations_tenant_admin_access'),
    ('public', 'package_session_allocations', 'package_session_allocations_admin_access')
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
    ('private', 'sync_patient_billing_allocations'),
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
expected_schema_acls(schema_name, grantee_name, privilege_type) as (
  values ('private', 'supabase_auth_admin', 'USAGE')
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
forbidden_trigger_checks as (
  select jsonb_build_object(
    'check', 'legacy_trigger_absent_' || expected.schema_name || '_' || expected.relation_name || '_' || expected.trigger_name,
    'passed', trigger_row.oid is null
  ) as item
  from forbidden_triggers expected
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
forbidden_policy_checks as (
  select jsonb_build_object(
    'check', 'legacy_policy_absent_' || expected.schema_name || '_' || expected.relation_name || '_' || expected.policy_name,
    'passed', policy_row.policyname is null
  ) as item
  from forbidden_policies expected
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
schema_acl_manifest as (
  select jsonb_build_object(
    'schema', namespace_row.nspname,
    'grantee', coalesce(grantee_role.rolname, 'public'),
    'privilege', acl_row.privilege_type,
    'grantable', acl_row.is_grantable
  ) as item
  from expected_schema_acls expected
  join pg_namespace namespace_row on namespace_row.nspname = expected.schema_name
  cross join lateral aclexplode(coalesce(namespace_row.nspacl, acldefault('n', namespace_row.nspowner))) acl_row
  left join pg_roles grantee_role on grantee_role.oid = acl_row.grantee
  order by namespace_row.nspname, coalesce(grantee_role.rolname, 'public'), acl_row.privilege_type
),
schema_acl_checks as (
  select jsonb_build_object(
    'check', 'schema_acl_' || expected.schema_name || '_' || expected.grantee_name || '_' || lower(expected.privilege_type),
    'passed', exists (
      select 1
      from pg_namespace namespace_row
      join pg_roles grantee_role on grantee_role.rolname = expected.grantee_name
      cross join lateral aclexplode(coalesce(namespace_row.nspacl, acldefault('n', namespace_row.nspowner))) acl_row
      where namespace_row.nspname = expected.schema_name
        and acl_row.grantee = grantee_role.oid
        and acl_row.privilege_type = expected.privilege_type
    )
  ) as item
  from expected_schema_acls expected
),
function_acl_checks as (
  select jsonb_build_object(
    'check', 'private_sync_patient_billing_allocations_client_execute_revoked',
    'passed', exists (
      select 1
      from pg_proc procedure_row
      join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
      where namespace_row.nspname = 'private'
        and procedure_row.proname = 'sync_patient_billing_allocations'
    ) and not exists (
      select 1
      from pg_proc procedure_row
      join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
      cross join lateral aclexplode(coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))) acl_row
      left join pg_roles grantee_role on grantee_role.oid = acl_row.grantee
      where namespace_row.nspname = 'private'
        and procedure_row.proname = 'sync_patient_billing_allocations'
        and acl_row.privilege_type = 'EXECUTE'
        and (acl_row.grantee = 0 or grantee_role.rolname in ('anon', 'authenticated'))
    )
  ) as item
),
data_checks as (
  select jsonb_build_object('check', 'appointment_type_bootstrap_scoped', 'passed', count(*) = 0, 'violations', count(*)) as item
  from public.packages package_row
  where package_row.creation_origin = 'legacy_unknown'
    and package_row.billing_version >= 2
    and not exists (
      select 1
      from public.appointment_types appointment_type
      where appointment_type.id = package_row.appointment_type_id
        and appointment_type.clinic_id = package_row.clinic_id
    )
  union all
  select jsonb_build_object('check', 'appointment_type_bootstrap_available', 'passed', count(*) = 0, 'violations', count(*))
  from public.packages package_row
  where package_row.creation_origin = 'legacy_unknown'
    and not exists (
    select 1
    from public.appointment_types appointment_type
    where appointment_type.clinic_id = package_row.clinic_id
      and (appointment_type.name = 'Clinic' or appointment_type.is_shared)
  )
  union all
  select jsonb_build_object('check', 'package_billing_version_backfill_legacy_package_backfill_provenance', 'passed', count(*) = 0, 'violations', count(*))
  from public.packages
  where creation_origin = 'legacy_unknown'
    and billing_version < 2
  union all
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
  select jsonb_build_object('check', 'charge_application_materialization', 'passed', count(*) = 0, 'violations', count(*))
  from public.appointments appointment_row
  where not exists (
    select 1
    from public.appointment_charges charge
    where charge.appointment_id = appointment_row.id
      or charge.appointment_reference_id = appointment_row.id
  )
  union all
  select jsonb_build_object('check', 'charge_application_reconciliation', 'passed', count(*) = 0, 'violations', count(*))
  from public.payment_applications application
  left join public.payments payment on payment.id = application.payment_id
  left join public.appointment_charges charge on charge.id = application.charge_id
  where payment.id is null
     or charge.id is null
     or application.clinic_id is distinct from payment.clinic_id
     or application.patient_id is distinct from payment.patient_id
     or application.clinic_id is distinct from charge.clinic_id
     or application.patient_id is distinct from charge.patient_id
  union all
  select jsonb_build_object('check', 'appointment_charge_parity', 'passed', count(*) = 0, 'violations', count(*))
  from public.appointments appointment_row
  left join public.appointment_charges charge on charge.appointment_id = appointment_row.id
  where charge.id is null
     or charge.clinic_id is distinct from appointment_row.clinic_id
     or charge.patient_id is distinct from appointment_row.patient_id
     or charge.amount is distinct from coalesce(appointment_row.fee, 0)
     or charge.status is distinct from case appointment_row.status
       when 'scheduled' then 'pending'
       when 'completed' then 'posted'
       else 'voided'
     end
  union all
  select jsonb_build_object('check', 'appointment_payment_status_parity', 'passed', count(*) = 0, 'violations', count(*))
  from public.appointments appointment_row
  join public.appointment_charges charge on charge.appointment_id = appointment_row.id
  left join public.payment_applications application
    on application.charge_id = charge.id and application.status = 'active'
  group by appointment_row.id, charge.id
  having appointment_row.payment_status is distinct from case
    when coalesce(sum(application.amount) filter (where application.funding_scope = 'package'), 0) >= charge.amount
      and charge.amount > 0 then 'prepaid'
    when coalesce(sum(application.amount) filter (where application.funding_scope = 'package'), 0) > 0
      then 'partially_prepaid'
    when coalesce(sum(application.amount) filter (where application.funding_scope = 'ordinary'), 0) >= charge.amount
      and charge.amount > 0 then 'paid'
    when coalesce(sum(application.amount) filter (where application.funding_scope = 'ordinary'), 0) > 0
      then 'partially_paid'
    else 'unpaid'
  end
  union all
  select jsonb_build_object('check', 'payment_application_amount_conservation', 'passed', count(*) = 0, 'violations', count(*))
  from public.payments payment_row
  cross join lateral (
    select coalesce(sum(application.amount), 0) as applied_amount
    from public.payment_applications application
    where application.payment_id = payment_row.id
      and application.status = 'active'
  ) application_total
  cross join lateral (
    select coalesce(sum(refund.amount), 0) as refunded_amount
    from public.refunds refund
    where refund.payment_id = payment_row.id
      and not exists (
        select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id
      )
  ) refund_total
  where application_total.applied_amount > greatest(payment_row.amount - refund_total.refunded_amount, 0)
     or (payment_row.status <> 'posted' and application_total.applied_amount > 0)
  union all
  select jsonb_build_object('check', 'charge_application_amount_conservation', 'passed', count(*) = 0, 'violations', count(*))
  from public.appointment_charges charge
  cross join lateral (
    select coalesce(sum(application.amount), 0) as applied_amount
    from public.payment_applications application
    where application.charge_id = charge.id
      and application.status = 'active'
  ) application_total
  where application_total.applied_amount > charge.amount
     or (charge.status not in ('pending', 'posted') and application_total.applied_amount > 0)
  union all
  select jsonb_build_object('check', 'payment_application_funding_scope_consistency', 'passed', count(*) = 0, 'violations', count(*))
  from public.payment_applications application
  join public.payments payment_row on payment_row.id = application.payment_id
  where application.status = 'active'
    and (
      application.funding_scope is distinct from payment_row.funding_scope
      or application.package_id is distinct from payment_row.package_id
    )
  union all
  select jsonb_build_object('check', 'active_allocation_eligibility', 'passed', count(*) = 0, 'violations', count(*))
  from public.package_session_allocations allocation
  left join public.packages package_row on package_row.id = allocation.package_id
  left join public.appointments appointment_row on appointment_row.id = allocation.appointment_id
  left join public.appointment_charges charge on charge.appointment_id = appointment_row.id
  where allocation.lifecycle <> 'released'
    and (
      package_row.id is null
      or appointment_row.id is null
      or charge.id is null
      or package_row.status not in ('active', 'completed')
      or package_row.appointment_type_id is null
      or package_row.starts_on is null
      or appointment_row.status not in ('scheduled', 'completed')
      or charge.status not in ('pending', 'posted')
      or allocation.clinic_id is distinct from package_row.clinic_id
      or allocation.patient_id is distinct from package_row.patient_id
      or appointment_row.clinic_id is distinct from package_row.clinic_id
      or appointment_row.patient_id is distinct from package_row.patient_id
      or appointment_row.appointment_type_id is distinct from package_row.appointment_type_id
      or appointment_row.date < package_row.starts_on
      or (appointment_row.status = 'scheduled' and allocation.lifecycle <> 'scheduled')
      or (appointment_row.status = 'completed' and allocation.lifecycle <> 'availed')
    )
  union all
  select jsonb_build_object('check', 'active_allocation_capacity', 'passed', count(*) = 0, 'violations', count(*))
  from public.packages package_row
  where package_row.total_sessions < (
    select count(*)
    from public.package_session_allocations allocation
    where allocation.package_id = package_row.id and allocation.lifecycle <> 'released'
  )
  union all
  select jsonb_build_object('check', 'package_lifecycle_receipt_parity', 'passed', count(*) = 0, 'violations', count(*))
  from public.packages package_row
  cross join lateral (
    select count(*) filter (where allocation.lifecycle = 'availed')::integer as availed_sessions
    from public.package_session_allocations allocation
    where allocation.package_id = package_row.id
      and allocation.lifecycle <> 'released'
  ) allocation_total
  cross join lateral (
    select coalesce(sum(greatest(payment_row.amount - coalesce(refund_total.refunded_amount, 0), 0)), 0) as net_received
    from public.payments payment_row
    left join lateral (
      select sum(refund.amount) as refunded_amount
      from public.refunds refund
      where refund.payment_id = payment_row.id
        and not exists (
          select 1 from public.refund_reversals reversal where reversal.refund_id = refund.id
        )
    ) refund_total on true
    where payment_row.package_id = package_row.id
      and payment_row.status = 'posted'
  ) receipt_total
  where package_row.status <> 'cancelled'
    and (
      package_row.used_sessions is distinct from allocation_total.availed_sessions
      or package_row.status is distinct from case
        when allocation_total.availed_sessions = package_row.total_sessions then 'completed'
        else 'active'
      end
      or (allocation_total.availed_sessions = package_row.total_sessions and package_row.completed_at is null)
      or (allocation_total.availed_sessions <> package_row.total_sessions and package_row.completed_at is not null)
      or package_row.paid_amount is distinct from least(receipt_total.net_received, package_row.total_amount)
    )
  union all
  select jsonb_build_object('check', 'package_application_allocation_eligibility', 'passed', count(*) = 0, 'violations', count(*))
  from public.payment_applications application
  join public.appointment_charges charge on charge.id = application.charge_id
  where application.status = 'active'
    and application.funding_scope = 'package'
    and not exists (
      select 1
      from public.package_session_allocations allocation
      where allocation.package_id = application.package_id
        and allocation.appointment_id = charge.appointment_id
        and allocation.lifecycle <> 'released'
    )
  union all
  select jsonb_build_object('check', 'ordinary_package_charge_exclusion', 'passed', count(*) = 0, 'violations', count(*))
  from public.appointment_charges charge
  where exists (
    select 1
    from public.package_session_allocations allocation
    where allocation.appointment_id = charge.appointment_id
      and allocation.lifecycle <> 'released'
  ) and exists (
    select 1
    from public.payment_applications application
    where application.charge_id = charge.id
      and application.status = 'active'
      and application.funding_scope = 'ordinary'
  )
  union all
  select jsonb_build_object('check', 'legacy_application_projection_conservation', 'passed', count(*) = 0, 'violations', count(*))
  from (
    select
      application.payment_id,
      charge.appointment_id,
      sum(application.amount) as ledger_amount
    from public.payment_applications application
    join public.appointment_charges charge on charge.id = application.charge_id
    where application.status = 'active'
      and charge.appointment_id is not null
    group by application.payment_id, charge.appointment_id
  ) ledger_projection
  full join (
    select payment_id, appointment_id, sum(amount_applied) as compatibility_amount
    from public.appointment_payments
    group by payment_id, appointment_id
  ) compatibility_projection
    on compatibility_projection.payment_id = ledger_projection.payment_id
   and compatibility_projection.appointment_id = ledger_projection.appointment_id
  where compatibility_projection.compatibility_amount is distinct from ledger_projection.ledger_amount
  union all
  select jsonb_build_object('check', 'appointment_reference_backfill_charges', 'passed', count(*) = 0, 'violations', count(*))
  from public.appointment_charges
  where appointment_reference_id is null
     or (appointment_id is not null and appointment_id is distinct from appointment_reference_id)
  union all
  select jsonb_build_object('check', 'appointment_reference_backfill_adjustments', 'passed', count(*) = 0, 'violations', count(*))
  from public.appointment_charge_adjustments
  where appointment_reference_id is null
     or (appointment_id is not null and appointment_id is distinct from appointment_reference_id)
  union all
  select jsonb_build_object('check', 'appointment_reference_backfill_allocations', 'passed', count(*) = 0, 'violations', count(*))
  from public.package_session_allocations
  where appointment_reference_id is null
     or (appointment_id is not null and appointment_id is distinct from appointment_reference_id)
  union all
  select jsonb_build_object('check', 'legacy_cancellation_event_coverage', 'passed', count(*) = 0, 'violations', count(*))
  from public.packages package_row
  where package_row.creation_origin = 'legacy_unknown'
    and package_row.status = 'cancelled'
    and package_row.billing_version = 2
    and package_row.cancellation_reason = 'Legacy cancelled package migrated to v2'
    and 1 <> (
      select count(*)
      from public.billing_events event_row
      where event_row.entity_id = package_row.id
        and event_row.entity_type = 'package'
        and event_row.event_type = 'legacy_package_cancellation_migrated'
        and event_row.actor_id is not distinct from package_row.cancelled_by
        and event_row.details @> '{"source":"migration_031","billingVersion":2}'::jsonb
    )
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
  union all
  select jsonb_build_object('check', 'package_creation_event_append_only', 'passed', count(*) = 0, 'violations', count(*))
  from public.packages package_row
  where package_row.creation_origin <> 'legacy_unknown'
    and 1 <> (
      select count(*)
      from public.billing_events event_row
      where event_row.entity_id = package_row.id
        and event_row.entity_type = 'package'
        and event_row.event_type = 'package_created'
        and event_row.actor_id is not distinct from package_row.created_by
        and event_row.details ->> 'creationOrigin' = package_row.creation_origin
    )
  union all
  select jsonb_build_object('check', 'payment_creation_event_append_only', 'passed', count(*) = 0, 'violations', count(*))
  from public.payments payment_row
  where payment_row.creation_origin <> 'legacy_unknown'
    and 1 <> (
      select count(*)
      from public.billing_events event_row
      where event_row.entity_id = payment_row.id
        and event_row.entity_type = 'payment'
        and event_row.event_type = 'payment_recorded'
        and event_row.actor_id is not distinct from payment_row.created_by
        and event_row.details ->> 'creationOrigin' = payment_row.creation_origin
    )
)
select jsonb_build_object(
  'manifestVersion', 'carebook-migrations-030-034-v2',
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
  'functionAclChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from function_acl_checks), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(item order by item ->> 'trigger') from trigger_manifest), '[]'::jsonb),
  'legacyTriggerChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from forbidden_trigger_checks), '[]'::jsonb),
  'policies', coalesce((select jsonb_agg(item order by item ->> 'policy') from policy_manifest), '[]'::jsonb),
  'legacyPolicyChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from forbidden_policy_checks), '[]'::jsonb),
  'relationAcls', coalesce((select jsonb_agg(item order by item ->> 'relation', item ->> 'grantee', item ->> 'privilege') from relation_acl_manifest), '[]'::jsonb),
  'functionAcls', coalesce((select jsonb_agg(item order by item ->> 'function', item ->> 'grantee', item ->> 'privilege') from function_acl_manifest), '[]'::jsonb),
  'schemaAcls', coalesce((select jsonb_agg(item order by item ->> 'schema', item ->> 'grantee', item ->> 'privilege') from schema_acl_manifest), '[]'::jsonb),
  'schemaAclChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from schema_acl_checks), '[]'::jsonb),
  'dataChecks', coalesce((select jsonb_agg(item order by item ->> 'check') from data_checks), '[]'::jsonb)
) as migration_proof_manifest;

commit;
