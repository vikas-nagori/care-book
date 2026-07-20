# Patient Form Async Submit Fix

## Problem

The standalone patient form reads `e.currentTarget` after awaiting referral resolution. React clears an event's `currentTarget` after event dispatch, so `new FormData(e.currentTarget)` throws in the browser. The exception occurs before the patient insert, remains outside the form's current error handling, and leaves the submit button stuck on `Saving…`.

The production incident on July 20, 2026 demonstrated the exact sequence: the account successfully authenticated, a referring doctor was inserted, no patient row was inserted, and the form remained loading.

## Goals

- Capture the submitted form synchronously, before any asynchronous boundary.
- Ensure expected Supabase errors and unexpected thrown exceptions both restore an interactive form and show a useful error.
- Add component-level regression coverage for the React submit lifecycle, not only pure helper coverage.
- Preserve existing duplicate-phone, referral, patient-update, and navigation behavior.
- Release through a verified preview deployment before merging and deploying `main`.

## Non-goals

- Changing patient or referral database schemas.
- Removing the orphan doctor created during the failed production attempt.
- Refactoring unrelated forms or introducing broader form infrastructure.

## Approaches Considered

### 1. Synchronous form snapshot plus component tests (selected)

Create `FormData` at the start of the submit handler, before referral resolution. Wrap the asynchronous submission flow so thrown exceptions reset the loading and re-entrancy state and surface an error. Add Vitest, jsdom, and React Testing Library coverage that renders the real `PatientForm` and verifies insert, navigation, Supabase-error, and thrown-error paths.

This directly covers the production failure while keeping the application change small.

### 2. Source-order assertion

A test could read `patient-form.tsx` and assert that `new FormData` appears before the first `await`. This avoids test dependencies but is coupled to formatting and does not test runtime behavior.

### 3. Pure orchestration helper tests

Submission logic could be extracted into a pure TypeScript helper. This improves unit-testability but would not prove that the React event is consumed before it becomes invalid unless paired with a component test. It is more refactoring than the incident requires.

## Design

### Submission flow

1. Prevent the browser's default form submission.
2. Construct `FormData` synchronously from the current form element.
3. Set the loading state.
4. Resolve referral data asynchronously.
5. Build the patient payload from the captured `FormData`.
6. Run the duplicate-phone lookup when applicable.
7. Insert or update the patient.
8. On success, navigate and refresh as today.
9. On any unexpected exception, log through the existing redacting logger, show a generic destructive toast, and restore loading/re-entrancy state.

Expected Supabase errors continue to display their returned message. The synchronous re-entrancy guard remains active only while a save is in flight and is reset on every failure path.

### Test architecture

Add a small Vitest/jsdom setup for client component tests while retaining the existing Node unit suite. The regression tests render `PatientForm` with mocked boundaries (`next/navigation` and the Supabase browser client) but exercise the real React submit event and form component.

Required cases:

- A basic new-patient submission crosses the asynchronous referral boundary, calls `patients.insert` with normalized values, and navigates to `/patients`.
- A selected referring doctor is included in the patient payload.
- A returned Supabase error restores the `Add Patient` button and does not navigate.
- A thrown client/database exception restores the button, does not navigate, and is logged.
- Existing focused unit tests and the full lint/build gates remain green.

The first test must be observed failing against the current code with the missing patient insert, proving it reproduces the incident before the fix is applied.

## Release and Verification

1. Run the focused component test in red, apply the minimal fix, and rerun it in green.
2. Run `npm run test:unit`, the component suite, `npm run lint`, and `npm run build`.
3. Commit and push `fix/patient-form-async-submit`.
4. Create and inspect a Vercel preview deployment; verify it reaches `READY` and scan runtime errors.
5. Fast-forward merge the verified branch to `main`, rerun the complete verification suite, and push `main`.
6. Verify the resulting production deployment is `READY`, resolves on `care-book.co`, and has no new runtime errors.

## Why Existing Checks Missed It

The repository's automated tests currently target `src/lib/**/*.test.ts`; no React patient-form component is submitted in a DOM environment. TypeScript, ESLint, and the Next.js build validate types and compilation but cannot detect a runtime event-lifetime violation. The exception is also client-side, while current production observability is centered on Vercel server/runtime logs, so it produced no server error record.
