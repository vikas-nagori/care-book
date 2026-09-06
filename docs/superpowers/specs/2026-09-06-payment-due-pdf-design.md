# Payment-due PDF — design and implementation specification

Date: 6 September 2026

Status: Incorporates the user's confirmed requirements; ready for written review.

Independent spec review: Approved on 6 September 2026.

Scope: Design documentation only. Application implementation and deployment are separate work.

## 1. Purpose and final scope

Let a clinic admin generate a patient-facing PDF explaining payment still due for completed treatment. The doctor can save the file and attach it manually in WhatsApp or another app.

There is one entry action: **Generate PDF**. There is no copy-message option, WhatsApp integration, native sharing action, public statement link, or automatic sending.

Before generation, the admin chooses **All regular sessions due** or **Previous month only**. This selection affects regular sessions only. Package summaries always use their complete history and complete session counts, independently of the selected period.

Scheduled appointments never appear in the PDF and never contribute to its requested payment. Entire empty sections disappear, including their headings, table headers, subtotals, and explanatory text.

## 2. User flow and controls

Add a visible **Generate PDF** button to the existing patient balance-detail page, `/billing/payment-due/[patientId]`, for desktop and mobile. Preserve its existing admin-only access. Pass the patient ID from its server page to a small client-side generation control; the current presentational detail component does not become responsible for financial queries.

The button opens a compact dialog:

| Control | Content |
| --- | --- |
| Title | Generate payment PDF |
| Context | Patient's name |
| Field label | Regular sessions to include |
| Default radio option | All regular sessions due |
| Second radio option | Previous month only — August 2026 (actual month and year computed at runtime) |
| Help text | Only completed sessions with payment pending are included. Packages always show their complete session history and counts. |
| Actions | Cancel; Generate PDF |

Require one of the two supported options, with all due selected initially. Keep the selector even for a package-only patient, so opening the dialog does not require another financial fetch. Its help text explains that it has no effect on packages.

Use the existing dialog, button, toast, and mobile design conventions. On submission show **Generating PDF…**, disable duplicate submission, and preserve the chosen option if generation fails. On success return a real PDF attachment for download. The user can open the saved PDF in their usual viewer. Do not add a preview wizard, attachment picker, or sending workflow.

## 3. Regular-session eligibility and period semantics

A regular statement row must satisfy all of these conditions:

- The appointment currently exists and has status `completed`.
- Its authoritative appointment charge has status `posted`.
- It has no current non-released package session allocation. Package membership comes from that allocation, not payment funding scope or a guessed fee match.
- Its outstanding charge amount is strictly greater than zero after active payment applications are deducted.
- Its appointment date falls within the requested regular-session period.

**All regular sessions due:** Include every eligible regular session, regardless of age. There is no recent-ten or UI-pagination limit.

**Previous month only:** Include eligible regular sessions taken during the previous calendar month, not the previous 30 days. Use `CLINIC_TIME_ZONE` (`Asia/Kolkata`) and `getZonedCalendarContext()` from `src/lib/timezone.ts` to derive the month. Compare the stored appointment date as a date-only value against inclusive month boundaries; do not shift the treatment date into the viewer's timezone. Include the year in labels, especially across January/December.

The helper's `previousMonthLabel` currently omits the year. Construct the dialog/PDF month-and-year label from `previousMonthStart` using the existing date-only formatter.

For generation on 6 September 2026, previous month means 1–31 August 2026. A July unpaid regular session is excluded in this mode; an August session settled in September is also excluded because it no longer has money due. This is a current collection statement for selected treatment dates, not a historical month-end balance.

Bind the dialog's month label to an explicit `periodMonth` value (`YYYY-MM`) submitted with previous-month requests. At generation, the server validates that it is still the immediately previous clinic-calendar month. If the month changed while the dialog was open, refresh the label and ask the user to generate again instead of silently generating a different month. All-due requests have no `periodMonth`.

Regular rows show **Date | Session type | Fee | Paid | Due**, ordered by date, time, then ID. Use the charge amount for Fee and active applied money for Paid. Do not use the appointment fee alone as a balance calculation. Show the number of included unpaid/partially paid regular sessions and a subtotal.

## 4. Packages: complete counts and completed-session history

Retain the collection-only scope established during discussion: include a package when it has payment outstanding against at least one completed package session. A fully paid package, a package with only scheduled-session dues, and a package with no completed sessions do not create a collection section. Package status alone does not hide a legitimate remaining completed-session balance.

For every included package, display:

- Package name and total quoted package amount.
- Amount paid into this package, using net posted receipts after effective refunds.
- **Total sessions** and **Sessions left**.
- All currently availed completed-session dates for that package, including completed sessions already paid for. The regular-session month filter never applies to these dates.
- Charges for completed package sessions, payment applied to those completed sessions, and payment due for those completed sessions.

Do not label package session counts as paid or unpaid. Session usage and payment allocation are separate concepts.

**Sessions left = max(total sessions − availed completed sessions, 0).** Count non-released availed allocations once per appointment. A scheduled/reserved appointment does not reduce sessions left. Do not use the existing view's `remaining_sessions` directly: it subtracts scheduled sessions as well as availed sessions. Exclude released allocations and cancelled/deleted appointments from completed dates and counts.

Render completed dates as a compact chronological list, one entry per session. Preserve repeated dates if two sessions occurred on the same day; do not collapse them into a single session. Include the year. If multiple packages qualify, render separate summaries, ordered by creation date then ID, oldest first.

Package amount paid and money applied to completed treatment can differ because some receipt money is unallocated or applied to upcoming sessions. Show them with distinct labels. Never request the quoted package amount minus receipts as the completed-session due. Never charge a package session again in the regular section.

## 5. Calculation contract

The billing ledger remains authoritative. Generation is read-only and never triggers reconciliation, changes payment allocation, creates an invoice/payment, or updates appointment status.

For each eligible completed charge:

`applied = sum(payment_applications.amount where charge_id matches and status = active)`

`due = max(charge.amount − applied, 0)`

Aggregate applications per charge before joining to other one-to-many records to avoid multiplying charges or applications. Classify each appointment into exactly one ordinary/package group using current allocations.

The PDF's **Total payment due in this statement** is:

`sum(selected regular row dues) + sum(all included packages' completed-session dues)`

The regular period never reduces the package part. Package credit cannot pay regular dues, and regular credit cannot pay package dues. Do not subtract patient-level credit again after reading applied amounts.

Do not export `patient_billing_balances_v2.due_amount` or `package_billing_balances_v2.due_amount` as the statement total: both views can include pending scheduled charges. They remain valid for the existing app screens but represent a wider scope.

Use exact Postgres numeric arithmetic in the source query. Return money as decimal strings, then convert to integer paise with strict parsing for the pure statement builder; format INR at the output boundary. Avoid floating-point subtraction or rounding each payment before aggregation. Treat malformed, negative, or over-applied data as a generation error rather than silently clipping it into a plausible statement. Zero-fee sessions create no payment due but still count as completed usage when legitimately availed in an included package.

Migration 039 normally excludes zero-value charges from automatic package allocation. The last rule is defensive for existing valid allocations; generation must not create or restore an allocation to change that behavior.

## 6. Empty sections and empty statements

| Eligible content after filtering | PDF behavior |
| --- | --- |
| Regular sessions and packages | Render both sections and the combined total. |
| Regular sessions only | Omit the complete package section and any package subtotal or package scope note. |
| Packages only | Omit the complete regular section, its month label, count, subtotal, and regular scope note. Packages remain unchanged by the radio choice. |
| No eligible content | Do not download an empty PDF. Show: “No payment pending for the selected regular-session period or completed package sessions.” |

Absence is based on eligible content, not just whether any historical regular appointment/package exists. For example, choosing August when only July regular dues exist must remove the regular section, while retaining any eligible packages.

## 7. PDF output design

Use an A4 portrait document with a white background, restrained clinic accent color, dark text, and right-aligned currency columns. Maintain readable approximately 10–11 pt body text and clear table rules. Use text-based PDF content, not a screenshot of the app.

Content order:

1. Clinic name, **Payment summary**, patient name, and generation date/time in clinic time.
2. Regular-session section, only when non-empty. The subtitle reads either **All completed regular sessions with payment pending** or **August 2026 · completed regular sessions with payment pending**.
3. Package section, only when non-empty, with **Complete package history** as its scope label.
4. A prominent **Total payment due in this statement** and a short payment request.

Do not title the whole PDF “August statement” when packages from other months are present. If both sections exist, a short scope note explains that the selected regular period applies only to regular sessions.

Example generated on 6 September 2026 with **Previous month only** selected:

### Sample Clinic — Payment summary

Patient: Sample Patient

Generated: 06 Sep 2026, 10:00 IST

**Regular sessions · August 2026**

| Date | Session type | Fee | Paid | Due |
| --- | --- | ---: | ---: | ---: |
| 01 Aug 2026 | Clinic session | ₹800 | ₹300 | ₹500 |
| 03 Aug 2026 | Home visit | ₹1,200 | ₹0 | ₹1,200 |
| Subtotal — 2 sessions | | ₹2,000 | ₹300 | **₹1,700** |

**Physiotherapy package · Complete package history**

| Detail | Value |
| --- | ---: |
| Total package amount | ₹8,000 |
| Amount paid into package | ₹2,400 |
| Total sessions | 10 |
| Sessions left | 6 |

Completed session dates: 20 Jul 2026; 22 Jul 2026; 25 Aug 2026; 28 Aug 2026.

Charges for completed sessions: ₹3,200

Payment applied to completed sessions: ₹2,400

**Package payment due: ₹800**

**Total payment due in this statement: ₹2,500**

Regular sessions cover August 2026. Packages include their complete completed-session history.

Please arrange payment at your convenience. Thank you.

### Pagination and text handling

Repeat patient identification and page numbers on continuation pages. Repeat regular table column labels on pages continuing that table, prevent individual table rows from splitting, and keep subtotals with their final rows. Allow long package date histories to continue with a package-name continuation label; do not force an entire long package onto one page. Keep sufficient footer clearance.

Bundle licensed static font files supporting INR and the patient/clinic names in the deployment. Check glyph coverage and shaping with representative English and Indian-script names; never silently replace unsupported names with missing-glyph boxes. No runtime remote font/image requests. The renderer must handle long names, descriptions, and many rows without clipping or silent truncation.

## 8. Implementation boundaries and data flow

### Existing integration points

- `src/app/billing/payment-due/[patientId]/page.tsx`: admin-gated page and patient lookup; provide patient identity and dialog period metadata.
- `src/app/billing/payment-due/[patientId]/payment-due-detail.tsx`: existing prop-driven balance view; place the focused generation control without changing its displayed balances.
- `src/components/layout/mobile-page-header.tsx`: existing mobile action slot.
- `src/lib/auth.ts`, `src/lib/supabase/server.ts`, `src/lib/timezone.ts`, and `src/lib/logger.ts`: reuse current access, database, date, and error conventions.
- Billing migrations 031, 032, and 039: authoritative charges, active payment applications, package allocations, RLS, deletion handling, and zero-value-session behavior. Historical billing design docs are not calculation specifications.

### New focused modules

| Proposed file | Responsibility |
| --- | --- |
| `src/app/billing/payment-due/[patientId]/generate-pdf-dialog.tsx` | Period selection, loading, download, and error UI only. |
| `src/app/api/billing/payment-due/[patientId]/pdf/route.ts` | Authenticated Node-runtime POST endpoint; validate request, load data, build statement, render PDF, return attachment. |
| `src/lib/billing/payment-due-statement.ts` | Shared input/output types and pure filtering, classification validation, arithmetic, counts, sorting, section omission, and statement totals. |
| `src/lib/billing/payment-due-statement.server.ts` | Server-only source reader, validated source decoding, and single-snapshot database call. |
| `src/lib/billing/payment-due-pdf.tsx` | PDF rendering of the prepared statement only; no queries or financial calculations. |
| New timestamped migration | Read-only statement-source RPC and narrowly scoped execute permissions. |

Expose a read-only `get_payment_due_statement_source_v1` RPC taking only the patient ID. Use a `STABLE`, `SECURITY INVOKER` SQL function whose source data is assembled in one database statement so appointments, allocation membership, applications, package receipts, and identity belong to one MVCC snapshot. Return all completed source rows needed for the two regular modes and full package history. Aggregate into one structured response instead of relying on PostgREST row-page defaults. Return monetary values as text and a snapshot timestamp. Grant execute only to authenticated callers, with explicit active-clinic admin authorization and existing RLS enforcing clinic isolation; revoke default public/anonymous execute. An unauthorized or foreign-clinic lookup returns no patient data.

The response contract contains clinic and patient display names; completed appointments with charge ID, appointment ID, date, time, type, charge amount, applied amount, and nullable current package ID; package ID/name/creation time/status/quoted amount/total sessions/net receipts; and the full current availed allocation identities needed for count consistency. The statement builder verifies that completed rows and availed counts agree. The query derives clinic scope from the authenticated context rather than accepting a caller-supplied clinic ID.

Keep period selection outside the database reader. The pure builder filters ordinary rows by period, includes package data over its full lifetime, and produces the final content model: generated timestamp, patient/clinic identity, optional regular section, optional package section, and total due in paise. The renderer receives only this model. The model must never contain clinical notes, diagnoses, addresses, phone numbers, or unrelated patient fields.

Use `@react-pdf/renderer` on the server to render the model to a buffer. Select and pin a release compatible with the repository's Next.js 16.3.4 and React 18, commit the lockfile, and verify the production Node build. Bundle static fonts and their licences and ensure they are included in deployment tracing. This dependency is added during implementation, not while writing this design.

### Endpoint and download contract

Request body: `regularScope` is exactly `all_due` or `previous_month`; previous-month requests also carry the validated `periodMonth`. Reject malformed UUIDs, unsupported fields/periods, and user-supplied financial values. Resolve a current active admin profile and use the authenticated Supabase server client; no service-role bypass. Return safe 401/403/404/400 responses as appropriate rather than an HTML login page masquerading as a PDF.

Use 200 with `Content-Type: application/pdf`, `Content-Disposition: attachment`, and `Cache-Control: private, no-store` for a successful PDF. Use 422 with a stable `NO_PENDING_PAYMENT` JSON code for an empty statement; use a safe 500 response for loading/rendering failure. All responses, including errors, are non-cacheable. Use the existing middleware/access patterns while keeping the endpoint's own authorization check.

The client verifies status and PDF content type, downloads a blob via a temporary object URL, and releases that URL after the download is initiated. Use a sanitized filename such as `payment-summary-sample-patient-2026-09-06-regular-2026-08.pdf`; remove path separators/control characters and bound the name length. Do not include internal IDs in patient-visible output.

Do not store PDFs on the server, in Supabase Storage, localStorage, or service-worker caches. `public/sw.js` currently does not populate a response cache; preserve that behavior for the POST endpoint and test offline errors. Generation must never fall back to a previous patient's PDF.

## 9. Failure and concurrency behavior

Fetch fresh data on every generation; do not trust financial props from the open balance page. One source snapshot prevents mixed reads during a payment or appointment edit. A payment recorded after that snapshot can make the exported file stale; the generation timestamp identifies its scope, and generating again obtains a new statement. Do not hold a database lock while rendering the PDF.

Any required identity, charge, application, allocation, or package receipt query failure stops generation. Distinguish absent rows from query errors. Detect inconsistent package membership, application amounts above charges, missing completed charge records, invalid dates, and count/history mismatches; log safe identifiers and an error category through the existing logger, then ask the user to retry or review billing. Do not emit a partially complete financial document.

Network, server, or font/render errors leave the dialog open with the selected period preserved. Show a safe actionable error; do not report success based only on an HTTP request starting. Cancellation of the dialog or browser download does not record any delivery state. No automatic retry should produce repeated downloads.

## 10. Acceptance criteria and verification

### Calculation and scope tests

1. A completed ₹800 session with ₹300 actively applied displays ₹500 due; a fully paid or zero-fee regular session is absent.
2. Scheduled, cancelled, deleted, pending-charge, and voided-charge appointments never appear or contribute to the total.
3. All-due mode includes older unpaid regular sessions beyond any UI page size. Previous-month mode selects only the previous calendar month's completed regular sessions using their current balances.
4. Cover January rollover, leap-year February, clinic midnight versus a viewer in another timezone, inclusive first/last month days, and an open dialog crossing a month boundary.
5. For identical source data, switching regular scope produces identical package content and package subtotals, including package dates outside the selected month.
6. A ten-session package with four availed sessions and two scheduled reservations displays six sessions left, and exactly four completed date entries.
7. Package allocation membership prevents double charging. Partial applications, refunds/reversals, zero-fee package sessions, multiple payments per charge, and multiple packages preserve exact totals and scoped credit behavior.
8. Package quoted amount, net receipts, completed charges, applied money, and completed-session due remain distinct when prepayments fund future sessions. Fully paid/only-scheduled-due packages do not appear.
9. Independent empty-section tests cover regular-only, package-only, both, no data, no regular matches for the selected month, and all previously eligible sessions becoming paid before generation.
10. Corrupt/missing required data produces an error rather than incomplete output; a single-snapshot read yields a consistent before-or-after result during concurrent billing changes.

### PDF, access, and workflow checks

- Test the pure builder and period validation under `src/lib/billing/*.test.ts`.
- Add integration tests for the RPC's sums, current-allocation filtering, full row coverage, and anonymous/staff/inactive-clinic/foreign-clinic denial.
- Add dialog component tests for default/changed radio input, month rollover, pending state, errors, no-dues response, and download initiation.
- Add admin desktop/mobile end-to-end coverage for both modes and section omission. Assert staff cannot access the action or download endpoint; check another-clinic patient IDs and stale sessions.
- Generate real PDF fixtures for combined, regular-only, package-only, long-history, long-name, INR, Indian-script-name, and fractional-currency examples. Inspect extracted content and render pages to verify layout, page numbers, complete dates, repeated headers, and no blank sections or clipping. Verify totals against the builder fixtures.
- Test downloads in supported mobile/desktop browsers and the installed PWA, including an expired login and offline failure. Confirm manual attachment of the generated PDF works without an app-specific share integration.
- Run focused checks first, then the repository unit, component, integration, typecheck, lint, production-build, and relevant E2E suites. Report environment-dependent skips honestly. Include visible-flow QA evidence in any implementation PR.

## 11. Scope exclusions and review handoff

No WhatsApp message formatting, copying, deep links, direct sending, share sheet, payment collection integration, PDF storage/history, public access link, manual amount editing, arbitrary date-range picker, month selection beyond the immediately previous month, scheduled appointment collection, or unrelated billing refactor.

The only planned database addition is the read-only statement-source function and its access grants in a new migration. Existing allocation/reconciliation behavior and balances are preserved. Before implementation, review this written specification and then create the detailed task-by-task implementation plan.

## References checked during design

- Repository source and migrations cited above are the billing source of truth.
- [React-pdf Node API](https://react-pdf.org/docs/v4/node): server buffer rendering.
- [React-pdf font documentation](https://react-pdf.org/docs/v4/fonts): registration of local font files and supported formats.
- [React-pdf compatibility](https://react-pdf.org/docs/v4/compatibility): supported React versions and Next.js integration guidance; validate the pinned release in this repository's production build.
