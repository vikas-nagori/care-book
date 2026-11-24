# E2E coverage hardening plan

Date: 2026-11-24 · Audited commit: `main` @ `e9bcf24` · Status: plan only, nothing implemented

This plan closes the gaps found by a full audit of `e2e/` against every form, button and
server action on `main`. It is written to be handed to implementation agents: Phase 0 is one
agent working alone, Phase 1 is seven agents working in parallel on files they own exclusively,
Phase 2 is one agent.

## 1. Verdict

The suite does **not** yet protect against either of the 2026-11-24 incident classes outside
the exact spots that were patched.

| Incident class | What protects us today | What is missing |
|---|---|---|
| Optional field left blank → crash or "null" on screen | 9 minimal-input cases (`e2e/shared/minimal-input.spec.ts`, `e2e/admin/minimal-input.spec.ts`) | No edit-to-blank case for any form. Minimal records are checked on a subset of the screens that render them. External Staff, platform and public forms have no minimal case. Route smoke never sees a sparse row (the seed has no NULL phone, fee, email, name or invite) and never runs the null-leak check. `expectNoLeakedNulls` misses attributes, `Invalid Date`, empty `tel:` links and glued tokens. |
| Button stuck / click does nothing when the request fails | Unit tests of `runServerAction`, a static call-site guard, and **one** component test (`invite-ui.component.test.tsx`) | **Zero** e2e tests fail a server action or a direct Supabase write. The only fault injection in the suite targets `/api/appointments/bookings`. 43 of 44 `callServerAction` call sites have no failure test at any layer that renders the UI. No e2e test asserts a button returns to idle after any failure. |
| Whole features with no e2e at all | — | Edit Appointment submit, refund, reverse refund, adjust fee, recurring booking success, dashboard booking, billing "Load more", patients "Load more", doctor referral, "Add anyway" duplicate, Temporary Staff → Create login, admin invite, external booking from the patient dialog, week view, External Staff change password / logout. |
| Structural | `route-manifest.test.ts` forces every `page.tsx` into a manifest | Nothing forces a form to have a minimal case or a mutation to have a failure test. The external routes are in the manifest but no spec consumes them, and `e2e/external/coordination.spec.ts` uses neither `attachErrorGuards` nor `expectNoLeakedNulls`. |

The audit also found product bugs (section 8). Two were re-verified by hand against the source:
the schedule "Day total → Expected" is always ₹0, and a pending mobile-only Staff invitee
appears as a blank option in the assignee picker.

### 1.1 Primary client: the installed mobile app

Almost every clinic user works in the installed phone app (iOS and Android home-screen PWA).
Desktop is secondary. This changes what "covered" means, and the plan follows these rules:

- **Mobile is the mandatory project.** When a case runs on one project only, it is the mobile
  one. A case may skip desktop; it may not skip mobile. The only exceptions are controls that do
  not exist on mobile (the desktop "Day total" panel, the Week toggle) and the platform console,
  which is used by the owner on desktop.
- **Both incidents were mobile incidents.** The stuck "Creating login…" button was a phone
  running the previous build after a deploy; the `/settings` crash came from a mobile-only invite.
  So the stale-build path, the resume path and the mobile sheets are first-class test targets,
  not edge cases.
- **Mobile-only conditions the suite barely touches today** (only
  `e2e/shared/mobile-app-lifecycle.spec.ts`, three tests):
  - the app resumed after minutes in the background while a form or sheet is open;
  - a resume that discovers a newer deployment and reloads;
  - a tap on a build that is already stale (before any resume check ran);
  - no signal or a dropped connection at the moment of the tap;
  - a double tap on a submit button;
  - a cold start on a deep link after the app was killed, with no sign-in prompt;
  - the on-screen keyboard and the bottom navigation covering a submit button or an error message;
  - the native share sheet (login details, payment-due PDF) and `tel:` links.
- **The mobile browser engine is only half covered.** Both mobile projects are Pixel 5 on
  Chromium. Nothing runs on WebKit, which is what every iPhone uses (see D5).
- **Hidden twins matter more on mobile.** Many screens render a desktop table and a mobile card
  list or sheet side by side. Every null-leak visit in this plan must open the mobile sheets and
  cards, not just load the page.

Section 5.7 is a dedicated mobile work package; the rules above also apply inside 5.1–5.6.

## 2. Decisions (all settled by the owner, 2026-11-24)

| # | Question | Decision |
|---|---|---|
| D1 | A new test exposes a real bug | **Fix small, pin the rest.** Fix in the same work package when the fix is under ~20 lines and the bug is listed "fix with tests" in section 8. Otherwise write the test for the correct behaviour and mark it `test.fail()` with the bug id in the title, so it turns red the day the bug is fixed and forces removal of the marker. |
| D2 | Runtime (about 140 new cases) | **Mobile only where the control is the same.** A failure case runs on one **mobile** project when the control's DOM is identical across roles and viewports, and on both viewports ("D+M") only where the code renders separate desktop and mobile controls. Desktop is what gets dropped, never mobile. The table-driven component test (Phase 2, L1) covers every call site. Raise CI shards from 6 to 8 if wall time grows by more than 25%. |
| D3 | OAuth consent and Connected Apps (off in the e2e env) | **Skip in e2e for now.** Cover the routes with `*.route.test.ts` (L6) and record the consent UI in the mutation manifest with an explicit exemption string. |
| D4a | Clearing Age on a patient who has a legacy date of birth | **The age is removed and the stored date of birth is deleted.** After Age is cleared and saved, `dob`, `age_years` and `age_recorded_on` are all NULL and no age is shown anywhere. The owner confirmed this explicitly, knowing it reverses the earlier "dob is never rewritten" rule for this one case. Change C-1. |
| D4b | Rebooking a slot whose appointment was cancelled | **Allow it**, as External Staff already can. Change C-2. |
| D4c | Admin clears the Session Fee on Edit Appointment | **Block with a validation message**; `0` stays valid for a free session. Change C-3. |
| D4d | Signed-in user opens `/auth/update-password` directly | **Redirect to `/settings`.** Only a session that arrived from a reset link may use the page. Change C-4. |
| D5 | iPhone coverage | **Add the `mobile-ios` project** (`devices['iPhone 14']`, WebKit) running the `@ios` subset: route smoke, both minimal-input specs, the fault-injection smoke and lifecycle cases M-1, M-2, M-6, M-9. WebKit is installed on one CI shard only. |
| D6 | Resume finds a newer build while a form is half-typed | **Keep reloading at once.** The lost input is accepted. M-3 asserts the reload happens and the app comes back signed in on the same screen; it does not assert that input survives a version change. |

## 3. Ground rules for every implementation agent

- Work on a branch (`test/e2e-<package>`); never commit to `main`. Merge with `git merge --no-ff`.
- After every push, watch the `Tests` workflow to completion and report by job name / shard.
- No production names, phones or emails in fixtures. Use `factory.uniqueName()` / `factory.uniqueMobile()`.
- Every new case attaches `attachErrorGuards` before navigation and ends with `guards.assertClean()`. Every case that renders a record calls `expectNoLeakedNulls` on each screen it visits.
- Fault-injection specs set `test.use({ serviceWorkers: 'block' })` and assert `fault.hit()` is true, so a route that never fired cannot pass.
- No `waitForTimeout`. A negative assertion ("nothing was saved") must follow a positive one (the error message is visible, or the held request was released).
- Do not edit a file owned by another package (section 6). Shared files are changed only in Phase 0. If a package needs a new factory or seed row, it asks Phase 0's owner; it does not add it itself.
- Mobile first: develop and debug each case on the `*-mobile` project, then confirm desktop. Use `locator.tap()` for submit controls in mobile-only cases (the mobile projects have touch enabled). When reporting a failure, lead with the mobile result.
- Every screen a case visits on mobile must have its sheets, cards and bottom-sheet dialogs opened before the leak check, and the submit control and any error message must be inside the viewport (`expectInViewport`, F9).
- Local run before pushing: `npm run e2e:db:up`, `npm run build:e2e`, then `npx playwright test <spec> --project=<project>` for the touched specs, then `npm run lint && npm run typecheck && npm run test:unit`.
- A new `e2e/support/*.test.ts` must be added to the explicit file list of `test:e2e:support` in `package.json`, or it never runs.

## 4. Phase 0 — foundation (one agent, lands first)

Branch `test/e2e-foundation`. Everything here touches shared files, so it is sequential.

### F1. Fault-injection helper — new `e2e/support/fault-injection.ts`

```ts
type ActionFault = 'abort' | 'lost-response' | 'http-500' | 'stale-deployment'
failNextServerAction(page, mode: ActionFault): Promise<{ hit(): boolean; dispose(): Promise<void> }>
holdNextServerAction(page): Promise<{ release(): Promise<void>; count(): number }>
failNextSupabaseCall(page, { resource: 'rest/v1/<table>' | 'auth/v1/<path>', method?, mode: 'abort' | 'http-500' | 'http-400' })
holdNextSupabaseCall(page, { resource, method? })
expectButtonRecovers(button, { idleName, message, fault })
```

Facts the implementation must follow (verified in `node_modules/next/dist` for Next 16.3.4):

- A server action is a `POST` to the **current page URL** carrying a `next-action` request header. Predicate: `request.method() === 'POST' && request.headers()['next-action'] !== undefined`.
- Do not use `page.route(..., { times: 1 })` with a catch-all URL: the first non-matching request would consume it. Register the route, count matches yourself, call `route.fallback()` for non-matches and after the first hit.
- `abort` → `route.abort('failed')`. `http-500` → `route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' })`. `lost-response` → `await route.fetch()` then `route.abort('failed')` (the row is committed, the reply is lost; pattern already used at `e2e/shared/appointment-recovery.spec.ts:147`). `stale-deployment` → `route.fulfill({ status: 404, headers: { 'x-nextjs-action-not-found': '1', 'content-type': 'text/plain' }, body: 'Server action not found.' })`; the app then reloads the page after 1.5 s, so callers await the `load` event.
- Supabase origin comes from `process.env.NEXT_PUBLIC_SUPABASE_URL`, never a literal.
- Export the user-facing message constants for specs by importing them from `src/lib/actions/run-server-action.ts` and `src/lib/actions/request-error-message.ts` (do not copy the strings).
- `expectButtonRecovers` asserts: the message is visible (toast region or `role=alert`), the button is visible **and enabled** with its idle name, no element with the pending name remains, and `fault.hit()` is true.
- Add `e2e/support/fault-injection.test.ts` only if there is pure logic to test; otherwise prove the helper with one smoke spec in F8.

### F2. Stronger assertions — `e2e/support/assertions.ts`

1. `expectNoLeakedNulls(page, { scope? })` additionally fails on:
   - tokens `Invalid Date`, `[object Object]`, `Infinity`, and `null` / `undefined` / `NaN` even when glued to other text (`NaNyears`, `nullm`); keep the word-boundary rule for `null`/`undefined` only where needed to avoid false positives on real words, and list the allow-list in the file;
   - the same tokens in `aria-label`, `title`, `placeholder`, `alt` and in `input`/`textarea` values;
   - links whose `href` is an empty `tel:`, `mailto:`, `sms:` or a `wa.me/` with nothing after it;
   - the same scan over `textContent` of hidden desktop/mobile twins, reported under a separate key.
2. `attachErrorGuards(page, options)` gains `expectedFailures?: { url: RegExp; text: RegExp }[]` (any origin; needed because an aborted request logs `net::ERR_FAILED` and Supabase is a different origin) and `allowCrashText?: readonly string[]` (the fallback copy in `request-error-message.ts` contains "something went wrong", which is in `CRASH_TEXT`).
3. Add the app's own error-boundary copy from `src/app/error.tsx` ("Unable to load this page") to the crash detection.
4. `gotoSuccessfulRoute` calls `expectNoLeakedNulls` after `networkidle`. Confirm first that no seeded text legitimately contains the tokens.
5. New `openEverySurface` helpers are **not** added here; each package owns the per-screen visitors listed in its section.

### F3. Sparse fixtures — `e2e/support/seed.ts`, `e2e/support/ids.ts`, `e2e/support/route-manifest.ts`

Add fixed-ID rows to Clinic A so that every route smoke run renders NULL-bearing data. Verify each row against its check constraints before adding. Date them outside windows that count-sensitive specs assert on (`shared/patients.spec.ts:169`, `shared/schedule-date-strip.spec.ts`, `admin/billing-metrics.spec.ts`, dashboard tiles) and re-run those specs.

| Fixture id | Contents |
|---|---|
| `patientSparse` | name only; every nullable column NULL, including phone |
| `appointmentSparse` | on `patientSparse`, completed, `notes` NULL, `fee` NULL |
| `sessionNoteSparse` | on `appointmentSparse`, all five SOAP fields NULL |
| `treatmentPlanSparse` | diagnosis + start date only |
| `paymentSparse`, `packageSparse` | `notes` NULL; package legacy shape (`billing_version` 1, NULL `appointment_type_id` / `starts_on`) if the ledger triggers allow a direct insert, else document why not |
| `reminderSparse` | title + date only, dated today |
| `externalStaffSparse` | Temporary Staff with `email` and `notes` NULL |
| `inviteMobileOnly`, `inviteLegacy`, `inviteRevoked` | pending with `email` NULL; pending with `full_name` NULL; revoked |
| `profileMobileOnly`, `profileNameless` | accepted Clinic A staff with `email` NULL; one with `full_name` NULL |
| `doctorSparse` + `patientReferredByDoctor` | doctor with `specialty` / `address` NULL |
| `onboardingPendingSparse` | `clinic_phone`, `clinic_address` NULL |
| `patientExternalSparse` + appointment | granted to `EXTERNAL`; name only; appointment `notes` NULL |
| `externalApptYesterday`, `externalApptCompleted` | external-created rows for the read-only dialog states |
| `packageClinicB` | one package in Clinic B for tenant-isolation |

Add manifest cases pointing `/patients/[id]`, `/patients/[id]/edit`, `/schedule/[id]`, `/billing/payment-due/[patientId]` and `/billing/packages/[id]` at the sparse ids (second case per pattern; the existing populated case stays).

### F4. Factory extensions — `e2e/support/factories.ts` (+ `factories.test.ts`)

All in Phase 0 so Phase 1 never edits this file.

- `createPatient` / `createAppointment`: keep defaults, document `phone: null`, `fee: null`, `notes: null` overrides; allow `dob`, referral columns (`referral_source` + NULL referrer / NULL doctor).
- `createAuthUser`: accept `role: 'external_staff'`, `email: null`, `fullName: null`, `status: 'blocked'`.
- `createUserInvite`: accept `fullName: null`, `mobileNumber: null`, `role`.
- New: `createExternalStaff`, `createReminder`, `createSessionNote`, `createTreatmentPlan`, `createDoctor`, `createRefund`, `createPayments(n)`, `createPackages(n)`, `createPatients(n)`, `shareWithExternal(patientId, profileIds)`, `createExternalBooking`, `findRefunds`, `findChargeAdjustments`, `findSessionNotes`, `findReminders`, `findTreatmentPlans`, `findDoctors`, `deletePatientHard`, `deleteAppointmentHard`.
- `createOnboardingRequest`: unique `owner_mobile_number` (fixed today), optional `ownerEmail` to collide on purpose.
- Teardown order: refunds and fee adjustments before payments; access-audit rows before disposable users.

### F5. External route smoke and manifest check

- New `e2e/external/routes.spec.ts`: `gotoSuccessfulRoute` for each `pageRoutesFor('external')` case, both external projects. Repoint the three manifest `owner` fields.
- `e2e/support/route-manifest.test.ts`: the owner spec must contain `pageRoutesFor('<access>')` or the literal `requestPath`, so an unconsumed manifest entry fails the build.

### F6. Mutation manifest guard — new `e2e/support/mutation-manifest.ts` + `.test.ts`

One entry per mutation surface: `{ id: '<actions file>#<export>@<client file>', kind: 'server-action' | 'form-action' | 'supabase' | 'fetch', happy, minimal, failure }`, where each of the three is `{ spec, title }`, `{ exempt: '<reason>' }` or, during Phase 1 only, `{ todo: '<package>' }`.

The test (node:test, added to `test:e2e:support`):

1. Discovers every export of a `'use server'` module, every `callServerAction(() => X(` call site, every `action={X}` bound to a server action, every client-side `.from('t')…insert|update|delete|upsert`, `supabase.auth.signInWithPassword|updateUser|resetPasswordForEmail|signOut`, and client `fetch('/api/…', { method: 'POST' })`. Reuse the walker from `src/lib/actions/server-action-call-sites.test.ts`. Asserts discovered ids equal manifest ids.
2. Dead exports (`updateAppointment`, `reconcilePatientBilling`, `previewBillingAllocation`, `softDeleteUser`, the treatment-plan `update` branch) must be declared `{ unused: true }` and have zero importers.
3. Every `{ spec, title }` exists; a `failure` test body contains `failNextServerAction(` or `failNextSupabaseCall(`; a `minimal` body contains `expectNoLeakedNulls(`.
4. Every `'use client'` file with `<form` or `onSubmit=` is some entry's call-site file.
5. Non-vacuity floor: at least 50 actions and 40 call sites discovered.
6. `todo` entries are allowed while `MUTATION_MANIFEST_ALLOW_TODO` is true in the manifest file. Phase 2 flips it to false.

Phase 0 fills the manifest with today's truth: existing happy/minimal titles, `todo` for everything else, tagged with the owning package.

### F7. Repair existing weak tests

| File:line | Problem | Fix |
|---|---|---|
| `e2e/shared/minimal-input.spec.ts:27` | Billing tab check silently skipped when the tab is missing | require the tab when `testInfo.project.name` starts with `admin-`, require its absence for staff |
| `e2e/shared/minimal-input.spec.ts:92` | `patient-age` count 0 asserted while the Profile tab is not the active one | assert on the Profile tab |
| `e2e/admin/minimal-input.spec.ts:70` | 1.5 s sleep then negative DB check | assert the validation message / focused field, then the DB |
| `e2e/admin/responsive-layout.spec.ts` (Invites matcher, ~:66) | expects every visible invite to contain `@carebook.test`; breaks once mobile-only invites are seeded | match the invitee name or the empty state |
| `e2e/admin/responsive-layout.spec.ts:19` | only 5 of 9 mobile Settings sheets opened | add Session Fees, Invite User, Active Users, Connected Apps, each with `expectNoLeakedNulls` |
| `e2e/external/coordination.spec.ts` | no error guards, no leak check | attach guards in every test; leak check after each render |
| `e2e/admin/payment-signals.spec.ts:28` | "Expected" label asserted, value never | handled in the Schedule package (S-25) |

### F8. Proof of the foundation

One smoke spec, `e2e/admin/fault-injection-smoke.spec.ts` (admin-mobile and `mobile-ios`): Settings → Session Fees sheet → Save with `abort`, `http-500`, `stale-deployment` and `lost-response`. Asserts message, button recovery, DB state, and the reload for the stale case. If this is green the helper is trusted by every package.

### F9. Mobile helpers — new `e2e/support/mobile.ts`, and the iOS project

- `backgroundApp(page, { minutes })`: installs the page clock, flips `document.visibilityState` to hidden, fast-forwards, flips back and dispatches `visibilitychange` (lift the inline helper from `e2e/shared/mobile-app-lifecycle.spec.ts`). A `persisted` variant dispatches `pageshow` with `persisted: true` for the back/forward-cache path.
- `serveAppVersion(page, version)`: fulfils `GET /api/version` so a resume sees a newer or equal build.
- `expectInViewport(locator)`: the element's box is fully inside the visual viewport and not covered by the bottom navigation (hit-test its centre with `elementFromPoint`).
- `expectNoHorizontalOverflow(page)`: `scrollWidth <= clientWidth` on the document; today this check exists only inline in `reminders.spec.ts` for admin-mobile.
- `tapTwice(locator)`: two taps inside one frame, for double-tap protection.
- `stubShare(page, { reject? })`: an init script replacing `navigator.share` / `navigator.canShare`, recording calls, optionally rejecting with `AbortError` (the user dismissed the sheet).
- A second mobile viewport constant, 320 × 568, for the small-phone layout checks in 5.7.
- Add the `mobile-ios` project (D5, decided) to `playwright.config.ts` with a `grep` on an `@ios` tag, update `e2e/support/playwright-config.test.ts`, install WebKit in one CI shard, and document it in `e2e/README.md`.
- `FAIL3` hold step uses `tapTwice` on mobile projects.

**Phase 0 exit:** full local e2e green, `test:e2e:support` green, manifest test green with `todo` entries, CI green.

## 5. Phase 1 — seven parallel work packages

Each case lists: id · spec file · projects · steps → assertions. Projects: A = admin, S = staff, X = external, P = platform, Pub = public; D = desktop, M = mobile. "all 4" = A+S × D+M. Failure cases use the F1 helpers and follow the D2 rule.

Standard failure triple, referred to below as **FAIL3(control)**: (1) `abort` → unreachable message visible, control back to idle and enabled, typed input preserved, DB unchanged, then un-route and retry succeeds with exactly one row; (2) `http-500` → same; (3) hold the request → pending label shown, control disabled, second click and Enter send no second request, release → exactly one row.

### 5.1 Patients (branch `test/e2e-patients`)

Owns: `e2e/shared/patients.spec.ts`, new `e2e/shared/patient-failures.spec.ts`, new `e2e/admin/patient-failures.spec.ts`, `e2e/admin/patient-delete.spec.ts`, `e2e/pages/patient-form.ts`, new `e2e/pages/treatment-plan-form.ts`, the patient cases inside `e2e/shared/minimal-input.spec.ts` (coordinate file edits with Schedule: Patients edits lines for patient / plan cases only, and lands first).

Page-object work: `PatientForm` gains `'Referred by doctor'`, `doctorName`, `newDoctor`, `confirmDuplicate()`, `clear(field)`, `expectSubmitReady(label)`. New `TreatmentPlanForm` drives inputs by `name=` (labels have no `htmlFor`).

| Id | Spec · projects | Steps → assertions |
|---|---|---|
| PA-1 | minimal-input · all 4 | Create a fully-filled patient in the UI; edit and clear phone, email, age, address, medical history, notes; Update → columns NULL; list, every detail tab, edit prefill pass the leak check; "No phone number" shown; no `tel:` / `mailto:` link |
| PA-2 | minimal-input · all 4 | Re-save the name-only patient unchanged → still all NULL, no age keys written |
| PA-3 | minimal-input · all 4 | Patient with legacy `dob`; clear Age; Update → DB has `dob`, `age_years`, `age_recorded_on` all NULL; no age on the list, detail, edit prefill, appointment detail or the External Staff view. Second patient with a `dob`: edit only the phone → `dob` unchanged; correct the age → `dob` unchanged (decision D4a; `test.fail()` until C-1 lands) |
| PA-4 | minimal-input · all 4 | Factory rows: source `patient` with NULL referrer, source `doctor` with NULL doctor, doctor with NULL specialty/address; open detail and edit; change Notes; Update → detail renders; save is not blocked (exposes bug G-13) |
| PA-5 | patients.spec · all 4 | Create with "Referred by doctor" + new doctor (name only); a second patient reuses the name in different case → one `doctors` row; detail shows the doctor with no dangling separator |
| PA-6 | patients.spec · all 4 | Duplicate phone → "Add anyway" → lands on `/patients`; exactly one new row; submit button shows a pending state while saving (exposes G-17a) |
| PA-7 | patients.spec · all 4 | Empty name; whitespace-only name; email `abc` → stays on `/patients/new`; nothing saved (whitespace case exposes G-11) |
| PA-8 | patients.spec · all 4 | Age `120` accepted; `-1`, `1e2` rejected with the alert; nothing saved for rejects |
| PA-9 | patients.spec · all 4 | Plan with goals + expected end, and plan with diagnosis only → both render; "Target:" only on the first |
| PA-10 | patients.spec (extend :169) · all 4 | With 52 fillers click "Load more" → count text changes, target row visible, button gone when exhausted |
| PA-11 | patient-failures · A-M, S-M | Create: `failNextSupabaseCall` `http-400`, `abort` and hold on `POST rest/v1/patients` → FAIL3("Add Patient"); message is plain language, not `TypeError: Failed to fetch` (exposes G-12) |
| PA-12 | patient-failures · A-M, S-M | Edit: same on `PATCH rest/v1/patients` → FAIL3("Update Patient") |
| PA-13 | patient-failures · A-M | Open edit; hard-delete the patient via the factory; Update → an error is shown, not "Patient updated" (exposes G-3) |
| PA-14 | patient-failures · A-M, S-M | Add Plan: `abort`, `http-400`, hold on `POST rest/v1/treatment_plans` → "Plan not saved"; "Create Plan" enabled; dialog open; retry succeeds; one row (exposes G-7 if the client throws) |
| PA-15 | patient-failures · A-M, S-M | Load more and search: abort `GET rest/v1/patients` → toast and button re-enabled; search shows its failure text and the spinner stops |
| PA-16 | admin/patient-failures · A D+M | Delete patient: FAIL3 on the confirm button (separate desktop and mobile header buttons) → "Delete failed"; Delete and Cancel enabled; patient still exists; retry deletes |
| PA-17 | admin/patient-delete (extend :41) · A D+M | After the billing-history refusal → confirm button enabled again; Cancel closes; input cleared on reopen |
| PA-18 | admin/patient-failures · A-M | External access "Save access": FAIL3; then select a profile deactivated via the factory → `role=alert`; checkbox selection preserved; grants unchanged |
| PA-19 | shared/responsive-layout (one added test, coordinate with Schedule) · all 4 | Patient with phone: mobile shows the `Call <name>` link, desktop does not; phone-NULL patient: "No phone number", no Call link either side. Admin: exactly one visible Delete and one visible Edit per viewport |

### 5.2 Schedule, reminders, dashboard (branch `test/e2e-schedule`)

Owns: `e2e/shared/schedule-write-flows.spec.ts`, `e2e/shared/reminders.spec.ts`, `e2e/shared/appointment-recovery.spec.ts`, `e2e/shared/patient-appointments.spec.ts`, `e2e/shared/responsive-layout.spec.ts`, `e2e/admin/payment-signals.spec.ts`, `e2e/staff/payment-signals.spec.ts`, new `e2e/shared/schedule-edit-flows.spec.ts`, `e2e/shared/schedule-validation.spec.ts`, `e2e/shared/server-action-failures.spec.ts`, `e2e/shared/dashboard-booking.spec.ts`, `e2e/admin/schedule-fee-adjust.spec.ts`, `e2e/admin/schedule-external-assignment.spec.ts`, `e2e/pages/appointment-form.ts`, `e2e/pages/session-note-form.ts`, new `e2e/pages/appointment-detail.ts`, and the appointment / note / reminder cases in `e2e/shared/minimal-input.spec.ts`.

Page-object work: `AppointmentForm` gains `fee`, inline-patient optional fields, referral, edit mode, `clear(field)`, `submitUpdate()`, and a path that leaves the Type untouched. New `AppointmentDetail`: `setStatus`, `delete`, `adjustFee`, `openEdit`, `openNotes`. (The Status select in the edit form has no label association; add an `id` in source if needed and say so in the PR.)

| Id | Spec · projects | Steps → assertions |
|---|---|---|
| S-1 | schedule-edit-flows · all 4 | Edit every field of a scheduled appointment; Update → "Appointment updated"; DB row matches; detail and day view re-render |
| S-2 | minimal-input · all 4 | Appointment with notes; Edit, clear Notes and Duration; Update → `notes` NULL, duration 45; visit day view, week view, detail, dashboard, patient Appts |
| S-3 | schedule-validation (Schedule-owned) · A D+M | Edit a scheduled appointment, clear Session Fee, Update → a validation message, the dialog stays open, the stored fee is unchanged; fee `0` saves. The seeded `appointmentSparse` (legacy NULL fee) still renders on day view, detail, dashboard and the payment-due screens and can be completed (decision D4c; `test.fail()` until C-3 lands) |
| S-4 | minimal-input · all 4 | Book a restricted type left "Unassigned" → `assigned_to` NULL; day view, week view, detail render |
| S-5 | minimal-input · all 4 | Extend the required-only booking case to Week view; extend the inline-patient case to the appointment's own screens (day view, detail, dashboard) |
| S-6 | schedule-write-flows · all 4 | Inline patient with every optional field and a new referring doctor → patient and doctor rows; profile renders |
| S-7 | schedule-write-flows · all 4 | Recurring: 3 sessions → "3 appointments booked", 3 rows; a past start date shows the backdated hint and mixed statuses |
| S-8 | schedule-validation · all 4 | No patient; inline patient without phone; sessions 0 and 101; no weekday; admin fee blank → the specific message; no row; "Book Appointment" enabled |
| S-9 | schedule-validation · A-M | Duration `-5` on create and on edit; `0` on edit → form re-enabled; pin behaviour (G-17c) |
| S-10 | schedule-edit-flows · A-M, S-M | Hard-delete the row while Edit is open, Update; same for the status select → must not report success (exposes G-3) |
| S-11 | schedule-edit-flows · A-M, S-M | `failNextSupabaseCall` on `PATCH rest/v1/appointments` → FAIL3("Update Appointment"); values preserved |
| S-12 | server-action-failures · A-M, S-M | Status select: `abort` → destructive toast; select back on the old value; second attempt works |
| S-13 | server-action-failures · A-M, S-M | Delete appointment: FAIL3 → dialog buttons re-enabled; row still exists; then succeeds |
| S-14 | server-action-failures · A-M, S-M | Save Notes: FAIL3, typed text preserved. Variant `lost-response` then Save again → exactly one `session_notes` row and the notes still render (exposes G-4) |
| S-15 | server-action-failures · A-M, S-M | Reminder create, edit, Mark complete, Delete: `abort` → `role=alert`; buttons leave "Saving…"; one row after retry |
| S-16 | server-action-failures · all 4 (separate desktop / mobile triggers) | Dashboard reminder open and dashboard New appointment with actions aborted → the "Unable to load…" state with Retry; retry opens the dialog |
| S-17 | server-action-failures · A-M | One action in `stale-deployment` mode → "Care-Book was just updated" then reload |
| S-18 | schedule-fee-adjust · A D+M, plus a staff assertion in staff/payment-signals | Completed appointment: Save disabled for blank reason, same fee, fee ≤ 0; valid adjust → toast, new fee on detail, billed metric and payment-due reflect it, DB adjustment row; FAIL3; scheduled appointment has no Adjust fee; staff never sees it |
| S-19 | schedule-write-flows · all 4 | Status → cancelled; completed → scheduled; Delete absent for completed and cancelled; stale-tab delete after another session completes it → "Only scheduled appointments can be deleted." |
| S-20 | dashboard-booking · all 4 | Book through the dashboard dialog → row in today's list; then book with an inline patient, reopen, the new patient is selectable (exposes G-17b) |
| S-21 | patient-appointments · all 4 | Patient Appts → "Book Appointment" → patient preselected; booking returns to `/patients/[id]` |
| S-22 | reminders · all 4 | Create with time, phone, notes → dialog shows them; edit and clear all three and switch to "Name only" with a blank name → all NULL; day list, week view, dialog, dashboard render placeholders |
| S-23 | reminders · all 4 | Blank title; "Existing patient" with none chosen → alert, no row; a reminder whose patient was deleted renders |
| S-24 | responsive-layout · all 4 | Click Week on desktop → grid shows the appointment and reminders; mobile type-filter chip filters and shows the empty text |
| S-25 | admin/payment-signals · A-D (the panel is desktop-only; also assert it is absent on A-M) | "Expected" equals the day's fee sum, non-zero (exposes G-1) |
| S-26 | schedule-write-flows · all 4 | Cancel, then rebook the same patient / date / time → the booking succeeds; the cancelled row stays cancelled; both show correctly on the day view (decision D4b; `test.fail()` until C-2 lands) |
| S-27 | minimal-input · all 4 | Edit a full SOAP note and clear every field → no empty "Session Notes" card; an Objective-only note renders with no leading separator |
| S-28 | appointment-recovery · A-M | Booking POST with cleared cookies → "Sign in again…" toast; form re-enabled |
| S-29 | schedule-external-assignment · A D+M | Share a patient with External Staff; book with that assignee → `external_profile_id` set; chip and detail show a non-blank label, also for a nameless / email-less external profile (exposes G-2); revoke before submit → "External Staff access required" and the picker resets |
| S-30 | minimal-input · A D+M | Pending mobile-only **Staff** invitee: open `/schedule/new` with a restricted type and the dashboard dialog → the option shows the name or is absent, never tag-only (exposes G-2) |

### 5.3 Billing (branch `test/e2e-billing`)

Owns: `e2e/admin/billing-*.spec.ts`, `e2e/admin/minimal-input.spec.ts`, new `e2e/admin/billing-failures.spec.ts`, `e2e/admin/billing-validation.spec.ts`, `e2e/admin/billing-load-more.spec.ts`, `e2e/admin/tenant-isolation.spec.ts`, `e2e/staff/access-routing.spec.ts`, `e2e/pages/billing-entry-form.ts`.

Page-object work: `fillPackageManual` (no template), a `fillPayment` path that leaves the default method untouched, `submitExpectingError`, `refundPayment`, `reverseRefund`, void / cancel variants that return the dialog. New local helper `visitEveryBillingScreen(page, { patientId, packageId? })`: Overview, Payments Balance, Payments, Packages tabs, the three metrics expanded, payment-due page, package detail, patient Billing tab, dashboard — leak check on each. All cases A D+M unless noted.

| Id | Spec | Steps → assertions |
|---|---|---|
| B-1 | minimal-input (extend :9) | Payment with blank notes → `visitEveryBillingScreen`; Payments row has no trailing separator; patient shows as a Credit row; Generate PDF → inline "No payment pending…" and the button returns to "Generate PDF" |
| B-2 | minimal-input | Package entered manually, no template, no notes → DB `notes` NULL; `visitEveryBillingScreen` including the empty package detail and a package-only PDF download |
| B-3 | minimal-input | `packageSparse` (legacy), a package with no balance row, a cancelled package → Packages tab, detail, patient tab, payment-due: no leaks |
| B-4 | billing-drilldowns | Package with one availed session whose appointment is then deleted → "Deleted appointment ·" with no "null"; completed appointment with NULL fee → billed metric shows ₹0 |
| B-5 | billing-packages | Refund ₹400 of ₹1,000 → "Partially refunded", Cancel gone, Refund present, history row, DB row; received metric shows the negative row; reverse it → "Reversed", Cancel returns. Uses the separate desktop and mobile buttons |
| B-6 | billing-validation | No patient → Save disabled; amount blank / `0` / `-5`; package sessions `0`, rate `0`, blank name; cleared payment date; refund 0, above max, blank reason; refund date cleared → "Choose a refund date."; in every case the dialog stays open and nothing is saved |
| B-7 | billing-failures | Select patient, hard-delete it, submit → "Billing entry not saved"; dialog open with amount and notes kept; "Save Payment" enabled; no row |
| B-8 | billing-failures | Two pages: open Cancel-payment in A, void it in B, confirm in A → "Audited change not saved" + reason kept + button enabled; repeat for cancel package and for a refund above the remaining amount |
| B-9 | billing-failures | FAIL3 for Save Payment, Save Package, void payment, record refund, reverse refund, cancel package; `http-500` once for Save Payment |
| B-10 | billing-failures | `lost-response` on Save Payment → the "refresh and check" copy; exactly one payment; after reload it is on the Payments tab. Then a `dblclick()` on Save Payment with no fault → exactly one row (exposes G-14) |
| B-11 | billing-failures | Abort the outstanding-charges preview → inline error text; spinner gone; Save still works |
| B-12 | billing-load-more | 60 payments on distinct dates → View more → Load more grows the list with no duplicate rows; Show less. Abort `GET rest/v1/payments` → toast, button back from "Loading…", retry works. Abort `GET rest/v1/refunds` → a toast is shown (exposes G-6). Same for 60 packages. After a void, rows already loaded stay loaded (G-17d) |
| B-13 | billing-load-more | 26 patients with a due balance → pagination control; Next shows the 26th |
| B-14 | billing-packages | `/billing?new=1&tab=payments` opens the dialog; closing cleans the URL; mobile dashboard "New billing" link opens it |
| B-15 | billing-packages | PDF "Previous month only" → filename carries the month; abort the PDF POST → alert + button back to "Generate PDF" + retry works; fulfilled 500 → the server message |
| B-16 | staff/access-routing · S D+M | Add `/billing/packages/<id>` and `/billing?new=1` to the denied list; staff `POST` to the PDF API → 403 JSON, not a PDF |
| B-17 | admin/tenant-isolation | `/billing/packages/<Clinic B>` and `/billing/payment-due/<Clinic B patient>` → not found; PDF POST → 404; Clinic B patient absent from the entry-form picker |
| B-18 | billing-metrics | `?page=999` redirects to the last page; unknown metric slug → not found. Remove the day-of-month skip at `:313` by freezing the clinic date or seeding relative to it |
| B-19 | billing-drilldowns | Patient with 21 payments → "Show all 21 payments" toggles; a voided payment shows "· voided" on the patient tab and "Cancelled" on the Payments tab |

### 5.4 Settings and auth (branch `test/e2e-settings-auth`)

Owns: `e2e/admin/settings.spec.ts`, `e2e/admin/responsive-layout.spec.ts`, `e2e/staff/settings-access.spec.ts`, `e2e/public/auth-flows.spec.ts`, new `e2e/admin/settings-failures.spec.ts`, `e2e/admin/settings-minimal-input.spec.ts`, `e2e/public/auth-failures.spec.ts`, `e2e/pages/settings-view.ts`.

Page-object work: add 'Your Account', 'Active Users', 'Connected Apps' to `SettingsSection`; `createLoginForTemporaryStaff`; an invite variant that does not wait for the password dialog; `visitEverySection(assert)`; replace the non-retrying `isVisible().catch()` at `settings-view.ts:21`.

| Id | Spec · projects | Steps → assertions |
|---|---|---|
| SA-1 | settings-minimal-input · A D+M | The mobile-only Staff invitee from S-30 completes first login; admin opens every Settings section (each mobile sheet, including Active Users and Invites), a booked chip + detail, the patient access picker → leak check on each; Users row shows the formatted mobile |
| SA-2 | settings-minimal-input · A D+M | Email-less accepted user, once Staff and once External: `/settings` → Your Account, `/external/account` → Email reads "Not added yet"; change password works through the mobile identifier; Logout works |
| SA-3 | settings-minimal-input · A D+M | `externalStaffSparse`: book a restricted appointment assigned to them → schedule chip, detail, dashboard leak-free |
| SA-4 | settings-minimal-input · A D+M | With the F3 sparse invites and profiles present, open every Settings section → leak check (this is the incident-1 page with deterministic NULL rows) |
| SA-5 | settings.spec · A D+M | Temporary Staff → Create login: blank email → "Email required", no invite; valid email → password dialog, invite linked, row "invite pending"; after first login "onboarded"; phone `+91 98765 43210` → button re-enabled and a usable message (exposes G-8) |
| SA-6 | settings.spec · A D+M | Invite role Admin by mobile only; first login → lands on `/` with Billing nav |
| SA-7 | settings.spec · A D+M | "Copy login details" with clipboard permission → status text; clipboard holds mobile and password. On mobile the credentials open as a bottom sheet: with `stubShare`, tap Share → called with the login text; with the share dismissed (`AbortError`) → no error toast, sheet still usable. This is how an admin actually hands a login to staff |
| SA-8 | settings-failures · A D+M | Returned failures: duplicate pending invite; mobile of an active user; bad email; bad mobile; duplicate appointment-type name; delete a type in use; New password on an invite revoked from another context → exact message; button back to idle and enabled; no row; corrected retry succeeds |
| SA-9 | settings-failures · A D+M (cards vs sheets differ) | `abort` on each of: Create Login, Save Settings, type Save / Delete, template Save / Delete, Add Temporary Staff, New password, Revoke, Change Password → message; button enabled; retry succeeds |
| SA-10 | settings-failures · A-M | `stale-deployment` on Create Login → the "just updated" message, then reload |
| SA-11 | settings-failures · A-M | Hold the response; double-click Create Login, Save, Revoke → pending label, disabled, one request, one row; Revoke and New password disable each other |
| SA-12 | auth-flows · Pub D+M | Complete invite: mismatch. Forced change: weak, mismatch. Update password: mismatch. Settings change: wrong current, weak, mismatch → error under the right input; old password still signs in; button enabled |
| SA-13 | auth-failures · Pub D+M | Abort GoTrue `auth/v1/token` on Sign In, `auth/v1/recover` on Send Reset Link, `auth/v1/user` on Update Password; abort the action POST on Finish Sign-Up, Save New Password, Submit Request → plain-language message; button re-enabled; retry succeeds (exposes G-7) |
| SA-14 | auth-flows · Pub D+M | Onboarding with clinic phone and address blank → row has both NULL; duplicate pending (same email) and the 4th request in the window → the two messages; button re-enabled |
| SA-15 | auth-flows · Pub-M | Invite link for a revoked and for an accepted invite; a used recovery link → `/login?error=…` with the visible message |
| SA-16 | staff/settings-access · S D+M | Capture an admin action id in an admin context and replay the POST with staff cookies → `{ success: false }` unauthorised, no DB change |
| SA-17 | staff/settings-access · S-M | Signed-in staff opens `/auth/update-password` → redirected to `/settings`; password unchanged. A real reset-link session still reaches the page and can set a password (decision D4d; `test.fail()` until C-4 lands) |
| SA-18 | settings.spec · A, S, D+M | Logout from `/settings` as admin and as staff → a protected route then redirects to `/login` |

### 5.5 External Staff workspace (branch `test/e2e-external`)

Owns: `e2e/external/**` (except `routes.spec.ts` from Phase 0, which it may extend), new `e2e/pages/external-dialogs.ts`. All cases X D+M.

| Id | Spec | Steps → assertions |
|---|---|---|
| X-1 | new external/minimal-input | `patientExternalSparse`: `/external/patients`, search, open the profile dialog, open the booking dialog; day and week view after booking → five placeholders, no `tel:` / `mailto:` link, leak check |
| X-2 | external/minimal-input | Book in the UI; then in admin and staff contexts visit `/schedule?date=` (day and week), `/schedule/[id]`, `/`, patient Appts and Billing tabs, `/billing` → admin: leak check and the External Staff label; staff: row absent on schedule, dashboard and patient tab |
| X-3 | external/minimal-input | Admin clears phone, email and age of a shared patient; external reloads the list and dialog → leak check |
| X-4 | new external/account | Email-less external user: wrong current password → field error, button enabled; valid change; Logout; sign in again; after Logout `/external` redirects to `/login` |
| X-5 | new external/failures | Book the same slot twice → the duplicate message; "Book appointment" enabled; one row |
| X-6 | external/failures | Dialog open, admin revokes the grant, submit → dialog closes, access banner, New appointment disabled, empty state after refresh |
| X-7 | external/failures | Reschedule dialog open, row set `completed` via the factory, Save and Cancel → "This appointment can no longer be changed."; buttons re-enabled; row unchanged |
| X-8 | external/failures | Open `externalApptYesterday` and `externalApptCompleted` → read-only copy, no Save / Cancel; blank time → "Choose a valid date and time.", no request sent |
| X-9 | external/failures | `abort` on Book, then retry → the custom "Unable to confirm this booking…" copy; exactly one appointment after retry (idempotency id reused). `abort` and `http-500` on Save changes and confirm-Cancel → the custom change copy; buttons enabled |
| X-10 | external/failures | Hold the action → "Booking…" / "Saving…" / "Cancelling…"; fieldset disabled; Escape does not close; no second request |
| X-11 | external/coordination | From the patient dialog click "Book appointment" → `/external?date=`; toast; chip visible. Reschedule changing type and time; "Keep appointment" back-out |
| X-12 | new external/access-routing | `page.request.post` to the bookings API, the PDF API and `/patients`; GET `/platform`, `/platform/users` → 403 JSON for POSTs, redirect to `/external` for GETs |
| X-13 | external/access-routing | Disposable external user, then `status = 'blocked'`; reload → "Account unavailable"; Log out works |
| X-14 | external/minimal-input | `external-empty` account on `/external/account`; clinic with zero appointment types → the "Ask your clinic admin…" text |

### 5.6 Platform console and HTTP contracts (branch `test/e2e-platform-http`)

Owns: `e2e/platform/**`, `e2e/public/http-contracts.spec.ts`, `e2e/shared/access-routing.spec.ts`. Platform cases P-D.

| Id | Spec | Steps → assertions |
|---|---|---|
| PL-1 | platform/routes + management | `expectNoLeakedNulls` on all four pages with the F3 sparse rows (email-less, nameless and clinic-less users; sparse onboarding request) |
| PL-2 | management | Reject with a blank reason → `rejection_reason` NULL; card shows "Rejected." |
| PL-3 | management | After approve, visit Clinics and Clinic Requests → clinic card with no phone; approved card; leak check |
| PL-4 | management | Send reset on an email-less user → a correct message, button re-enabled (exposes G-9); Issue temp password for a mobile-only user → dialog shows the mobile |
| PL-5 | management | Issue temp password for an accepted user: dismiss the confirm → nothing changes; accept → `must_change_password` true |
| PL-6 | management | Approve a request whose owner email already exists → "Approval failed"; Approve re-enabled; **no new clinic row** (exposes G-5) |
| PL-7 | management | `abort` on Approve, Reject, Block clinic, Block user, Send reset, Issue temp password → unreachable toast; spinner gone; button enabled; DB unchanged |
| PL-8 | management | Hold Approve on request A, click Reject on B → A's buttons stay disabled (exposes G-5) |
| PL-9 | shared/access-routing · all 4 | Clinic users GET `/external`, `/external/patients`, `/external/account` and the three `/platform/*` sub-routes → redirect to `/` |
| PL-10 | http-contracts · Pub-M | `/auth/callback?token_hash=x` with no type; `?type=recovery&token_hash=bad`; `?next=//evil` → redirect to the right `/login?error=…`; no open redirect |
| PL-11 | http-contracts · Pub-M | `/api/version` shape and `no-store`; each MCP / OAuth route returns 404 while MCP is off; unauthenticated POST to the bookings and PDF APIs → 401 |

### 5.7 Mobile app lifecycle, touch and layout (branch `test/e2e-mobile`)

Owns: `e2e/shared/mobile-app-lifecycle.spec.ts`, new `e2e/shared/mobile-resume-forms.spec.ts`, `e2e/shared/mobile-offline.spec.ts`, `e2e/shared/mobile-layout.spec.ts`, `e2e/external/mobile-lifecycle.spec.ts` (hand the file to the External package's directory owner as a new file; no overlap). Cases run on A-M and S-M (and X-M where marked); desktop projects skip these files with a project-name check at the top of the file, stated in a comment. Cases M-1, M-2, M-6 and M-9 carry the `@ios` tag.

The "primary flows" referred to below are the ones a clinician does on a phone many times a day: book an appointment (schedule dialog and dashboard "New appt"), change status to completed, save session notes, add a reminder, add a patient, and for admins record a payment.

| Id | Spec | Steps → assertions |
|---|---|---|
| M-1 | mobile-app-lifecycle | Resume into a newer build: `serveAppVersion` returns a newer version; `backgroundApp` 2 min → exactly one reload; still signed in; same URL; no reload loop on the next resume when versions match. With `/api/version` failing (500, abort) → no reload, the screen still refreshes, no console error |
| M-2 | mobile-app-lifecycle | Tap on a stale build **before** any resume check: for each primary flow that uses a server action (status, session notes, reminder, admin Create Login), `stale-deployment` fault → the "just updated" message, one reload, and after the reload the same action succeeds. This is the exact 2026-11-24 sequence, on the device class where it happened |
| M-3 | mobile-resume-forms | Resume with unsaved input, same build: for each primary flow, open the dialog or sheet, type every field, `backgroundApp` 2 min → dialog still open, every typed value intact, submitting once creates exactly one row. Resume into a newer build with a form open → one reload, signed in, same route, no half-saved record (input loss is accepted, decision D6) |
| M-4 | mobile-resume-forms | Resume while a save is in flight: hold the request, background and resume, release → the button leaves its pending state, one row, no duplicate request from the resume refresh |
| M-5 | mobile-resume-forms · A-M | Resume on screens that keep client-loaded data: billing Payments tab after "Load more", an open payment-due PDF dialog mid-generation, patient list after "Load more", a schedule date tapped inside the loaded window → loaded rows stay, the PDF button does not stick on "Generating…", the chosen date is kept (exposes G-6 and G-17e, which a resume refresh triggers on every return to the app) |
| M-6 | mobile-app-lifecycle | Cold start after a kill: a fresh page with only the stored cookies opens each deep link directly — `/schedule/[id]`, `/patients/[id]`, `/schedule?date=`, `/billing?new=1` (admin), `/external` (X-M) → renders without passing through `/login`; the session cookie is renewed for its full lifetime (extend the existing third test from `/` to these routes) |
| M-7 | mobile-offline | No signal at the tap: `context.setOffline(true)`, then tap the submit of each primary flow → a plain-language message in the viewport; button back to idle; typed input kept; back online, one more tap → exactly one row. Resume while offline → no crash, no sign-out, screen refreshes once back online |
| M-8 | mobile-offline | Signal drops mid-request: `lost-response` on book appointment (API) and record payment (action) → the "check before retrying" copy; after reload the record is there once |
| M-9 | mobile-layout | Double tap: `tapTwice` on the submit of each primary flow, no fault → exactly one row (exposes G-14 for payments) |
| M-10 | mobile-layout | Reachability at 393 × 851 and 320 × 568: for every dialog and sheet with a submit control (appointment form incl. inline new patient expanded, session notes, reminder, patient form, treatment plan, billing entry in both modes, refund, invite, Temporary Staff, change password, external booking and reschedule), scroll to the end → the submit button passes `expectInViewport` and is not under the bottom navigation; trigger a validation error → the message passes `expectInViewport` |
| M-11 | mobile-layout | No sideways scroll: `expectNoHorizontalOverflow` on every manifest route for A-M, S-M and X-M, using the sparse rows and one factory patient with a 60-character unbroken name and a long diagnosis |
| M-12 | mobile-layout | Phone-friendly inputs: phone, age, fee, amount, sessions and OTP-style fields open the right keyboard — assert `type` / `inputmode` on each such input in the forms above; list any that open the full text keyboard as findings |
| M-13 | mobile-layout | Calling and sharing: patient with a phone → the mobile Call link is a valid `tel:`; patient without → no link. Payment-due PDF on A-M with `stubShare` → Share is offered and called with a PDF file; share dismissed → no error, button back to idle |
| M-14 | mobile-app-lifecycle | Back gesture: from an appointment opened from the schedule, back returns to the same date; from a patient opened from a search, back returns to the list with the search kept; with a dialog open, back does not leave a blank screen (pin whichever of "closes the dialog" or "leaves the page" happens today and report it) |
| M-15 | external/mobile-lifecycle · X-M | M-1, M-3, M-6 and M-7 for the External Staff booking dialog on `/external`; `/api/version` stays reachable for the external role |

## 6. File ownership (no two Phase 1 packages edit the same file)

| Package | Files |
|---|---|
| Phase 0 | `e2e/support/**`, `e2e/setup/**`, `playwright.config.ts`, `package.json` scripts, `e2e/external/routes.spec.ts`, the F7 repairs |
| Patients | `shared/patients.spec.ts`, `shared/patient-failures.spec.ts`, `admin/patient-failures.spec.ts`, `admin/patient-delete.spec.ts`, `pages/patient-form.ts`, `pages/treatment-plan-form.ts` |
| Schedule | `shared/schedule-*.spec.ts`, `shared/reminders.spec.ts`, `shared/appointment-recovery.spec.ts`, `shared/patient-appointments.spec.ts`, `shared/responsive-layout.spec.ts`, `shared/server-action-failures.spec.ts`, `shared/dashboard-booking.spec.ts`, `shared/minimal-input.spec.ts`, `admin/schedule-*.spec.ts`, `admin|staff/payment-signals.spec.ts`, `pages/appointment-form.ts`, `pages/session-note-form.ts`, `pages/appointment-detail.ts` |
| Billing | `admin/billing-*.spec.ts`, `admin/minimal-input.spec.ts`, `admin/tenant-isolation.spec.ts`, `staff/access-routing.spec.ts`, `pages/billing-entry-form.ts` |
| Settings/auth | `admin/settings*.spec.ts`, `admin/responsive-layout.spec.ts`, `staff/settings-access.spec.ts`, `public/auth-*.spec.ts`, `pages/settings-view.ts` |
| External | `external/**`, `pages/external-dialogs.ts` |
| Platform/HTTP | `platform/**`, `public/http-contracts.spec.ts`, `shared/access-routing.spec.ts` |
| Mobile | `shared/mobile-*.spec.ts`, `external/mobile-lifecycle.spec.ts` |

Cross-package cases: PA-1..4 and PA-19 are written by Patients but live in Schedule-owned files. The writing package sends the diff to the owning package, which applies it. Each package updates only its own entries in `mutation-manifest.ts` (Phase 0 pre-creates one block per package to keep merges clean).

## 7. Phase 2 — structural guards and cheaper layers (one agent, after Phase 1 merges)

| Id | Work | Why |
|---|---|---|
| L1 | Table-driven component test over every `callServerAction` call site: action mocked to reject, and to throw the unrecognised-action error → the control re-enables and the message renders. Template: `src/app/settings/invite-ui.component.test.tsx:96-150` | covers all 44 call sites in milliseconds; e2e then only needs the representative set above |
| L2 | Sparse-props render test: each `*-view.tsx`, `*-list.tsx`, `*-detail.tsx` rendered with every nullable field `null` → no throw, no `null` / `undefined` / `NaN` in `textContent` | catches incident 1 without Docker |
| L3 | Generate Supabase `Database` types and pass the generic to the three client factories | makes `tsc` reject `.trim()` on a nullable column — the root cause named in `e2e/README.md` |
| L4 | Extend the call-site guard to direct client mutations: every `await supabase…insert|update|delete|upsert|rpc` and `supabase.auth.*` in a `'use client'` file sits in `try` or a shared wrapper | today flags `treatment-plan-form.tsx`, `update-password-form.tsx`, `login/page.tsx` |
| L5 | Nullable-column drift test in the integration suite: snapshot the per-table nullable list; a migration that changes it fails until the sparse fixture and minimal case are updated | keeps F3 honest |
| L6 | `*.route.test.ts` for `oauth/register`, `oauth/token`, `oauth/revoke`, `api/mcp`, `api/version`: missing or malformed bodies → 400-class, never 500 | these routes are unreachable in e2e (D3) |
| L7 | Missing component tests: `treatment-plan-form`, `appointment-detail`, `session-note-form`, both `ChangePasswordForm`s, `UpdatePasswordForm`, `ClinicOnboardingForm`, `ExternalStaffList.handleSendInvite`, `BillingView.loadMorePayments` with an error from the secondary reads, external `booking-dialog` failure | none exist today |
| L9 | Component test for `ResumeRefresh`: newer version → one reload; same version → `router.refresh()`; version fetch fails → refresh only; hidden under 60 s → nothing; paused routes → nothing | only the pure helpers in `src/lib/app-version.test.ts` are tested today; the component that every phone resume runs is not |
| L8 | Flip `MUTATION_MANIFEST_ALLOW_TODO` to false; delete or declare the dead exports; update CLAUDE.md and `e2e/README.md` maintenance policy: every new mutation needs a manifest entry with happy, minimal and failure tests | makes the gap a build failure from now on |

## 8. Product bugs found by the audit

"Verified" = I re-read the source myself after the audit. "Read" = confirmed by the auditing agent reading the code, not executed. "Plausible" = depends on runtime behaviour not exercised. None was reproduced in a running app.

### Fix with the tests (small, clear)

| Id | Bug | Where | Evidence | Exposed by |
|---|---|---|---|---|
| G-1 | Schedule "Day total → Expected" is always ₹0: the admin query never selects `fee` | `src/app/schedule/page.tsx:43` vs `schedule-view.tsx:347` | Verified | S-25 |
| G-2 | Pending mobile-only Staff/Admin invitee shows as a blank assignee option; chip and detail show a bare tag for a nameless external assignee | `schedule/new/page.tsx:29`, `appointment-form.tsx:91`, `schedule-view.tsx:71`, `appointment-detail.tsx:75` | Verified (picker); Read (chip) | S-29, S-30 |
| G-7 | Awaited call with no `try/finally`: button stays pending if the client throws | `patients/[id]/treatment-plan-form.tsx:29-55` (Verified), `login/page.tsx:49-86`, `auth/update-password/update-password-form.tsx:43` | Plausible | PA-14, SA-13 |
| G-9 | Platform "Send reset" on an email-less user answers "User was not found."; ban failure is swallowed while the toast says "blocked" | `platform/users/actions.ts:114`, `clinics/actions.ts:33-44` | Read | PL-4 |
| G-11 | Whitespace-only patient name is accepted and stored; the delete confirm is then enabled with an empty input | `patients/patient-form.tsx:130`, `patient-detail.tsx:98` | Read | PA-7 |
| G-12 | Raw technical text reaches toasts: `TypeError: Failed to fetch` on patient save; raw Postgres messages from schedule actions and billing RPC transport errors | `patient-form.tsx:91`, `schedule/actions.ts:121,152,201,242`, `lib/billing/mutations.ts:142` | Read | PA-11 |

### Needs its own fix branch (larger, or data-integrity)

| Id | Bug | Where | Evidence |
|---|---|---|---|
| G-3 | Zero-row writes report success (record deleted meanwhile): patient update, appointment update, status change, note update, patient delete | `patient-form.tsx:84`, `appointment-form.tsx:658`, `schedule/actions.ts:144,234`, `patients/actions.ts:37` | Read |
| G-4 | Saving a session note twice after a lost reply inserts a second row (no unique on `appointment_id`); the page then reads with `.maybeSingle()` and shows no notes | `schedule/actions.ts:233`, `schedule/[id]/page.tsx:49` | Read; frequency plausible |
| G-5 | Approving a clinic request whose owner already has a login leaves an orphan clinic on every attempt; one shared `busyId` lets a second row's click re-enable an in-flight Approve | `platform/clinic-requests/actions.ts:52-114`, `clinic-requests-list.tsx:24` | Read |
| G-6 | Billing "Load more": errors from the applications / refunds reads are dropped, so loaded payments show as un-refunded with a live Cancel button; rows also vanish after any audited change; payments paged by `date` only can duplicate or skip | `billing/billing-view.tsx:255-270,187`, `billing/page.tsx:46` | Read |
| G-8 | Temporary Staff → Create login dead-ends when the stored phone is not a bare 10-digit number (no UI to edit it), and demands an email although Invite User does not | `settings/external-staff-list.tsx:67-85` | Read |
| G-10 | Un-ranged selects silently capped at 1000 rows: schedule 43-day window, billing page (five reads), patient pickers, dashboard, platform counts | `schedule/page.tsx:40`, `billing/page.tsx:49-62`, `patients/new/page.tsx:8`, `platform/users/page.tsx:16` | Read; needs volume |
| G-13 | Patient whose referrer was deleted (`referral_source = 'patient'`, NULL id) cannot be saved until the source is changed | `components/referral/referral-fields.tsx:92-96` | Read |
| G-14 | Double activation before React commits `loading` can record a payment or refund twice; no idempotency key on `record_payment_v2` / `record_refund` | `billing/billing-entry-form.tsx:113`, `billing-view.tsx:209` | Plausible |
| G-15 | Logout, Connected Apps revoke and OAuth consent use native `<form action>`, bypass `callServerAction` and its guard, and have no pending state; consent with `read` unticked throws to the error boundary | `settings/account-summary.tsx:68`, `oauth/authorize/actions.ts:27` | Read |
| G-16 | `/auth/update-password` lets any signed-in session set a new password with no current-password check and no policy | `auth/update-password/page.tsx:10` | Read; fixed by C-4 |

### Worse on the phone than the table above suggests

The app refreshes the current screen every time it returns from the background after a minute
(`resume-refresh.tsx`). On a phone that happens many times a day, so anything that misbehaves
when fresh server data arrives is hit far more often than on desktop:

- **G-6** (loaded-more billing rows vanish) and **G-17e** (PDF dialog stuck on "Generating…") are both triggered by that refresh, not only by an explicit action. Covered by M-5.
- **G-4, G-14** (duplicate note / payment after a lost reply or a double tap) are the natural result of a weak signal and a touch screen. Covered by M-8, M-9, S-14, B-10.
- A resume that finds a newer build reloads even when a form is half-filled, discarding the input. The owner accepted this (D6); it is not tracked as a bug.
- **G-15** (Logout and other native form actions outside the failure wrapper): on a stale build after a deploy these go to the error screen instead of the "just updated" reload.

### Behaviour changes decided on 2026-11-24 (each its own fix branch, with the test that pins it)

| Id | Change | Notes for the implementer | Pinned by |
|---|---|---|---|
| C-1 | Clearing Age on a patient with a legacy `dob` deletes the `dob` and removes the shown age | Owner-confirmed data deletion, limited to this one action: an edit where the Age field is emptied and saved writes `dob = null`, `age_years = null`, `age_recorded_on = null`. Every other edit still leaves `dob` untouched (an unchanged or corrected age must not null it). No migration and no bulk change: existing rows keep their `dob` until someone clears the age by hand. Logic in `src/lib/patients/age.ts` (`:82-85`) and the write in `patient-form.tsx`; update `age.test.ts`. Covers list, detail, edit, appointment detail, External Staff view and the MCP tools | PA-3 |
| C-2 | A cancelled appointment no longer blocks booking the same patient, date and time | Internal check in `src/lib/appointments/booking-supabase.ts:22-24`; mirror the external RPC, which already excludes cancelled rows. Check any unique index on the slot | S-26 |
| C-3 | Edit Appointment requires a fee for admins, as create does | `src/app/schedule/appointment-form.tsx` (create check at `:570`, edit write at `:667`). Legacy NULL-fee rows must stay editable without forcing a fee on unrelated edits by staff, who never see the field | S-3 |
| C-4 | `/auth/update-password` is only for reset-link sessions | `src/app/auth/update-password/page.tsx:10`. Needs a reliable signal that the session came from a recovery link (set in `auth/callback`). Run every auth e2e flow: a previous auth change here broke invites and was reverted. Must never sign anyone out | SA-17, SA-15 |

### Minor (G-17)

a. "Add anyway" on the duplicate dialog clears the pending state while the insert is in flight.
b. Dashboard New-appointment dialog caches its options, so a patient created inline is missing on reopen.
c. Edit duration `0` silently becomes 45; a negative value gives only a generic failure.
d. Refund dialog keeps the previous method and date.
e. PDF dialog can stick on "Generating…" if props change mid-request.
g. Blank session note renders an empty card.
h. `oauth/register` and `oauth/token` answer 500 on a malformed body.
i. Payment method shown as the raw enum value (`bank_transfer`).

## 9. Order of work and exit criteria

1. Decisions D1–D6 are settled (section 2).
2. Phase 0 merges (foundation green in CI).
3. Seven Phase 1 packages run in parallel. If agents are limited, start with Mobile (5.7), Schedule (5.2) and Settings/auth (5.4): they cover what phone users do most and both incident paths. each merges when its cases are green or marked `test.fail()` with a G-id, and its manifest entries carry real titles.
4. Fix branches for section 8 run alongside; each removes the matching `test.fail()`.
5. Phase 2 merges; `todo` is no longer allowed in the manifest.

Done means: every mutation surface has a happy, a minimal (or an explicit exemption) and a failure test named in the manifest; every failure and minimal case passes on a mobile project; the primary flows survive resume, a stale build, no signal and a double tap on mobile; route smoke renders a sparse row on every list and detail route for every role; no `test.fail()` remains without an open G-id.
