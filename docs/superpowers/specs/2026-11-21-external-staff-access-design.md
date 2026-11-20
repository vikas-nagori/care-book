# External Staff patient coordination

Status: proposed design for review; implementation has not started.

## Intent

Let a clinic admin work with external practitioners through CareBook while exposing only expressly shared patient contact details and appointments assigned to that practitioner. Admins retain visibility of every booking. A new external account starts with no patient access.

The user confirmed the permitted patient details: name, phone, date of birth/age, gender, email and address. Medical history, clinical notes, referrals and all financial information remain private.

## Current behavior and constraints

- Clinic profile roles are `admin` and `staff`; Staff can read all clinic patients and their full non-financial patient records.
- The current `external_staff` table holds assignable practitioner records. Inviting one creates a regular Staff account, rather than a restricted role.
- Shared appointment types currently clear the assignee in both TypeScript and database triggers. Staff can see shared appointments irrespective of assignee. Neither rule can apply to appointments for the new External Staff role.
- Existing patient and appointment tables contain sensitive columns. Granting the new role SELECT access to the underlying rows would expose those columns through direct API queries even if the UI omitted them.
- Code and migrations, rather than the historical PRD, define current behavior. Preserve the production patient-delete migration `20261120192036` and its tests.

## Requirements from the user

1. Rename the existing External Staff feature to Temporary Staff or an equivalent term.
2. Add a separate External Staff login role that admins can add/invite.
3. Share patients explicitly through an admin-controlled multi-select list. Multiple external accounts can have access to one patient; an external account can have access to multiple patients.
4. Share nothing by default.
5. External Staff can see only the permitted basic details of assigned patients.
6. External Staff can create appointments that appear on their own calendar and the clinic admin's calendar.
7. An admin can book an appointment and assign it to External Staff. Only clinic admins and that external assignee can see that appointment.
8. External Staff cannot see fees, billing information or other clinic information.

## Approaches considered

**Extend the full clinic UI for External Staff.** Reuse patient and schedule screens but add permissions throughout their queries, nested joins, client props, forms and clinical widgets. This saves some visual components but leaves many places where a new role might receive sensitive data.

**Provide a limited coordination workspace (recommended).** Reuse existing visual primitives, authentication and the appointments table, while giving External Staff a narrow route and explicit safe data contracts. Existing clinic/admin calendars remain the source of truth. Underlying database authorization denies the new role general patient and appointment access.

Proceed with the limited workspace after design review. Reusing the current Staff role would fail the privacy requirements, so it is not a viable approach.

## Roles and naming

| Category | Purpose | Access |
| --- | --- | --- |
| Admin | Clinic management | Existing admin access plus external sharing controls |
| Staff | Internal clinic staff | Existing patient access; external-assigned appointments excluded |
| Temporary Staff | Existing assignable practitioner records | Existing behavior, renamed in user-facing labels |
| External Staff | New login role `external_staff` | Shared patient basics and appointments assigned to self |

Keep the legacy table/foreign-key names for migration compatibility; change user-facing text to Temporary Staff in Settings, appointment assignment, invitation/linking messages, mobile sections and connected-tool descriptions. Do not silently change existing Staff users into the new role, or grant new accounts access based on historical appointments. Existing invites attached to Temporary Staff records continue using their existing role.

Extend profile and invite role constraints, TypeScript role types, invite validation, user badges and onboarding. The role is sourced from the admin-controlled invite/profile record, never editable auth metadata. No new external-account invitation is sent as part of development or testing.

## Patient sharing

Add a many-to-many `patient_external_access` relation with clinic, patient, external profile, granting admin and grant timestamp. Enforce uniqueness for patient/profile and clinic consistency. Only active admins in that clinic may manage assignments. Only active External Staff profiles in that clinic can be selected.

On the admin patient detail screen, add a searchable multi-select control:

```text
External Staff access
[Choose people...]
  [x] Asha Patel
  [ ] Ravi Shah

Only selected people can view this patient's basic details and book appointments.
[Save access]
```

The initial selection is empty. A pending invite is not patient access; assignments target active External Staff accounts. Saving an empty selection revokes every external grant for that patient. Ordinary Staff cannot see or change this control, including through direct API calls.

Grant replacement is atomic. A database helper validates the caller, patient and every selected profile before deleting/inserting grants. Reject mixed-clinic, wrong-role, blocked or deleted targets and leave the previous selection intact. Retain an admin audit event for grant/revoke changes without copying patient clinical details into logs.

Revocation stops subsequent reads and bookings, including access to past appointments for that patient; admins keep the appointment history. Previously delivered information cannot be recalled from a person's device. Use fresh, user-scoped reads and clear visible patient/appointment state on denied or revoked responses.

## Appointment ownership and visibility

Use a distinct nullable appointment reference `external_profile_id` for the new login role, separate from `assigned_to` for internal profiles and `external_staff_id` for Temporary Staff records. A booking can have at most one of these assignees. This preserves the distinction when reading older records and avoids granting access through the legacy Temporary Staff linkage.

- External Staff bookings set `created_by` and `external_profile_id` to the authenticated external profile on the server/database. The client cannot choose a creator, clinic or another external assignee.
- Admins can assign an appointment to an external account only when that account already has a grant for the selected patient. Do not grant patient access implicitly through appointment creation. The assignment control explains how to grant patient access if needed.
- A patient can be shared with several external accounts, but an individual appointment has one assignee. Other external accounts with access to the patient do not see that booking.
- External visibility requires current patient access **and** `external_profile_id = auth.uid()`. Being the creator of an appointment does not preserve access after reassignment or revocation.
- External appointments are private to clinic admins and that assignee, even when the selected appointment type is normally shared. Internal Staff must not see them in the calendar, dashboard, patient appointment history, session-note queries, counts or connected-tool results.
- Shared-type normalization must preserve a valid external login assignee. Existing internal/Temporary Staff rules remain as they are unless this feature requires an explicit change.
- Admins retain the existing ability to edit, reschedule, cancel and reassign bookings, with every external assignment validated again against patient access.
- Proposed first-release external permissions are **view and create appointments only**, matching the requested ability to add appointments. External Staff cannot edit/delete patient records, edit/cancel appointments, change appointment status, enter clinical notes or assign people. Admins handle booking corrections.

The external calendar receives only appointment ID, patient reference/name, date, time, duration, appointment type name and status. Do not expose appointment notes, creator details, other assignees, fees, payment status or package links. Appointment-type options expose identifier/name only; their rates stay private.

## Database and API boundary

Keep the general patient, appointment, clinical and financial table policies closed to `external_staff`. Do not add a permissive external SELECT policy to either full table. External users must not retrieve sensitive columns by changing `.select()`, guessing identifiers, using embedded joins or querying a balance view.

Implement narrow database functions for external patient basics, own calendar, safe appointment-type options and appointment creation. Privileged implementations belong in the non-exposed `private` schema, with fixed search paths, explicit active-role/clinic checks, explicit field projection and narrowly granted execution. If public RPC wrappers are needed by Supabase, keep them security-invoker wrappers around the checked private implementations. No browser service-role credentials or service-role-backed general read endpoint.

The admin sharing function is separately restricted to active clinic admins. Protect the assignment relation with RLS and forbid external writes. Database constraints/triggers enforce clinic and assignee invariants even when callers bypass forms.

For external appointment creation:

1. Authenticate and require an active External Staff profile in an active clinic.
2. Lock the patient/access decision consistently with the admin sharing operation to serialize booking against revocation.
3. Require an existing same-clinic patient grant and a valid same-clinic appointment type.
4. Accept only patient, type, date, time, duration and an idempotency reference. Validate bounds server-side; reject unknown or sensitive fields.
5. Resolve the session rate internally for admin billing; never accept or return a financial field from/to the external user. Preserve billing triggers and the clinic ledger's normal appointment lifecycle.
6. Create a scheduled booking assigned to self. A retried request returns the same safe booking only if the actor, access and booking intent still match. It must not create a second booking after an uncertain response.
7. Return only the safe appointment projection. Check booking conflicts only against the current external account's visible appointments. Hidden appointments must not block creation or affect the response; admins resolve resulting overlaps. Conflict and validation errors must not expose other patient names, booking details, rates, database internals or clinical notes.

Review existing security-definer functions and views for alternate access paths. Verify new-role denial on patients, appointments, treatment plans, session notes, doctors/referrals, reminders, settings/rates, payment/package tables, financial views and other users' profiles. Keep self account/password functionality available.

## Screens, routing and administration

External Staff land in `/external`, with limited navigation for My Calendar, Shared Patients and Your Account. Reuse CareBook's existing mobile-first styling and UI primitives.

```text
My Calendar       Shared Patients       Your Account
[Date]                                  [+ Appointment]
09:00  Asha Patel  |  Clinic  |  Scheduled

Shared Patients
Asha Patel
Phone | Email | Age/date of birth | Gender | Address
[Book appointment]
```

The no-access state says that no patients have been shared and directs the user to their clinic admin. Booking is unavailable until at least one patient is shared. Do not show clinic-wide counts, financial tiles, clinical tabs, team directories, clinic reminders or guided tours for internal roles.

Protect clinic routes and server actions as well as navigation. Direct links to `/patients/[id]`, `/schedule/[id]`, the dashboard, settings administration or billing cannot expose additional data. Permit only the intended account/auth routes for the new role; redirect or reject other requests consistently without loops.

Admins invite the new role from Settings, identify External Staff in the user list, grant patient access from patient details, and select eligible external assignees when booking. Update all admin booking entrypoints: dashboard quick-book, schedule, new appointment and appointment edit. Admin calendars show the external assignee clearly and continue to show all clinic appointments.

MCP/connected-tool use is outside the new external workspace's first release. Explicitly prevent external accounts from authorizing new MCP grants and reject existing grants if a profile is changed into the external role. Hide connected-app controls for this role. Do not rely only on hiding tools; token/grant resolution and dispatch must deny the role.

## Scope and proposed defaults

This is a feature spanning database authorization, onboarding, routing, patient sharing, admin booking and a new external workspace. A display-only rename or adding a third option to the invite form does not complete it.

Proposed defaults for review: Temporary Staff is the legacy feature's label; existing users keep their roles; external accounts have create-only booking permissions; assignments are to active External Staff profiles; revocation also removes access to historical bookings; no recurring external booking or MCP access in the initial release.

UI composition, function names, pagination strategy and small component boundaries are left to the implementer, within the required contracts and existing project conventions. Preserve user-timezone handling and clinic-date storage semantics.

### Confirmed booking-conflict decision

On 21 November 2026 the user chose: “Check only their own appointments; let the admin resolve hidden overlaps.” For External Staff, apply the existing same-patient/date/time conflict rule only to appointments visible to that external account. A hidden appointment belonging to an internal practitioner or another external account must not affect booking acceptance, error messages or the returned projection. Allow that overlap; both bookings remain visible to the admin. Keep existing admin/internal Staff booking behavior unchanged, and keep retry/idempotency protection separate from conflict detection.

## Verification and rollout

Write failing integration tests before modifying policies/functions. Exercise real authenticated roles with two clinics, an admin, internal Staff and at least two External Staff accounts. Include:

- No patient access by default; exact allowed field projection after grant; denial for another clinic and another external account.
- No clinical or financial fields through direct table queries, joins, views, RPCs, errors, client props or server-rendered payloads.
- Admin-only multi-select management; multiple grants; atomic rejection of invalid lists; immediate subsequent-read denial after removal.
- External-created booking visible to its assignee and admins only; identical behavior for an admin-created external assignment and for normally shared appointment types.
- External A cannot see External B's appointments for the same shared patient; internal Staff cannot read external appointments or their session notes.
- A hidden same-patient/date/time booking does not prevent an external booking or change its response; both bookings appear for the admin. A conflicting visible appointment assigned to that external account is rejected without exposing any hidden booking.
- External booking rejects unshared patients, cross-clinic types/IDs, forged actors/assignees, financial input, blocked/deleted profiles and inactive clinics.
- Grant revocation and booking do not race into an unauthorized appointment; retrying a booking does not duplicate it.
- Admin/internal Staff behavior, Temporary Staff records, existing onboarding and the admin-only patient-delete restriction remain intact.

Add component and browser coverage for invite-role selection, grant multi-select, the external empty state, field exclusions, booking, both calendars, denied routes, mobile layout and logout/password behavior. Test with disposable local users/data, never by creating real external accounts or mutating production patients.

Run focused tests, complete unit/integration/component checks, lint, typecheck and production build. Obtain independent security/code review and correct material findings. Capture screenshots using disposable records for visible changes.

Deployment requires the new migration before application code begins issuing external-role invites. The previous instruction to apply the patient-delete migration to production is specific to that completed change; this design does not itself authorize deployment of the new feature. Stage and verify the feature for review before the final release step. Preserve the migration and local production-history differences already present; do not broadly push unrelated migrations or repair old history.
