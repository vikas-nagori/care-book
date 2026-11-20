# External Staff Access Implementation Plan

> **For agentic workers:** Use the approved design as the binding requirements. Implement the independent database, external workspace and admin integration modules against the contracts below, then review and verify the complete flow. Track completion here.

**Goal:** Deliver restricted External Staff patient coordination without clinical or financial disclosure.

**Architecture:** Keep full-table RLS closed to the external role. Supply the external workspace through narrow, checked RPCs; use a separate appointment assignee column and admin-only many-to-many patient grants.

**Tech Stack:** Existing Next.js, TypeScript, React, Supabase and Postgres.

**Spec:** `docs/superpowers/specs/2026-11-21-external-staff-access-design.md` (approved).

## Global Constraints

- Work on the existing feature branch; preserve unrelated untracked files and the previous production patient-delete migration/tests. No production writes, external invitations, merge or deployment.
- External patient fields: id, name, phone, dob, gender, email, address only.
- External calendar fields: id, patient_id, patient_name, date, time, duration_minutes, type, status only.
- External appointments are admin+assigned external only, even for normally shared types. Revocation denies all subsequent external reads/bookings.
- External conflict detection considers only their own visible same-patient/date/time appointments. Hidden overlaps are allowed for admins to resolve. Idempotent retries remain separate.
- Existing Temporary Staff records and users keep their existing behavior and roles. Rename user-facing references, retain historical SQL/table identifiers.
- External accounts cannot access MCP; staff/admin restrictions and audit ledger remain enforced.

## Fixed Integration Contracts

- `profiles.role` / `user_invites.role`: add `external_staff`.
- `appointments.external_profile_id uuid null` references profiles; distinct from `assigned_to` and legacy `external_staff_id`. At most one assignee; external target must have current same-clinic patient access.
- `patient_external_access`: `clinic_id`, `patient_id`, `external_profile_id`, `granted_by`, `created_at`. Admins can SELECT in-clinic; management only through checked atomic RPC.
- `public.replace_patient_external_access(p_patient_id uuid, p_profile_ids uuid[]) returns void`.
- `public.external_workspace(p_start_date date, p_end_date date) returns jsonb`: `{ patients: ExternalPatient[], appointments: ExternalAppointment[], appointment_types: {id,name}[] }`. Dates bound the calendar, not patient access. Expired/blocked/non-external identities rejected; at most 366-day range.
- `public.external_create_appointment(p_request jsonb) returns jsonb`: safe ExternalAppointment. Allowed input keys only `id` (client-generated UUID retry reference), `patient_id`, `appointment_type_id`, `date`, `time`, `duration_minutes`. No new patient, notes, financial fields, actor or clinic from the external client.
- All public wrappers are security-invoker calls into private checked implementations. No service-role clients for these workflows.
- Shared safe TypeScript contracts in `src/lib/external/types.ts`; root owns common supabase types.
- `/external`: My Calendar, Shared Patients, Your Account. Route/query isolation plus database authorization. User-specific data never statically cached.

## Review Focus

- Shared-type assignment normalization and Staff appointment/session-note policies cannot leak external bookings.
- Cross-clinic/fabricated IDs, sensitive request keys and blocked profiles are rejected at the database boundary.
- Grant replacement serializes against booking and invalid targets do not partially revoke access.
- Booking retries after lost responses cannot duplicate or expose another actor's records.
- Existing public functions/views, MCP grants, SSR props and error text do not bypass the safe projections.

## Task 1: Database boundary and behavioral regression tests

**Files:** new CLI-created migration under `supabase/migrations/`; `test/integration/external-access.test.ts`; focused integration additions as needed. Do not edit application files.

- [x] Add tests for new role, no default access, multiple patient grants, field projection, all-table denials, booking/assignment visibility, hidden overlaps, safe retry, cross-clinic/wrong-role/blocked targets and revocation. Observe expected failures first.
- [x] Implement role constraints, relation and grant audit log, checked private/public RPCs and immutable/consistent assignment guards. Update shared-type normalization, full-table Staff policies and appointment helper semantics.
- [x] Re-run focused tests and related tenant/policy/ledger suites; verify an existing-data upgrade. Document exact RPC behavior and test evidence in `/tmp/carebook-external-db-report.md`.

## Task 2: External workspace, onboarding and route isolation

**Files:** `src/app/external/**`, `src/lib/external/**` (except common types), middleware/layout/nav, settings/invites/onboarding, MCP authorization/grant/dispatch boundaries and their focused tests. Do not edit schedule, patient or database files.

- [x] Write failing focused tests for external invite role, route restrictions, MCP denial and safe workspace behavior.
- [x] Implement the three-tab responsive external workspace and safe server actions using the fixed RPCs. Keep account/password/logout available without connected apps or internal tour.
- [x] Add External Staff invite role and readable role labels. Rename the legacy Settings feature and messages to Temporary Staff. Hide/reject internal routes, admin settings and connected apps for external accounts.
- [x] Run focused unit/component/type checks and report to `/tmp/carebook-external-workspace-report.md`.

## Task 3: Admin sharing and appointment integration

**Files:** `src/app/patients/**`, `src/app/schedule/**`, `src/app/dashboard-new-appointment*`, `src/lib/appointments/**`, `src/lib/dashboard/appointment-options*`, and MCP appointment output/assignment fields only if required. Do not edit settings, middleware, layout, database or common supabase types.

- [x] Add focused failing tests for searchable patient access multi-select, external assignment and shared-type preservation.
- [x] Implement admin-only patient grant controls using the replace RPC. Query active same-clinic external profiles and grants; do not allow Staff control or implicit grants.
- [x] Extend all admin booking entrypoints to preserve `external_profile_id`, select only granted external accounts, display the external assignee in admin calendar/details, and handle create/edit/reassignment for shared and restricted types.
- [x] Preserve deterministic internal booking/retry behavior and legacy Temporary Staff assignment. Rename legacy schedule labels. Staff cannot fetch external appointments due database RLS.
- [x] Run focused unit/component/type checks and report to `/tmp/carebook-external-admin-report.md`.

## Task 4: Integration, security review and end-to-end verification

**Files:** root common types/access helpers, any integration corrections, disposable browser fixtures and E2E checks.

- [x] Review independent module reports, reconcile contracts and run complete unit, integration and component suites, lint, typecheck and production build.
- [x] Exercise admin multi-select and both appointment-creation paths using disposable local identities, verify external fields/empty state/denied routes at desktop and mobile sizes, save screenshots with fake records.
- [x] Obtain independent whole-change security/code review; resolve material findings and run affected checks again.
- [x] Report tested behavior and release limitation: implementation is local, migration not applied to production.

## Execution ledger

- User approved design and execution on 21 November 2026. No additional design/plan approval needed.
- Ruling: stay in the already prepared feature branch/checkout; creating another worktree would unnecessarily separate the approved design and prior untracked production migration. Preserve all unrelated files.
- Ruling: the three modules use disjoint file ownership and fixed RPC/type contracts, allowing independent implementation. Root coordinates common contracts, integration checks and final review.
- Tasks 1–3 implemented in the working tree (database report at `/tmp/carebook-external-db-report.md`; the workspace and admin module reports were not written). Checkboxes ticked on verification in Task 4.
- Task 4 (21 November 2026): full suites green before review — integration 182/182 (none skipped), unit 573, component 271, typecheck, lint (0 errors). Full Playwright matrix 406/408: one stale assertion in `e2e/platform/management.spec.ts` expected the raw role `admin`; the platform users list now shows the readable label `Admin`, so the assertion was updated.
- Browser check on the local e2e stack at desktop (Desktop Chrome) and mobile (Pixel 5): external calendar, shared patients, account and empty-state pages render without page errors; `/patients`, `/billing`, `/settings`, patient and appointment detail redirect External Staff to `/external`. No private sentinel, `medical_history`, `session_rate` or `payment_status` value appears in any external response body (HTML, RSC or JSON). Internal Staff do not see the patient-access picker or grant data.
- Independent read-only security review: no critical or high findings. Five findings, all fixed test-first:
  1. Medium — External Staff could backdate a booking, which the nightly job then completes and bills. `external_create_appointment` now rejects dates before the clinic's today (IST); the server action returns "Choose today or a later date."; the booking dialog's date minimum is today and a past calendar day defaults to today. Integration fixtures now use dates relative to the clinic's today.
  2. Low — a failed middleware profile lookup routed internal users to `/external` (with a possible redirect loop). `resolveMiddlewareRole` now distinguishes an empty read (closed workspace routes, as before) from a failed read (503, fail closed for everyone).
  3. Low — one appointment longer than 1440 minutes made the whole external workspace unavailable. Display now accepts any positive duration, as the database does; new bookings keep the 1–1440 bound.
  4. Low — External Staff error-boundary telemetry was dropped. `POST /api/telemetry` is allowed for the role in both middleware and the route; the payload is still parsed to the fixed non-clinical shape and rate-limited.
  5. Low — `private.user_has_retained_history` ignored patient sharing and external assignment. It now counts `appointments.external_profile_id`, `patient_external_access.granted_by` and the access audit trail, so these users are soft-deleted rather than hitting a raw FK error.
- After fixes: integration 184/184, unit 579, component 276, typecheck, lint (0 errors), e2e 408/408 against a freshly reset local stack.
- Release limitation: implementation is verified locally only. Migration `20261120194728_external_staff_patient_access.sql` is not applied to production. Prod already has `20261120192036_patient_delete_admin_only` (this branch's earlier commit), so `main` lags the prod migration history until this branch merges.
