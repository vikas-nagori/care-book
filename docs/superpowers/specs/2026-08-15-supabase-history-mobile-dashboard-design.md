# Supabase History and Mobile Dashboard Design

## Goal

Reconcile the production Supabase migration ledger through migration 035, eliminate expected `session_notes` 406 warnings, and reduce the mobile dashboard's initial Supabase request fan-out without weakening authentication, RLS, or billing correctness.

## Safety and sequencing

Work proceeds in this order:

1. Reset a local Supabase database through the full tracked migration chain and run the billing integration suite, including the existing full-payment scenario.
2. Build and run an executable production proof manifest for each of migrations 030 through 034. The manifest must compare exact column/default/nullability definitions, constraints, indexes/views, function and trigger definitions, RLS policies, grants/ACLs, and migration-specific data invariants—not merely object names.
3. Capture the production migration ledger, proof-manifest output, and the pre-035 `pg_get_functiondef` result needed to restore `record_billing_entry_v2` if rollback is required. Keep secrets and patient data out of the snapshot.
4. If and only if every proof passes, mark 030 through 034 as applied using the supported Supabase migration-repair workflow. Any mismatch stops the rollout and is reconciled as schema drift instead of being marked applied.
5. Verify the migration dry run reports only migration 035 pending. Apply migration 035, verify the exact replaced `record_billing_entry_v2` definition and the package full-payment invariant, and confirm 035 is recorded as applied.
6. Only after the database work succeeds, implement and verify the application changes.

Migration repair changes metadata only. It must not execute migrations 030 through 034 again. Migration 035 must be applied exactly from the tracked repository file. Rollback is forward-only: migration 035 remains recorded as applied, and the captured pre-035 function definition is used to create and apply a new tracked rollback migration. The prior definition must never be restored by an untracked SQL edit. No destructive table rollback is needed because 035 replaces one function.

## Session-note lookup

The appointment detail page treats a missing session note as a normal state, but `.single()` asks PostgREST to return exactly one row. Zero rows therefore produces `PGRST116` and HTTP 406 even though the UI handles the absence.

Replace `.single()` with `.maybeSingle()`. It retains the one-row contract, returns `data: null` without an error for zero rows, and still reports an error if the query unexpectedly returns multiple rows. Add a source-level regression test so the appointment query cannot return to `.single()` accidentally.

## Dashboard request reduction

Use a balanced application-side optimization before introducing a billing aggregation RPC:

- Wrap the current-profile lookup in React request memoization so the root layout and page share one auth/profile lookup within a render request.
- Move patients, doctors, internal assignees, external staff, and role-appropriate appointment-type queries behind a server action called when the New Appointment dialog first opens. Keep the successful result in client state for subsequent opens.
- Render a clear loading state and a retryable error state in the dialog. Do not open an incomplete appointment form.
- Merge the dashboard's overlapping appointment-window queries into one range query covering the union of the complete clinic week and the current up-next horizon. Preserve `appointmentVisibilityFilter` and RLS, then derive today's list, this week's count, and the next appointment from the returned rows.
- Preserve a lightweight exact patient count query for the dashboard statistic because the full patient option list is no longer loaded initially.
- Leave current billing queries and calculations unchanged in this change. They are financially sensitive and should be consolidated separately with dedicated database tests if the remaining latency warrants it.

This reduces the initial dashboard Supabase queries from roughly eleven to approximately six, while moving five form-only reads off the critical rendering path.

## Security and error handling

The lazy server action must authenticate through `getCurrentProfile()` and fail closed when no active profile exists. It returns a discriminated, typed success/error result. All option queries continue through the user-scoped Supabase server client, preserve existing RLS, and use staff-safe projections. The action inspects every Supabase error and returns no option arrays if any dependency fails. Errors are logged with the shared logger and returned to the client as a generic retryable failure without exposing database details.

Migration catalog checks and repair are performed against the production project only after confirming its project reference. No patient identifiers or secrets are written to logs or committed files.

## Testing and verification

- Add a failing regression test for `.maybeSingle()` before changing production code.
- Add tests for request memoization and the lazy dashboard option-loading contract, covering each dependency failure, retry, cached subsequent opens, unauthenticated/inactive profiles, and staff-safe field projections.
- Add tests for the single dashboard appointment range and its day/week filtering behavior, including week boundaries and an up-next appointment on the following clinic day.
- Before production mutation, run `npm run e2e:db:reset` and `npm run test:integration`, then verify the linked migration dry run contains only 035.
- Run focused tests after each application change, followed by `npm run test:unit`, `npm run test:component`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- Verify migration ledger rows 030 through 035, re-run the complete catalog/data proof manifest after migration 035, and retain the sanitized before/after outputs as rollout evidence.
- After deployment, compare seven-day mobile homepage TTFB/LCP and Supabase request counts against the audit baseline.
