# Home Appointment Staff Visibility Plan

## Summary
- Create a new branch: `fix/home-appointment-staff-visibility`.
- Admins keep full appointment visibility.
- Non-admin users see all clinic appointments, plus only home visits where they are the creator or assignee.
- Existing home visits stay hidden from non-admins until an admin assigns them.

## Key Changes
- Add a Supabase migration, likely `010_home_visit_assignment_visibility.sql`, that adds nullable `appointments.created_by` and `appointments.assigned_to` profile references, indexes them, and uses a trigger to set `created_by = auth.uid()` on insert.
- Replace appointment RLS with the new visibility rule, and tighten `session_notes` RLS so notes for hidden home visits are not readable through the notes table.
- Update `profiles` read access enough to support an assignee picker using `id`, `full_name`, `email`, and `role`.
- Add a shared TypeScript visibility helper so `/schedule`, `/schedule/[id]`, `/patients/[id]`, and dashboard appointment/count queries all apply the same non-admin rule.
- Update `Appointment` types with `created_by`, `assigned_to`, and optional assignee/creator profile fields.
- Add an assignee picker to `AppointmentForm`, shown for home visits. Default new home visits to the current user as assignee, allow choosing any profile, and clear assignment when an appointment is changed back to clinic.

## Interface Changes
- `AppointmentForm` receives `assigneeOptions` and `currentProfileId`.
- Server pages that render appointment forms query profiles for assignee options and pass the current profile id.
- `RestrictedUiAccess` should stop treating staff home visits as a blanket hidden category; staff get limited home-visit visibility through the new appointment helper.

## Test Plan
- Add unit tests for the shared appointment visibility helper:
  - admin sees all appointments
  - staff sees clinic appointments
  - staff sees home visits they created
  - staff sees home visits assigned to them
  - staff does not see unrelated home visits
- Update `restricted-visibility` tests for the new staff behavior.
- Add a migration test that checks for `created_by`, `assigned_to`, creator trigger, appointment RLS, and session-note RLS.
- Run `npm run test:unit`, `npm run lint`, and `npm run build`.

## Assumptions
- "Non-admin users" means staff users.
- Assignment is backed by `profiles`, not a new therapist table.
- Historical home visits have no reliable creator data, so they remain admin-only until assigned.
