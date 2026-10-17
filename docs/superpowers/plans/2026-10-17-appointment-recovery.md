# Appointment save recovery and tracing

Approved design: the 17 October chat description (authenticated request independent of router actions, 30-second deadline, reconciliation and duplicate-safe retry, correlated non-clinical logs).

Work on `codex/fix-appointment-freeze-tracing`. Preserve existing untracked files. Reuse cookie authentication, RLS, validation and billing triggers; never use a service-role client for bookings. No production writes or deployment are part of this change.

## Tasks

- [x] Add authenticated creation/status endpoints sharing booking logic. Stable per-attempt appointment/patient UUIDs use existing primary-key constraints for concurrent retry protection. Reconcile complete matching records; reject changed or partially matching attempts. Status checks never write. Test sequential/concurrent retries, response loss, recurrence, new-patient replay, access and malformed requests before implementation.
- [x] Extend existing telemetry with bounded appointment stages, one correlation UUID, elapsed time, technical error codes and release. Retain existing event compatibility and redaction; no patient/form contents in telemetry. Browser reporting must not block booking. Test validation, privacy and repeated-attempt limits before implementation.
- [x] Replace the form's creation server action with bounded independent fetch. Guard all asynchronous submission paths, retain details, prevent duplicate clicks, and preserve one request snapshot while its outcome is unknown. Offer status check and retry of that same attempt, handle late responses, and clear loading on errors. Test repeated bookings, rejection, timeout, reconciliation and duplicate prevention before implementation.
- [x] Run focused and complete unit/component suites, lint, type checking and production build. Exercise real local database/browser flows where available; do not use production data for write tests. Obtain a fresh code review and resolve material findings.

## Shared interfaces

`src/lib/appointments/booking-contract.ts` exports `CreateAppointmentInput`, `CreateAppointmentResult`, `BookingRequest = { correlationId: string; input: CreateAppointmentInput }` and UUID/request parsing. `POST /api/appointments/bookings` creates or replays a booking; `POST /api/appointments/bookings/status` reads only and returns the same result contract with `BOOKING_NOT_FOUND` when no complete booking exists. Both echo the correlation ID via response headers. The client keeps the request snapshot across uncertain outcomes and never automatically resubmits writes.

`reportBookingEvent({ correlationId, phase, durationMs?, errorCode? })` is a best-effort browser transport. Allowed phases: `submit`, `request`, `confirmed`, `rejected`, `timeout`, `unconfirmed`, `status_check`, `retry`, `preparation_failed`, `options_failed`. Server stages include received, auth, validation, reconciliation, patient, conflict_check, insert and complete.

## Review focus

Concurrent retries must not duplicate patients or recurring appointments. Timeouts cannot be described as failed writes. A delayed response must not overwrite a newer operation. Unknown outcomes must retain the original request rather than silently adopt edited input. Access checks and status lookups must enforce active staff/admin and clinic RLS. Logging must remain useful across several bookings per minute without exporting clinical data.

## Verification and decisions

Baseline unit suite: 479 tests passed. Regression tests first reproduced stuck saving, missing recovery, and missing telemetry/booking behavior; the final unit suite has 499 passing tests and the component/route suite has 219 passing tests. Type checking passes. A fresh read-only review found one material retry race: a rejected retry did not prove an earlier timed-out request had stopped. A new test failed against that path, then passed after recovery was changed to retain the original attempt for every unsuccessful retry.

Local browser/database coverage passes all 48 unique workflows across admin/staff and desktop/mobile: four new recovery scenarios plus eight existing schedule workflows per role/device. The new cases cover successive afternoon dialogs, concurrent same-attempt recurring booking with inline-patient creation, a response lost after commit, and a deadline followed by status check and safe retry. Expected HTTP 409 booking conflicts and HTTP 429 telemetry limits are narrowly allowed by those tests' console guards; other routes/statuses and uncaught errors still fail. The initial run's ten guard-only failures passed on a focused rerun after those test expectations were updated.

No migration was needed: deterministic, actor/clinic-scoped existing primary keys provide same-attempt uniqueness. Independent new booking attempts retain the existing patient/time conflict behavior. Telemetry delivery remains best effort and rate limited. No production data was written or deployment performed. The default Turbopack build could not bind its CSS worker port under host permissions; the production build was verified with the supported Webpack flag instead.
