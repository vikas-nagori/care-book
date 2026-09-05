# Calendar follow-up reminders

## Approved purpose and scope

Staff and admins need to record inquiry follow-ups and patient return reminders on the existing Care-Book calendar. A reminder can link to an existing patient or contain a free-text name without creating a patient. The user approved separate reminder records, optional time/contact notes, calendar display, editing, rescheduling, completion, and deletion. Notifications are explicitly excluded.

## User flow

Add a clearly labelled “Add reminder” action beside the existing appointment creation action on the schedule, on desktop and mobile. Default the date to the selected calendar date. Open a focused reminder form with a required title and date, optional time, optional phone and notes, and a choice between a free-text name and an existing patient. Patient selection is optional; free-text name is optional when the title already describes the task. Switching to a free-text contact clears the patient link. Saving never inserts or updates a patient.

Allow creation using only a title and date. Trim text, require a non-empty title, and use explicit maximum lengths: title 200, name 200, phone 50, notes 5000 characters. Validate real calendar dates and, when supplied, 24-hour time in HH:mm format. No phone format requirement beyond length, because inquiry information may be incomplete. Permit past dates for correcting historical records. Date and time follow the existing calendar's date conventions; do not convert date-only reminders through UTC timestamps.

Reminders appear in a labelled reminders area associated with each visible day, separate from the appointment time grid. Show the optional time in the card; untimed reminders read “Any time.” The day view shows the selected day's reminders, and the week view associates reminders with each day. Mobile follows its existing selected-day layout. Sort pending before completed; within each group, sort untimed first, then time, then creation order. Do not change appointment counts, booking conflicts, capacity, revenue, or billing behavior. Keep appointment-type filters specific to appointments so they never hide reminders.

Opening a reminder allows editing any form field, changing the scheduled date/time, marking complete or reopening, and deleting after an explicit confirmation. Completed reminders remain on their scheduled day with a clear completed label and subdued appearance. Pending reminders stay on their scheduled date after that date passes; this version does not add an overdue inbox or automatically move reminders forward. Saving refreshes the current calendar; a reminder moved outside the current view disappears from that view as expected.

## Data and access

Create a dedicated `reminders` table through a new migration. Fields: UUID id, clinic_id, nullable patient_id, title, nullable contact_name, nullable phone, nullable notes, date, nullable time, status (pending/completed), nullable created_by, created_at, and updated_at. Default status to pending. Add database constraints matching the text limits and status values, and an index on clinic_id/date for calendar queries. Creator is attribution, not ownership; both active staff and admins in a clinic can manage that clinic's reminders.

Enforce authenticated active clinic membership and admin/staff roles through RLS for select, insert, update, and delete, following the repository's existing helpers. Derive clinic and creator on the server; never trust client-supplied clinic membership. Clinic and creator attribution cannot be reassigned through updates. Enforce that any patient link belongs to the same clinic at database level as well as server validation. Patient selection uses the same authorized patient query as the schedule; do not broaden patient access. Reject inaccessible patient links. Deleting a patient clears the optional link and preserves the reminder title and any user-entered contact fields; do not automatically copy patient data into free-text fields. Deleting a clinic removes its reminders; deleting a creator clears attribution. Calendar data must never reveal another clinic's reminders.

## Implementation boundaries and data flow

Keep reminder validation and ordering in small reusable helpers under `src/lib/reminders`, and add its type to the existing Supabase types. Use dedicated reminder server actions and form/list components rather than extending appointment mutations. Server actions validate inputs, load the current active profile, use the authenticated Supabase client, and revalidate `/schedule` after successful writes.

Extend the schedule server page to fetch reminders for its existing date range and pass them to ScheduleView. Select only reminder fields and the authorized linked patient's id/name needed for display. Keep reminder rendering in focused components so the already substantial schedule view only coordinates its placement. Existing appointment data and actions keep their behavior.

## Errors and concurrency

Show validation errors in the form and preserve entered values on failed saves. Disable duplicate submission while an action is pending. Use the existing logger for server errors and show safe, actionable messages. Verify mutations affected a row before reporting success; inaccessible or removed records return a generic unavailable message. Concurrent edits use ordinary last-successful-write behavior for this version. Refresh after every successful change. A reminder query failure shows an explicit calendar reminder error state, rather than silently looking like no reminders exist. Appointment rendering remains available if the reminder query fails.

## Verification

Test title-only creation inputs, optional patient/free-text inputs, invalid dates/times, trimming/length limits, and ordering/completed behavior. Test actions for active-role access, missing rows, and input rejection. Verify database isolation across clinics, inactive users, cross-clinic patient links, clinic reassignment attempts, and patient deletion preserving reminders. Add component or end-to-end coverage for creation without a patient, creation with a patient, editing/rescheduling, complete/reopen, delete confirmation, and dated display on desktop/mobile and day/week views. Verify reminders do not affect appointment totals or filters and errors remain visible.

Run relevant focused checks, then the repository unit suite, lint, and production build. Manually exercise the affected schedule workflows when the local app/database is available, and report any unverified environment-dependent checks. No production migration or deployment is part of design approval.

## Non-goals

No push, email, SMS, browser alerts, notification delivery, recurring reminders, assignment workflow, lead database, external calendar integration, patient auto-creation, or billing changes.

## Approved mobile design refinement

Mobile is the primary use case. Preserve the actual schedule's top bar, Jump to date, rolling date rail, appointment-type chips, hourly grid, and role-aware bottom navigation. At the top right, place outlined “＋ Reminder” beside the existing filled square “＋” appointment button. Appointment creation remains the primary action. Retain accessible labels and at least 44px touch targets.

Place a collapsible reminders band inside the day panel, immediately after the day/date/appointment-count header and before the hourly grid. Default it to expanded, with a separate reminder count and compact reminder cards; its state may remain local to the view. With zero reminders, show a compact “No reminders for this day” row. Do not repeat the add-reminder action in this band. Appointment counts and appointment filters remain unchanged.

On mobile, the reminder form uses a full-width dialog/page-like surface with a back/close control. Start with “Name only” and “Existing patient” choices; name is optional and creating a reminder does not create a patient. Title and date are required, time is optional, and phone/notes are initially tucked under “Add phone or notes.” Use 16px editable text, accessible field labels, a full-width Save reminder action, and error messages without discarding input. On narrow screens date/time may stack to avoid overflow. The patient choice uses searchable existing patient selection, not a fixed sample list. The approved previews contain sample data only. The user approved these previews with “Done.”
