# Operational monitoring

## Signals and privacy

`logger.error/warn/info` emits a single JSON object with timestamp, level, context, message and redacted metadata. Error events preserve a bounded error code, an allowlisted technical error class, and a valid HTTP status, but deliberately omit arbitrary exception messages, stack traces, database details and hints: these can embed patient or billing data. Pass provider errors directly to `logger.warn` rather than forwarding their `.message`; string warnings are reserved for authored, non-sensitive descriptions. Use a stable context to locate the failing operation. Do not put patient names, amounts, raw form values, request bodies, authorization headers or clinical diagnostics in log messages.

The Next.js `onRequestError` hook records unexpected server failures. Selected browser failures (`PatientForm/save`, `PatientForm/submit`, `AppointmentForm/save`, `App/errorBoundary`) report a fixed operation name and random correlation ID to `/api/telemetry`. The endpoint requires a same-origin request and an active clinic user, accepts at most 512 characters, and emits only validated fields to existing Vercel runtime logs. No external telemetry vendor or drain is used. Retention follows the project's existing Vercel plan.

Client reporting is best effort: once per operation per minute in the browser, and five requests per user per minute **per server instance**. The in-memory limiter is a bounded noise brake, not a global abuse quota. It cannot report offline failures or failures before authentication. These events have `source: client`; a submitted event is not independently verified proof of an application failure. Network failure never retries or blocks the user's original operation.

Appointment creation additionally reports fixed stages through an independent `fetch('/api/telemetry')`, outside the Next router action queue. The caller supplies one random UUID correlation ID for the booking attempt and retains it for status checks and retries. Allowed stages are `submit`, `request`, `confirmed`, `rejected`, `timeout`, `unconfirmed`, `status_check`, `retry`, `auto_retry`, `preparation_failed` and `options_failed`. Reports contain only that ID, the fixed operation/stage, an optional integer duration from 0 to 600,000 milliseconds, and an allowlisted application or technical database error code. The endpoint adds the release and `source: client`; it never logs user IDs or form contents. Routine stages are info events, uncertain outcomes are warnings, and refusals/preparation failures are errors under context `client/AppointmentForm/booking`.

Booking stages have a separate limit of 60 accepted reports per user per minute per server instance, so successive bookings and their stages do not consume the legacy five-error budget. The reporter does not await delivery, retry, or report its own failures. Offline, blocked, cancelled or unauthenticated telemetry can be lost; this is operational tracing, not a durable audit trail. A `timeout` or `unconfirmed` event means the browser does not know the write outcome. Correlate client stages with authenticated booking endpoint stages before drawing conclusions about where a save stopped; absence of a client report is not proof that Save was never clicked.

Creation uses `POST /api/appointments/bookings`; read-only reconciliation uses `POST /api/appointments/bookings/status`. Both require an active staff/admin identity, use its cookie-authenticated Supabase client and clinic RLS, and return `x-correlation-id`. Search server context `appointments/booking` for the matching `meta.correlationId`, then compare `received`, `auth`, `validation`, `reconciliation`, `patient`, `conflict_check`, `insert` and `complete` stages. `meta.mode` distinguishes creation from status checks, and durations are cumulative milliseconds from receipt. Provider failures retain only technical codes. Cache invalidation failure after a committed insert does not turn the booking into a failed save.

The browser bounds each booking at 30 seconds overall. Within that budget a transport failure (a dropped connection, or no answer within 6 seconds) automatically resends the identical request, up to four attempts, the last getting all remaining time; each resend reports `auto_retry` with the failure code. This exists because iOS Safari can hold a POST on a silently dropped idle connection for ~13 seconds before failing it, while a healthy save answers in under 1.5 seconds. Any server answer, including a refusal, is final and never resent, and an unreadable response is never resent. Closing the form stops further resends. Only when every attempt fails does an uncertain result preserves the original request and displays a support reference. Check booking reconciles deterministic, actor/clinic-scoped appointment IDs; Retry same booking reuses that request and its IDs, including a stable inline-patient ID and one ID per recurrence. Primary-key constraints prevent concurrent retries, automatic or manual, from duplicating that attempt without a schema migration. Manual recovery never retries a write on its own. An unsuccessful retry still preserves the original uncertain attempt because its earlier request might commit later. This protection applies to the same retained attempt; a separately started booking is a separate intent. Status or later-record edits may conservatively produce an intent mismatch rather than silently change existing records.

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
