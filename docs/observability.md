# Operational monitoring

## Signals and privacy

`logger.error/warn/info` emits a single JSON object with timestamp, level, context, message and redacted metadata. Error events preserve a bounded error code, but deliberately omit arbitrary exception messages, stack traces, database details and hints: these can embed patient or billing data. Use a stable context to locate the failing operation. Do not put patient names, amounts, raw form values, request bodies, authorization headers or clinical diagnostics in log messages.

The Next.js `onRequestError` hook records unexpected server failures. Selected browser failures (`PatientForm/save`, `PatientForm/submit`, `AppointmentForm/save`, `App/errorBoundary`) report a fixed operation name and random correlation ID to `/api/telemetry`. The endpoint requires a same-origin request and an active clinic user, accepts at most 512 characters, and emits only validated fields to existing Vercel runtime logs. No external telemetry vendor or drain is used. Retention follows the project's existing Vercel plan.

Client reporting is best effort: once per operation per minute in the browser, and five requests per user per minute **per server instance**. The in-memory limiter is a bounded noise brake, not a global abuse quota. It cannot report offline failures or failures before authentication. These events have `source: client`; a submitted event is not independently verified proof of an application failure. Network failure never retries or blocks the user's original operation.

Expected `AuthSessionMissingError` events are quiet; unexpected token/network failures still emit error events. Redirects and access enforcement are unchanged.

## Daily appointment completion

The production cron runs at **09:00 Asia/Kolkata / 03:30 UTC**. Search context `cron/auto-complete-appointments` for `meta.phase=start`, followed by `complete` or `failed` with the same `runId`. Completion includes `updatedCount`, `beforeDate` and `durationMs`, not a list of appointment IDs. A zero count is a valid successful run.

The endpoint mutates appointment status: never call the production endpoint just to test monitoring. Use route tests and the local Supabase fixtures. A missing completion by **10:00 IST** needs investigation, even if there is no error record.

## Alerts and remaining provider work

Existing Vercel owner web/email notifications and high-severity anomaly settings are preserved. Vercel anomaly alerts depend on platform traffic/baseline thresholds; they do **not** guarantee delivery for three errors, a fixed 1% threshold, or a missing cron heartbeat. Do not describe a suggested threshold as a configured native rule. See [Vercel alert semantics](https://vercel.com/docs/alerts).

A missing-heartbeat monitor requires a selected service/destination and a delivery test. Until configured, check the cron completion daily. No external account, paid drain, support ticket, or test notification was created by this implementation. Before adding one, record the recipient, allowed payload, retention, costs and owner; verify firing and resolution using synthetic events.

Speed Insights already collects production mobile data. Missing CLS or desktop events is not a zero metric. Verify collection with representative production traffic after release; local development does not establish production beacon delivery. Keep the current CSP intact unless an observed blocked beacon identifies a specific needed origin. Measure at least 50 comparable mobile LCP events before claiming the <2.5s target.

## Weekly log review

Use explicit UTC bounds. For example:

```sh
node --experimental-strip-types scripts/audit-vercel-errors.ts 2026-09-26T05:14:35Z 2026-10-03T05:14:35Z
```

The script reads production error records in 50-record pages, overlaps timestamp boundaries, deduplicates record IDs and fails when pagination stalls or coverage is incomplete. It outputs only counts/statuses; it never saves raw messages or request URLs. Do not use a large CLI line limit as a unique-record count. Review warnings, 5xx queries, deployment status and runtime dashboards separately; this script does not replace those checks.

Supabase log queries have a maximum 24-hour window. Split a week into seven adjacent windows and aggregate each source separately. Count API status groups and Postgres error severities. Count the exact text `Warp server error: Thread killed by timeout manager` separately from gateway errors. It matches a [known PostgREST logging issue](https://github.com/PostgREST/postgrest/issues/4799) with a [merged fix](https://github.com/PostgREST/postgrest/pull/4800), but the hosted build has not been confirmed. Never suppress all provider errors, increase timeouts or retry writes based on that message alone.

Provider support draft (not sent): “Please confirm whether this project's hosted PostgREST build includes fix 4800. The seven-day review found 555 entries with the exact Warp timeout-manager text and 8,598 gateway requests, all 2xx. Can you confirm whether these are idle-connection cleanup logs?” Include the project reference and exact UTC window privately when submitting; attach no clinical payloads.

## Database maintenance

Use current `profiles.status`, not the obsolete `is_active` assumption. For diagnostic dry runs, use a transaction and rollback with minimized local output; do not embed patient billing summaries in `RAISE EXCEPTION` messages.

The remediation migrations restrict the legacy onboarding RPCs, pin builtin-only helper search paths, and turn six request-invariant Auth policy expressions into InitPlans. The operator-installed `private.billing_fp_encode(text)` is altered only when present. Keep server-only tables default-deny, and preserve intentional authenticated billing RPC access. No indexes were removed or added based solely on advisor counts.

Apply migrations before dependent app releases. Verify function grants, search paths and advisors afterwards. Leaked-password protection is enabled on the existing hosted Pro project; future password creation/change may reject compromised passwords. Do not test it by changing real users' passwords.
