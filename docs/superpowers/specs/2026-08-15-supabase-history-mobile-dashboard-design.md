# Supabase History and Mobile Dashboard Design

## Goal

Reconcile the production Supabase migration ledger through migration 035, eliminate expected `session_notes` 406 warnings, and reduce the mobile dashboard's initial Supabase request fan-out without weakening authentication, RLS, or billing correctness.

## Safety and sequencing

Work proceeds in this order:

1. Query production catalog metadata for a migration-specific set of tables, columns, functions, and triggers proving that migrations 030 through 034 are already present.
2. If and only if every proof passes, mark 030 through 034 as applied in `supabase_migrations.schema_migrations` using the supported Supabase migration-repair workflow.
3. Apply migration 035, verify the replaced `record_billing_entry_v2` function and its package full-payment guard, and confirm 035 is recorded as applied.
4. Only after the database work succeeds, implement and verify the application changes.

Migration repair changes metadata only. It must not execute migrations 030 through 034 again. Migration 035 must be applied exactly from the tracked repository file.

## Session-note lookup

The appointment detail page treats a missing session note as a normal state, but `.single()` asks PostgREST to return exactly one row. Zero rows therefore produces `PGRST116` and HTTP 406 even though the UI handles the absence.

Replace `.single()` with `.maybeSingle()`. It retains the one-row contract, returns `data: null` without an error for zero rows, and still reports an error if the query unexpectedly returns multiple rows. Add a source-level regression test so the appointment query cannot return to `.single()` accidentally.

## Dashboard request reduction

Use a balanced application-side optimization before introducing a billing aggregation RPC:

- Wrap the current-profile lookup in React request memoization so the root layout and page share one auth/profile lookup within a render request.
- Move patients, doctors, internal assignees, and external staff option queries behind a server action called when the New Appointment dialog first opens. Keep the loaded result in client state for subsequent opens.
- Render a clear loading state and a retryable error state in the dialog. Do not open an incomplete appointment form.
- Merge the dashboard's overlapping appointment-window queries into one range query and derive today's list, this week's count, and the next appointment from that result.
- Preserve a lightweight exact patient count query for the dashboard statistic because the full patient option list is no longer loaded initially.
- Leave current billing queries and calculations unchanged in this change. They are financially sensitive and should be consolidated separately with dedicated database tests if the remaining latency warrants it.

This reduces the initial dashboard Supabase queries from roughly eleven to approximately six, while moving four form-only reads off the critical rendering path.

## Security and error handling

The lazy server action must authenticate through `getCurrentProfile()` and fail closed when no active profile exists. All option queries continue through the user-scoped Supabase server client, preserving existing RLS. Errors are logged with the shared logger and returned to the client as a generic retryable failure without exposing database details.

Migration catalog checks and repair are performed against the production project only after confirming its project reference. No patient identifiers or secrets are written to logs or committed files.

## Testing and verification

- Add a failing regression test for `.maybeSingle()` before changing production code.
- Add tests for request memoization and the lazy dashboard option-loading contract.
- Add tests for the single dashboard appointment range and its day/week filtering behavior.
- Run focused tests after each change, followed by `npm run test:unit`, `npm run test:component`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- Verify migration ledger rows 030 through 035 and re-query the migration-specific catalog proofs after migration 035.
- After deployment, compare seven-day mobile homepage TTFB/LCP and Supabase request counts against the audit baseline.

