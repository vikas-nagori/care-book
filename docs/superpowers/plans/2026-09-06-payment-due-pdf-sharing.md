# Payment-due PDF Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let billing admins generate a patient-facing PDF for completed-session payment due, choose all regular dues or the previous calendar month, and share the prepared PDF through the device share menu with download fallback.

**Architecture:** Keep financial calculation server-authoritative. Add a read-only Supabase RPC that returns one consistent patient billing snapshot, a pure TypeScript statement builder that applies the regular-session period and omits empty sections, a server PDF renderer, and a client dialog that generates once then reuses the same File for download or native sharing.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres, `date-fns`/`date-fns-tz`, `@react-pdf/renderer`, Radix dialog, Web Share API.

---

## File map

- Create `supabase/migrations/042_payment_due_statement_source.sql`: read-only, admin-scoped statement source RPC with explicit execute grants.
- Create `src/lib/billing/payment-due-statement.ts`: pure input/output types, period validation, charge/application arithmetic, regular/package classification, package counts, sorting, empty-section omission, and total calculation.
- Create `src/lib/billing/payment-due-statement.test.ts`: focused builder and period tests.
- Create `src/lib/billing/payment-due-statement.server.ts`: server-only RPC caller and source decoding/validation.
- Create `src/lib/billing/payment-due-pdf.tsx`: pure `@react-pdf/renderer` document.
- Create `src/lib/billing/payment-due-pdf-share.ts`: client capability and share-result helpers.
- Create `src/app/api/billing/payment-due/[patientId]/pdf/route.ts`: authenticated POST route that validates scope, reads the snapshot, builds the model, renders the PDF, and returns attachment/error responses.
- Create `src/app/billing/payment-due/[patientId]/generate-pdf-dialog.tsx`: period selector, generate state, ready state, download/share actions, and error handling.
- Create `src/lib/billing/payment-due-pdf-share.test.ts`: Web Share capability and error-classification tests.
- Modify `src/app/billing/payment-due/[patientId]/page.tsx`: pass clinic/patient identity and previous-month metadata to the presentational page.
- Modify `src/app/billing/payment-due/[patientId]/payment-due-detail.tsx`: mount the new generation control in the existing header without changing displayed balances.
- Modify `src/middleware.ts`: let the PDF API return JSON 401/403 responses for API callers instead of redirecting them to the login HTML page; preserve all existing browser-route redirects and forced-password rules.
- Modify `next.config.mjs`: permit same-origin `web-share` in Permissions-Policy while preserving camera/microphone/geolocation restrictions.
- Modify `package.json` and `package-lock.json`: add a pinned `@react-pdf/renderer` version compatible with React 18/Next.js 16.
- Add static TTF font assets under `public/fonts/` only if bundled-font verification shows the built-in font coverage is insufficient.
- Create `src/app/api/billing/payment-due/[patientId]/pdf/pdf.route.test.ts`: Vitest test file for the route handler, using mocks for auth/source/PDF rendering; because the current Vitest include only matches `src/**/*.component.test.tsx`, update `vitest.config.ts` to include this explicit `src/app/api/**/*.route.test.ts` glob and keep the existing component glob.
- Create `test/integration/payment-due-statement-source.test.ts`: local-Postgres RPC and authorization coverage run by `npm run test:integration`.
- Modify/add admin E2E coverage under `e2e/admin/` for both scopes, sharing fallback, and access denial.

## Task 1: Add the PDF dependency and establish the renderer boundary

- [ ] Confirm the latest compatible `@react-pdf/renderer` release with `npm view`, then install and commit the lockfile change.
- [ ] Add a minimal server-safe renderer smoke test or fixture using `renderToBuffer` and the repository's Node test setup.
- [ ] Run the focused smoke test and production typecheck; resolve Next.js external-package configuration only if the build requires it.
- [ ] Commit `build: add server PDF rendering dependency`.

## Task 2: Write the pure statement model tests first

**Test:** `src/lib/billing/payment-due-statement.test.ts`

- [ ] Add fixtures for ordinary completed charges, active applications, package allocations, package receipts, and scheduled/released/cancelled rows.
- [ ] Write failing tests for exact `due = charge − active applications`, partial payments, over-application rejection, and zero/fully paid exclusion.
- [ ] Write failing tests proving scheduled appointments, pending charges, voided charges, and package-allocated appointments never enter regular rows.
- [ ] Write failing tests for `all_due` and previous-calendar-month filtering, including January rollover and a dialog month crossing midnight.
- [ ] Write failing tests proving package content is identical for both regular scopes, `sessionsLeft = max(total − availed, 0)`, scheduled package allocations do not reduce it, and repeated dates remain repeated rows.
- [ ] Write failing tests for regular-only, package-only, both, and empty statement section omission and combined total.
- [ ] Run `node --test --experimental-strip-types src/lib/billing/payment-due-statement.test.ts`; confirm the new cases fail for missing implementation.

## Task 3: Implement the pure statement builder

- [ ] Define decimal-string/paise-safe source types and final statement types; reject malformed or negative money and inconsistent application totals.
- [ ] Implement previous-month validation using `getZonedCalendarContext()` and `formatDateOnly()` with the year included in labels.
- [ ] Implement ordinary charge aggregation and classification by current non-released package allocation.
- [ ] Implement package grouping, net posted receipt/refund values, availed date history, and sessions-left count independent of scheduled reservations.
- [ ] Implement deterministic date/time/ID ordering and exact section omission rules.
- [ ] Run the focused statement tests until all pass.
- [ ] Commit `feat: build payment due statement model`.

## Task 4: Add the read-only Supabase source function

- [ ] Add `test/integration/payment-due-statement-source.test.ts` before implementation cases: ordinary/package aggregation without duplicate sums, effective refunds, complete allocation/date history, more than one response page of source rows, and anonymous/staff/inactive/foreign-clinic denial using `queryAsAuthenticated`/`queryAs`.
- [ ] Run the new integration test to confirm it fails before the RPC exists (or skips only when no local Postgres is available).
- [ ] Create the migration with `supabase migration new payment_due_statement_source` and use its generated timestamp/prefix.
- [ ] Implement `get_payment_due_statement_source_v1(patient_id)` as a `STABLE`, `SECURITY INVOKER` function that derives the current clinic from the authenticated profile and returns patient/clinic identity, completed appointment charges, active applications, package receipt/refund totals, and current allocations in one JSON response plus snapshot timestamp.
- [ ] Filter to the current active clinic/admin inside SQL and make authorization fail closed; revoke public/anon execute and grant authenticated execute explicitly.
- [ ] Preserve nullable ledger history fields safely and include enough IDs for the TypeScript builder to detect double charging/count mismatches.
- [ ] Run the new integration test until it passes.
- [ ] Review grants, RLS interaction, and function search path; run the local migration/integration harness.
- [ ] Commit `feat: add scoped payment statement source`.

## Task 5: Implement the server source reader, PDF document, and route

- [ ] Add failing route tests in `src/app/api/billing/payment-due/[patientId]/pdf/pdf.route.test.ts` for malformed input, the middleware-facing unauthorized path, missing patients, no dues, content type/filename, no financial data in error responses, and no-store headers.
- [ ] Run the route test and confirm it fails before the handler is complete.
- [ ] Implement the server-only RPC caller with safe error logging and strict response decoding; never use the service-role client.
- [ ] Implement the A4 PDF component with clinic/patient header, conditional regular table, conditional complete package history, INR amounts, subtotals, total, generated timestamp, repeated headers/page numbers, and continuation-safe rows.
- [ ] Register a static font only if the renderer fixture needs it; verify INR and representative names before committing assets.
- [ ] Implement the POST route with Node runtime, UUID/body/period validation, fresh source read, pure model build, no-dues 422 response, PDF buffer response, safe error responses, `Content-Disposition`, and `private, no-store` caching.
- [ ] Run the route and renderer tests until they pass.
- [ ] Run focused route/renderer tests and `npm run typecheck`.
- [ ] Commit `feat: render payment due PDFs from scoped snapshots`.

## Task 6: Implement the client generation dialog and native sharing

- [ ] Add failing component/helper tests before the dialog implementation for missing APIs, false/throwing `canShare`, successful handoff, cancellation, failures, duplicate prevention, fallback download, stale response after close, stale response after period/patient change, and sign-out cleanup.
- [ ] Run the focused Vitest tests and confirm they fail before implementing the dialog/helper.
- [ ] Add the dialog with All due default, previous-month label/value, explanatory copy, Generate PDF action, and accessible loading/error states.
- [ ] Implement response validation, sanitized filename handling, Blob-to-File conversion, object URL download, and prepared-file state.
- [ ] Implement `canShare({ files: [file] })` detection using the actual PDF File and same-byte File reuse for both actions.
- [ ] Implement Share PDF directly from the click handler, pending state, `AbortError` return to ready, retryable non-abort error, and disabled unsupported-device fallback copy.
- [ ] Clear prepared state on period change, regeneration, close/unmount, patient change, and sign-out; never expose an old-period or old-patient file.
- [ ] Implement the dialog/helper, then run the focused tests until they pass.
- [ ] Wire the control into the balance-detail header and update `Permissions-Policy` for same-origin `web-share`.
- [ ] Commit `feat: add payment PDF generation and sharing controls`.

## Task 7: End-to-end verification and branch handoff

- [ ] Add admin desktop/mobile E2E coverage for all-due and previous-month modes, package-only/regular-only sections, empty result, and the generated attachment response.
- [ ] Add E2E assertions that staff cannot see the action or access the POST route and that a foreign-clinic patient ID does not disclose data.
- [ ] Add middleware/E2E coverage that an expired session hitting the PDF endpoint receives JSON 401/403 with no login redirect, while ordinary page navigation still redirects to `/login`.
- [ ] Mock or device-test native sharing where browser support exists; verify unsupported sharing leaves Download PDF usable and cancellation does not auto-download.
- [ ] Run `npm run test:unit`, `npm run test:component`, `npm run typecheck`, `npm run lint`, `npm run build`, and relevant integration/E2E suites.
- [ ] Inspect generated PDFs for text extraction, section omission, repeated headers, long histories, INR glyphs, totals, and no clipping.
- [ ] Review `git diff`, ensure only intended files are present, and commit any final fixes.
- [ ] Push `feat/payment-due-pdf-sharing` and report the remote branch and verification results.
