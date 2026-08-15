# Supabase History and Mobile Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and reconcile production migrations 030–034, apply migration 035, eliminate expected session-note 406s, and reduce the mobile dashboard's initial Supabase request fan-out.

**Architecture:** Use a reproducible SQL proof manifest and the supported Supabase migration-repair/push workflow for production. In the app, request-memoize the current profile, query one union appointment range, and load all appointment-form options atomically through a typed server action only when the dialog opens.

**Tech Stack:** Supabase CLI/Postgres 17, Next.js App Router/Server Actions, React 19 request cache, TypeScript, Node test runner, Vitest/Testing Library.

---

### Task 1: Build the migration proof manifest

**Files:**
- Create: `scripts/verify-migrations-030-034.sql`
- Create: `src/lib/billing/migration-proof-manifest.test.ts`

- [ ] **Step 1: Write the failing manifest-coverage test**

Read `scripts/verify-migrations-030-034.sql` and assert that it reports sanitized JSON for migration versions 030–034, covers columns/defaults/nullability, constraints, indexes/views, `pg_get_functiondef`, trigger definitions, RLS policies, ACLs, and explicit data-invariant checks. Assert that the script raises on any failed check and includes no domain-row values.

- [ ] **Step 2: Verify RED**

Run: `node --test --experimental-strip-types src/lib/billing/migration-proof-manifest.test.ts`

Expected: FAIL because the proof manifest does not exist.

- [ ] **Step 3: Implement the manifest**

Create a read-only SQL script that normalizes catalog definitions and returns one ordered JSON document. Cover every object and data invariant introduced by:

- `030_staff_appointment_payment_guard.sql`
- `031_auditable_billing_ledger_v2.sql`
- `032_auditable_billing_rpc_security.sql`
- `033_soft_delete_user_profiles.sql`
- `034_billing_creation_audit.sql`

Use catalog sources such as `pg_attribute`, `pg_constraint`, `pg_indexes`, `pg_get_viewdef`, `pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`, `information_schema.routine_privileges`, and aggregate-only invariant checks. Never select patient identifiers or free text.

- [ ] **Step 4: Verify GREEN**

Run the focused test again and confirm it passes.

- [ ] **Step 5: Commit**

Commit: `test: add production migration proof manifest`

### Task 2: Verify the complete migration chain locally

**Files:**
- Modify only if a real defect is found: migration/test files implicated by the failing command

- [ ] **Step 1: Reset the local Supabase stack through migration 035**

Run: `npm run e2e:db:reset`

Expected: exit 0 with migrations 00000000000000 through 035 applied in order.

- [ ] **Step 2: Run billing integration tests**

Run: `npm run test:integration`

Expected: exit 0, including the `record_billing_entry_v2` partial/full package-payment cases in `test/integration/auditable-billing-ledger.test.ts`.

- [ ] **Step 3: Capture the local expected proof**

Run the proof manifest against local Postgres and save sanitized output under `/tmp`, not the repository. Check that every migration reports `ok: true`.

- [ ] **Step 4: Stop on any failure**

If reset, integration tests, or any proof fails, do not connect to production. Diagnose and fix through a new red/green cycle.

### Task 3: Prove production 030–034, repair history, and apply 035

**Files:**
- No committed secrets or production snapshots
- Read from: `supabase/migrations/035_package_full_payment_guard.sql`

- [ ] **Step 1: Confirm the production target**

Link the CLI to project `byhccyhbdnqslqdktybt` and verify the project name/region before mutation. Capture `supabase migration list --linked` to a sanitized `/tmp` file.

- [ ] **Step 2: Capture rollback and production proof**

Run the read-only proof manifest in the authenticated production SQL context. Capture its sanitized JSON plus the exact pre-035 `pg_get_functiondef(public.record_billing_entry_v2(...))` under `/tmp`. Compare production proof to the local expected proof; every 030–034 check must match exactly.

- [ ] **Step 3: Repair only proven versions**

Run `supabase migration repair 030 --status applied --linked` through version 034 one version at a time. Re-run `supabase migration list --linked` and confirm 030–034 are aligned.

- [ ] **Step 4: Dry-run migration 035**

Run: `supabase db push --linked --dry-run`

Expected: only `035_package_full_payment_guard.sql` is pending. Any other pending/reverted migration stops the rollout.

- [ ] **Step 5: Apply migration 035**

Run: `supabase db push --linked`

Expected: migration 035 applies successfully.

- [ ] **Step 6: Verify production after 035**

Confirm the ledger lists 030–035, the post-035 function definition matches the tracked migration, and the proof manifest remains green. If rollback is required, create a new tracked forward migration from the captured function definition; never execute an untracked restore.

### Task 4: Eliminate expected session-note 406s

**Files:**
- Modify: `src/app/schedule/[id]/page.tsx`
- Create: `src/lib/schedule/session-note-query.test.ts`

- [ ] **Step 1: Write the failing regression test**

Assert that the appointment detail's `session_notes` lookup uses `.maybeSingle()` and that no `.single()` occurs in that query chain.

- [ ] **Step 2: Verify RED**

Run the focused Node test and confirm it fails on `.single()`.

- [ ] **Step 3: Implement the minimal fix**

Replace `.single()` with `.maybeSingle()` and remove the now-obsolete `PGRST116` suppression while retaining logging for genuine errors.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `fix: treat missing session notes as expected`

### Task 5: Request-memoize the current profile

**Files:**
- Modify: `src/lib/auth.ts`
- Create: `src/lib/auth-request-cache.test.ts`

- [ ] **Step 1: Write a failing source-contract test**

Assert that the no-argument profile loader is wrapped with React `cache()` and both `getCurrentProfile` and `requireRole` use the cached loader.

- [ ] **Step 2: Verify RED**

Run the focused test and confirm the missing cache wrapper causes failure.

- [ ] **Step 3: Implement request memoization**

Import `cache` from React, keep an uncached private implementation, and expose one cached no-argument loader used by all exported auth helpers. Do not cache across requests or weaken middleware validation.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `perf: deduplicate server profile lookups`

### Task 6: Merge the dashboard appointment ranges

**Files:**
- Modify: `src/lib/dashboard/appointments.ts`
- Modify: `src/lib/dashboard/appointments.test.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write failing range tests**

Add tests proving the union covers the complete clinic week, the current day, and the following-day up-next horizon across week boundaries.

- [ ] **Step 2: Verify RED**

Run the focused dashboard appointment test and confirm the union helper is missing.

- [ ] **Step 3: Implement the pure union helper**

Return the earliest start date and latest end date from the week and up-next ranges.

- [ ] **Step 4: Use one appointments query**

In `src/app/page.tsx`, query the union range once with the fields needed by all three calculations, preserve `appointmentVisibilityFilter`, and derive today's appointments, weekly count, and next appointment from the returned rows.

- [ ] **Step 5: Verify GREEN and commit**

Commit: `perf: share dashboard appointment query`

### Task 7: Load appointment-form options on demand

**Files:**
- Create: `src/app/dashboard-actions.ts`
- Create: `src/lib/dashboard/appointment-options.ts`
- Create: `src/lib/dashboard/appointment-options.test.ts`
- Modify: `src/app/dashboard-new-appointment.tsx`
- Create: `src/app/dashboard-new-appointment.component.test.tsx`
- Modify: `src/app/schedule/appointment-form.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Define and test the atomic loader contract**

Create a discriminated result type and tests covering success, unauthenticated/inactive profiles, and each of the five query failures. Assert no partial arrays are returned and staff appointment-type projections omit payment-sensitive fields.

- [ ] **Step 2: Verify RED**

Run the focused unit test and confirm the loader is missing.

- [ ] **Step 3: Implement the typed server loader**

Authenticate with `getCurrentProfile()`, derive restricted access, execute patients/doctors/profiles/external-staff/appointment-types reads concurrently, inspect every `{ error }`, log server details, and return either a complete typed payload or a generic retryable error.

- [ ] **Step 4: Write failing component tests**

Test initial no-fetch state, loading UI, successful form render, retry after failure, and reuse of cached successful options on later opens.

- [ ] **Step 5: Verify component RED**

Run the focused Vitest file and confirm current eager-prop behavior fails the new expectations.

- [ ] **Step 6: Implement the dialog state machine**

Fetch once on first open, render loading/error/retry states, and render `AppointmentForm` only with a complete payload. Refactor the desktop/mobile wrappers through one internal trigger component so behavior cannot diverge.

- [ ] **Step 7: Supply appointment types without a second fetch**

Add an optional `initialAppointmentTypes` prop to `AppointmentForm`; when supplied, initialize from it and skip the client-side appointment-type request. Preserve existing behavior for schedule/new/detail callers.

- [ ] **Step 8: Remove eager option queries from the dashboard**

Delete patients/doctors/profiles/external-staff reads and related props from `src/app/page.tsx`. Retain the exact patient count query for the dashboard statistic.

- [ ] **Step 9: Verify GREEN and commit**

Run focused unit/component tests and commit: `perf: lazy-load dashboard appointment options`

### Task 8: Full verification and handoff

**Files:**
- Update plan checkboxes and rollout notes only; do not commit `/tmp` evidence

- [ ] **Step 1: Run all verification commands**

Run, in order:

1. `npm run test:unit`
2. `npm run test:component`
3. `npm run test:integration`
4. `npm run lint`
5. `npm run typecheck`
6. `npm run build`

- [ ] **Step 2: Review repository state**

Run `git status --short`, `git diff --check`, and review every branch diff against `origin/main`. Confirm the original working tree remains untouched.

- [ ] **Step 3: Record operational verification**

Report the production migration ledger through 035, proof-manifest status, application test counts, and expected homepage query reduction. Do not claim mobile TTFB/LCP improvement until post-deployment Speed Insights contains new traffic.

