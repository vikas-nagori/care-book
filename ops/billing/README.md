# Billing migration operations

These scripts are deliberately outside `supabase/migrations`. They are a fail-closed production
runbook for project `byhccyhbdnqslqdktybt`; they must not run during a normal deployment.

## Approved read-only report

Generate the report while production is still on migration 029. The command performs paginated
GET requests only, rejects every other Supabase project, and exits nonzero on an outcome mismatch.

```sh
dotenv -e /restricted/care-book-production.env -o -- npm run billing:impact-report -- \
  --plan ops/billing/approved-historical-corrections.plan.json \
  --output /restricted/care-book-billing-impact-2026-08-15-final.json
```

The approved report has:

- REST/source fingerprint: `8cb41a69c363db81ef421f7676a6dc1fc678d436674d25844145abfce9417145`
- SQL/live database fingerprint: `8a2c0f4422bf1a670998fb3deff5a795271e8733f08f644cd1aca5355d7e984e`
- fingerprint version: `carebook-billing-source-v1`
- plan fingerprint: `ebed6813ce50f371c851c50e265ba0832b2b4daf33ded38d6cd39469ad62a2b8`
- report checksum: `e3f381edd342de136387315c671c9d0df950c13e52cd912f2051da293e0591b9`
- file SHA-256: `3d4fdcd25aa979824847fd9fc5d0819a5350f5995835ba91021bb68b5ff95468`
- invariant failures: `0`

Its source count manifest is:

```json
{"clinics":3,"patients":78,"appointment_types":9,"global_settings":3,"package_templates":1,"appointments":449,"packages":19,"payments":116,"appointment_payments":346,"package_session_allocations":124}
```

The six billing-source counts captured independently in the immutable initial dump are an exact
match: 78 patients, 449 appointments, 19 packages, 116 payments, 346 appointment-payment rows,
and 124 package allocations. The remaining source tables are protected by the SQL fingerprint.
Asha is present in the all-patient report but is not an expected-outcome/correction target because
her account was corrected manually.

## Executable fail-closed sequence

1. Confirm production is still at migration 029. Generate a fresh 64-character random token in
   the operator shell; never save it in Git.

   ```sh
   BILLING_BYPASS_TOKEN="$(openssl rand -hex 32)"
   ```

2. Install the gate, atomically pause writes, and compare the GET-derived count/fingerprint with
   live SQL. The script persists `paused_mismatch` before exiting nonzero on any mismatch.

   ```sh
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
     -v expected_live_db_fingerprint=8a2c0f4422bf1a670998fb3deff5a795271e8733f08f644cd1aca5355d7e984e \
     -v source_row_counts='{"clinics":3,"patients":78,"appointment_types":9,"global_settings":3,"package_templates":1,"appointments":449,"packages":19,"payments":116,"appointment_payments":346,"package_session_allocations":124}' \
     -v source_fingerprint=8cb41a69c363db81ef421f7676a6dc1fc678d436674d25844145abfce9417145 \
     -v plan_fingerprint=ebed6813ce50f371c851c50e265ba0832b2b4daf33ded38d6cd39469ad62a2b8 \
     -v report_checksum=e3f381edd342de136387315c671c9d0df950c13e52cd912f2051da293e0591b9 \
     -v bypass_token="$BILLING_BYPASS_TOKEN" \
     -f ops/billing/prepare-write-pause.sql
   ```

   The gate installs statement-level guards over clinics, patients, appointment types, fee
   settings, package templates, appointments, packages, receipts, legacy payment applications,
   and package allocations. It stores only the token digest. The token itself is a database- and
   role-scoped setting for the exact migration operator, so each new connection opened by normal
   managed migration tooling receives it; application roles do not. Every bypassed statement is
   logged in `private.billing_ops_bypass_log`.

3. Verify `private.billing_ops_gate.status = 'paused_verified'`, then take and verify the mandatory
   second full production backup. Do not continue on a mismatch. Keep writes paused.

4. Using the same authenticated Supabase project that prepared the gate, apply migrations 030-034
   in order through the Management API query command. Each migration is transactional. Record a
   migration as applied only after its SQL succeeds.

   Production's migrations 001-029 were deployed with timestamped history versions while this
   repository retained short filenames, so `supabase db push` intentionally refuses to reconcile
   that pre-existing history. Do not use `--include-all` or replay the old files. Apply and record
   only the five reviewed migrations below:

   ```sh
   for version in 030 031 032 033 034; do
     file="$(find supabase/migrations -maxdepth 1 -name "${version}_*.sql" -print -quit)"
     test -n "$file"
     supabase db query --linked --file "$file"
     supabase migration repair --linked --status applied "$version"
   done
   ```

   The pause gate's database/role-scoped token is inherited by each query connection. Afterward,
   require all five versions to be present in `supabase_migrations.schema_migrations` and require
   the migration-034 actor/audit columns, triggers, and functions before corrections can start.

5. Run the correction. It refuses a missing, stale (older than 24 hours), mismatched, resumed, or
   wrongly authorized gate. Failure rolls back corrections and leaves writes paused.

   ```sh
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
     -v source_fingerprint=8cb41a69c363db81ef421f7676a6dc1fc678d436674d25844145abfce9417145 \
     -v live_db_fingerprint=8a2c0f4422bf1a670998fb3deff5a795271e8733f08f644cd1aca5355d7e984e \
     -v plan_fingerprint=ebed6813ce50f371c851c50e265ba0832b2b4daf33ded38d6cd39469ad62a2b8 \
     -v report_checksum=e3f381edd342de136387315c671c9d0df950c13e52cd912f2051da293e0591b9 \
     -v bypass_token="$BILLING_BYPASS_TOKEN" \
     -v actor_id=ACTIVE_AMRUTA_ADMIN_UUID \
     -f ops/billing/apply-approved-historical-corrections.sql
   ```

6. Validate the accounting, tenant/RLS, audit, allocation, lifecycle, and count postconditions.
   The correction transaction changes the durable gate to `corrections_applied`. Migration 031's
   backfill intentionally changes source rows, so do not compare a post-migration raw report byte
   for byte with the migration-029 report.

7. Resume only after every postcondition succeeds. This transaction verifies the exact correction
   marker against all four fingerprints, changes the gate to `resumed`, and clears the persistent
   operator-role bypass setting atomically.

   ```sh
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
     -v bypass_token="$BILLING_BYPASS_TOKEN" \
     -f ops/billing/resume-billing-writes.sql
   unset BILLING_BYPASS_TOKEN
   ```

If any step before resume fails, do not clear or edit the gate. Diagnose under the maintained write
pause and use a new report/fingerprint/backup cycle if the 24-hour gate expires.
