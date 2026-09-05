# Calendar Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give active staff/admins calendar follow-ups with optional patient links and no notifications, preserving the approved mobile schedule.

**Architecture:** Add clinic-isolated reminders, separate from appointments. Dedicated server actions validate and mutate records, while the schedule fetches reminders for its existing date range and renders focused reminder components. Keep appointment/billing behavior unchanged.

**Tech Stack:** Existing Next.js App Router, TypeScript, Supabase Postgres/RLS, React, Radix Dialog, Node tests, Vitest, and Playwright.

**Branch:** `codex/calendar-reminders`. Do not stage `.playwright-mcp/` or environment files. Spec: `docs/superpowers/specs/2026-09-05-calendar-reminders-design.md`. Mobile design approval includes the final refinement section. Use local execution unless delegation is selected. No production migration/deployment.

## Task 1: Database boundary

**Create:** `supabase/migrations/041_calendar_reminders.sql`, `test/integration/reminders.test.ts`.
**Modify:** `src/lib/supabase/types.ts`; update `test/integration/db.ts` only if migration discovery is explicit.

- [ ] Read the existing profile/clinic RLS helpers and integration database builder; locate active-user checks and schema/table grants. Use `rg -n 'has_role|is_same_clinic|current_clinic|status.*active' supabase/migrations` to identify authoritative definitions.
- [ ] Write integration tests using `buildDatabase`, `seedUser`, `queryAsAuthenticated`, and `dropDatabase` as in `test/integration/appointment-types.test.ts`. Cover title-only insertion, same-clinic shared staff/admin CRUD, anonymous/inactive/other-clinic denial, cross-clinic patient rejection, protected clinic/creator edits, invalid title/length/status, and patient deletion retaining a reminder with null link.
- [ ] Run `node --test --experimental-strip-types test/integration/reminders.test.ts`. Expect missing-table failures against available local Postgres; a skipped suite is not a pass.
- [ ] Implement UUID id, clinic FK cascade, optional patient FK set null, optional creator FK set null, date, optional time, title/contact_name/phone/notes, pending/completed status, and timestamps. Require trimmed title, enforce spec limits, index `(clinic_id,date)`. Add RLS for all four operations using active role/clinic helpers. Derive clinic/creator on insertion and prevent reassignment on updates. A guarded database function/trigger must validate linked patient clinic, even for direct REST writes; use a fixed search_path and narrow grants. Permit FK-driven creator nulling when deleting the creator without permitting caller reassignment.
- [ ] Add exported `Reminder` and normalized calendar-row types matching the schema. Patient join exposes only authorized id/name. Do not add payment fields.
- [ ] Rerun focused integration tests, record environment skips honestly, and commit `feat: add clinic-scoped calendar reminders`.

## Task 2: Validation and ordering

**Create:** `src/lib/reminders/validation.ts`, `src/lib/reminders/validation.test.ts`, `src/lib/reminders/ordering.ts`, `src/lib/reminders/ordering.test.ts`.

- [ ] Write unit cases for trimmed title-only inputs, blank optional values becoming null, optional patient UUID, name-only mode clearing patient ID, invalid real dates including leap days, invalid HH:mm, all text limits, pending-before-completed ordering, untimed-before-timed ordering, and deterministic creation/id tie breaks.
- [ ] Run `node --test --experimental-strip-types src/lib/reminders/*.test.ts`; expect failure before helper implementation.
- [ ] Implement `validateReminderInput(input: unknown)` as a discriminated result returning `{success:true,data}` or `{success:false,message}`. Whitelist title, patientId, contactName, phone, notes, date, and time; never accept clinic/creator in normalized mutation data. Require only title/date. Use strict date round-trip checking without local/UTC date shifting and strict `^(?:[01][0-9]|2[0-3]):[0-5][0-9]$` time validation. Validate IDs separately for mutation actions.
- [ ] Implement `sortReminders` without mutating input. Sort status, null-time precedence, time string, created_at, id. Use stored date strings for grouping; reuse the schedule timezone/date helpers for defaults.
- [ ] Rerun focused tests and commit `feat: validate and order follow-up reminders`.

## Task 3: Server actions

**Create:** `src/app/schedule/reminder-actions.ts`, `src/app/schedule/reminder-actions.component.test.tsx`.

- [ ] Add Vitest mocks for current profile, authenticated Supabase client, logger and revalidation. Test invalid payloads, inactive/no profile, same-clinic patient checks, database failures, zero affected rows, and successful create/update/status/delete. Ensure clinic/creator are sourced from the authenticated profile.
- [ ] Run `npx vitest run src/app/schedule/reminder-actions.component.test.tsx` and confirm initial missing implementation failure.
- [ ] Export async create/update/status/delete server actions with serializable discriminated success/error results. Apply validation before queries, require active staff/admin and clinic membership, validate accessible linked patients in the clinic, and use authenticated-client RLS. Create sets pending; general edit excludes status/clinic/creator; status action accepts only pending/completed. Mutation queries return/select id so zero rows cannot look successful. Log internal errors, return safe messages, and revalidate `/schedule` only on success.
- [ ] Run focused action tests and commit `feat: add reminder management actions`.

## Task 4: Mobile form and details

**Create:** `src/app/schedule/reminder-form.tsx`, `src/app/schedule/reminder-dialog.tsx`, `src/app/schedule/reminder-form.component.test.tsx`.

- [ ] Add component tests for name-only creation, existing-patient selection, optional phone/notes disclosure, required title/date, retained input after error, duplicate-submit prevention, edit/reschedule defaults, complete/reopen and confirmed deletion.
- [ ] Run `npx vitest run src/app/schedule/reminder-form.component.test.tsx` to verify missing-component failure.
- [ ] Implement a controlled form accepting authorized patients, defaultDate, optional reminder, and onSuccess. Reuse patient-search behavior from `src/lib/schedule/patient-search.ts` with native accessible choices. Default to name-only for new reminders. Changing to name-only clears patient ID. Send only whitelisted fields to the action. Reveal existing phone/notes when editing. Validate title/date and render server errors with role=alert. Disable pending action controls and keep form values on error.
- [ ] Implement dialog details and form modes with existing Radix components. Provide mobile page-like width, accessible title/back, 16px input text, 44px controls, full-width save, responsive date/time fields, and desktop bounded dialog. View mode exposes complete/reopen, edit/reschedule, delete confirmation; refresh on success. Preserve ordinary dialog focus restoration and Escape handling.
- [ ] Rerun component tests; commit `feat: add mobile reminder form and details`.

## Task 5: Calendar integration

**Create:** `src/app/schedule/reminder-list.tsx`, `src/app/schedule/reminder-list.component.test.tsx`, `src/app/schedule/schedule-reminders.component.test.tsx`.
**Modify:** `src/app/schedule/page.tsx`, `src/app/schedule/schedule-view.tsx`.

- [ ] Write component coverage for expanded/collapsed reminders, zero-reminder row, completed state, selected date filtering, independent reminder count, reminder query error, and separate appointment/reminder creation buttons. Cover week grouping and preservation of appointment-type filters.
- [ ] Run `npx vitest run src/app/schedule/reminder-list.component.test.tsx src/app/schedule/schedule-reminders.component.test.tsx` and verify initial failures.
- [ ] Fetch reminders alongside existing server queries using rangeStart/rangeEnd. Normalize optional patient joins and propagate an explicit reminder-load-error flag. Query failure must not suppress appointment rendering. Pass normalized reminder rows and authorized patients to ScheduleView.
- [ ] Render outlined “＋ Reminder” immediately left of the existing primary square appointment plus in the mobile top bar. Keep both touch targets at least 44px and preserve appointment dialog behavior. Add a secondary reminder action alongside desktop appointment creation.
- [ ] Render the dedicated collapsible band inside the day card after the day/date/count header and before the hourly grid. Show compact zero-state text, optional time/name, title, and completed state; route card taps to reminder details. Keep reminder count separate from appointment counts. Do not change existing date rail, Jump to date, filters, hourly scale, or bottom navigation.
- [ ] In week view render per-day reminder bands associated with dates above that day's appointment grid; prevent appointment-type filtering from hiding reminders. Keep rendering delegated to the reminder list component.
- [ ] Rerun focused component tests and commit `feat: display follow-up reminders on the calendar`.

## Task 6: Verification and handoff

**Create:** `e2e/reminders.spec.ts` following existing authenticated fixtures and role conventions.
**Modify:** Design/plan checklist only as needed to record final behavior and verification.

- [ ] Inspect existing E2E fixtures and add meaningful staff/admin flow coverage: title-only reminder does not create patient, linked-patient reminder, edit/date move, complete/reopen, cancel and confirm delete, both create buttons, and empty-state return. Use isolated fixture clinics/patients and clean up only test records.
- [ ] Run the focused tests from Tasks 1–5, then `npm run test:unit`, `npm run test:component`, `npm run lint`, `npm run build`, and `npm run typecheck`. Expected: all pass. Investigate new failures; distinguish pre-existing issues and local service limitations.
- [ ] With local test database available, run `npx playwright test e2e/reminders.spec.ts`; do not seed or mutate production. A missing database or skipped suite must be reported as unverified.
- [ ] Visually inspect 320px/390px mobile and desktop schedule, no-reminder and populated states, form with keyboard-sized viewport, long names/titles, selected future dates, and week view. Check touch target spacing and no horizontal overflow. Save screenshots for visible-change review.
- [ ] Review diff for patient auto-creation, billing exposure, cross-clinic access and accidental unrelated changes; run `git diff --check`. Request code review via applicable review skill before final handoff.
- [ ] Commit focused remaining test changes. Report branch, migration requirement, checks actually run and limitations. Do not deploy or apply migrations to production.
