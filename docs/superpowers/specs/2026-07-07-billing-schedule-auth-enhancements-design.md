# Care-Book: Billing, Schedule & Auth Enhancements — Design

_Date: 2026-07-07_

## Context

Four workstreams surfaced from the 2026-07-06 Granola meetings. They cluster around
billing/payments, plus one schedule tweak and one auth feature. One of them — the
payment-due recalculation bug — is **foundational**: the "payment due" figure that
several of the display features want to show is computed by the very code path that
is broken. It must land first, otherwise the new views render wrong numbers.

Delivered as **one phased spec**, in dependency order:
Foundation → Billing UI → Schedule → Auth.

### Architectural facts confirmed during exploration

- **Two independent derived ledgers.** Money lives in `appointment_payments`
  (`amount_applied`) + `appointments.payment_status`, managed by
  `allocate_patient_payment_credit`. Package *session quota* lives in
  `package_session_allocations` + `packages.used_sessions`, managed by
  `assign_patient_package_sessions`. They touch different tables.
- **The due calc never looks at packages.** `buildPaymentDueRows`
  (`src/lib/billing/payment-due.ts`) sums completed *unpaid* session fees minus
  per-patient `unspentCredit`. A package's money enters as an ordinary `payment` row
  and flows through the same FIFO credit pool.
- **The credit/overpayment concept already exists**, derived as
  `unspentCredit = payment.amount − Σ amount_applied`. No new billing logic is needed
  to surface credit.
- **One trigger drives both re-syncs.** `appointments_sync_patient_billing_allocations`
  fires `after insert or update of patient_id, status, date, time, fee` and runs BOTH
  `assign_patient_package_sessions` and `allocate_patient_payment_credit`. Cancellation
  is handled specially by `untally_cancelled_appointment_billing`
  (`supabase/migrations/008_untally_cancelled_appointments.sql`).

---

## Phase 1 (Foundation) — Fix payment-due recalculation

### Root cause

`allocate_patient_payment_credit` (current version in
`supabase/migrations/015_fix_appointment_row_alias_collision.sql`) only ever pays off
sessions still flagged `unpaid` and uses `insert … on conflict do nothing`. It **never
un-ties money from an already-paid session nor re-snapshots `amount_applied`**. So
editing the fee (or status) of an *already-paid* session moves `appointments.fee` but
nothing recomputes its allocation — the due/credit total never changes. The same
failure class applies to `completed → scheduled` un-completion.

### Fix — Approach A: idempotent per-patient re-derivation

New migration **`022_idempotent_payment_credit_reallocation.sql`** rewriting
`allocate_patient_payment_credit(target_patient_id)` so that, for the target patient
only, it:

1. Deletes all `appointment_payments` for that patient's **non-cancelled** sessions.
2. Resets those sessions' `payment_status` back to `'unpaid'`.
3. Re-runs the existing two-pass FIFO allocation (Pass 1: completed unpaid oldest-first;
   Pass 2: upcoming scheduled) over **current** fees and **all** the patient's payments.

Properties:

- **Idempotent** — running it repeatedly lands on the same result; correct by construction.
- **Per-patient** — scoped to the one patient whose row changed; not a global recompute.
- **Cheap** — the same trigger that already runs today, made thorough (tens of rows).
- **Packages handled for free** — package prepayments are payments in the pool; the
  rebuild touches only `appointment_payments` + `payment_status`, never
  `package_session_allocations` / `used_sessions`, so package counters are undisturbed.
- **Covers status changes too** — because it re-derives from current state, any trigger
  firing (fee edit, status flip, un-completion, new/deleted payment) yields correct
  money + package coverage.

Interaction to preserve: the cancellation untally trigger (008) stays; the new
idempotent rebuild must skip cancelled sessions (matches "non-cancelled" in step 1).

Low-priority cosmetic note: `assign_patient_package_sessions`'s "prefer fee-matched
sessions" (`supabase/migrations/013_package_prefer_fee_matched_sessions.sql`) will not
re-optimize which session displays under a package on a fee edit — this affects package
*display* only, never the due total, and is left as-is.

### Files

- **New:** `supabase/migrations/022_idempotent_payment_credit_reallocation.sql`
- No change to `src/lib/billing/payment-due.ts` for correctness (it reads live once the
  underlying `appointment_payments` / `payment_status` are correct).

### Tests

Integration test (`npm run test:integration`, local Postgres): raise a paid session's
fee → due increases; lower it → credit released; un-complete a paid session → money
freed; package-prepayment scenario → sessions covered correctly and `used_sessions`
unchanged by the money rebuild.

---

## Phase 2 (Billing UI)

All in `src/app/billing/billing-view.tsx` plus a new route.

### 2a. Rename "Payment Due" → "Payments Balance"; surface due AND credit

- No separate Credit tab. Rename the `payment_due` tab label to **"Payments Balance"**.
- Change `buildPaymentDueRows` to **keep patients with a non-zero position in either
  direction** (it currently `.filter((row) => row.netDue > 0)` — loosen so
  credit-positive patients also appear).
- Each row labelled **Due** or **Credit**; owing rows keep the existing
  Gross Due / Credit / Net Due columns.
- Tabs become: **Overview · Payments Balance · Payments · Packages**.

### 2b. Recent-10 + View More + section headers

- Each list tab (Payments Balance, Payments, Packages) gets a titled section bar and
  shows the **recent 10**, with a **"View More"** that reveals the rest — reusing the
  existing `loadMorePayments` / `loadMorePackages` count machinery in
  `src/app/billing/billing-view.tsx`, replacing the bare "Load more (50)" pattern.
- Open interpretation of the meeting's "a few more buttons below each sub-tab" = keep
  existing actions; to confirm during review.

### 2c. Payments-balance drill-down page

- New route **`src/app/billing/payment-due/[patientId]/page.tsx`** (server component,
  `requireAdmin()`), plus a presentational client component.
- Payments Balance rows become clickable → this page lists every completed-unpaid
  session with **date, type, per-session fee**, summing to Gross Due → Credit applied →
  Net Due (the calculation made fully visible).
- Isolate the summary into a presentational component so a future
  **"Export / Share PDF"** button is a clean add (out of scope now).

### 2d. Clickable metric tiles (billing + dashboard) — hybrid drill-down

Every `.ph-stat` tile on **both** the Billing page and the Dashboard becomes
clickable, respecting existing role gates (money tiles stay hidden from staff without
`canViewBilling`). Two behaviours, per the hybrid decision:

**Money tiles → dedicated metric-detail view.** New route
**`src/app/billing/metrics/[metric]/page.tsx`** (server component, `requireAdmin()`)
that switches on a metric slug and renders the exact contributing records plus the
summed total (mirroring the Payments Balance drill-down component so the calculation
is visible). Slugs and their sources:

| Slug | Tile(s) | Underlying records |
|---|---|---|
| `billed-this-month` | Billing "Total billed" | completed sessions with `date` in this month, summed by `fee` (matches `sumCompletedFees`) |
| `billed-last-month` | Billing "Billed last month" | completed sessions in last month, summed by `fee` |
| `received-this-month` | Billing "Received" + Dashboard "This month" | `payments` with `date` in this month |

**Outstanding tiles** (Billing + Dashboard) → the **Payments Balance** view, not a new
route: deep-link to `/billing?tab=payment_due`. `billing-view.tsx` gains a
`?tab=` initial-tab read so the deep link opens the right tab.

**Count tiles → link to the relevant existing page** (no new UI):
Dashboard "Today" → `/schedule`; "This week" → `/schedule`; total-patients →
`/patients`. On the Billing page, the Billing "Total billed"/"Received"/"Billed last
month" tiles use the metric route above.

Implementation: Dashboard (`src/app/page.tsx`, a server component) wraps each tile in
`<Link>`. `billing-view.tsx` (client) wraps money tiles in `<Link>` to the metric
route and routes the Outstanding tile to its tab. Add a subtle hover affordance to
`.ph-stat` (or a `.ph-stat-link` variant) so tiles read as clickable.

### Files

- `src/app/billing/billing-view.tsx` — tab rename, row labels, Recent-10 / View More, clickable rows, `?tab=` initial tab, clickable tiles
- `src/lib/billing/payment-due.ts` — keep credit-positive patients
- **New:** `src/app/billing/payment-due/[patientId]/page.tsx` + drill-down component
- **New:** `src/app/billing/metrics/[metric]/page.tsx` + shared metric-detail component
- `src/app/billing/page.tsx` — data for the balance rows already present (`patientCredit`)
- `src/app/page.tsx` — wrap dashboard tiles in links (Outstanding → `/billing?tab=payment_due`, This month → metric route, count tiles → schedule/patients)
- `src/app/globals.css` — clickable-tile hover affordance (`.ph-stat` / `.ph-stat-link`)

---

## Phase 3 (Schedule)

- Add **this session's fee** to `src/app/schedule/[id]/appointment-detail.tsx`
  (patient address already renders there).
- Gate the fee behind the existing restricted-visibility flag (`canViewPaymentSignals`
  from `src/lib/access/restricted-visibility.ts`) so staff see it only per current
  admin/staff rules.
- Thread the flag from `src/app/schedule/[id]/page.tsx` into the detail component.

### Files

- `src/app/schedule/[id]/page.tsx` — compute + pass access flag
- `src/app/schedule/[id]/appointment-detail.tsx` — render gated fee

---

## Phase 4 (Auth) — Admin resend password reset (platform superadmin only)

- Add a **"Send password reset"** button per user in
  `src/app/platform/users/users-list.tsx`, next to Block/Unblock (mirror the existing
  `busyId` + `useToast` + `router.refresh()` pattern).
- New server action in `src/app/platform/users/actions.ts`, guarded by
  `requirePlatformAdminUser()` (`src/lib/platform/server.ts`).
- Send the recovery email via the service-role admin client
  (`src/lib/supabase/admin.ts`) — `generateLink({ type: 'recovery', email, options: {
  redirectTo } })` (or `resetPasswordForEmail`), with
  `redirectTo = ${origin}/auth/callback?next=%2Fauth%2Fupdate-password`.
- Relies on the existing recovery email template already using `{{ .TokenHash }}`
  (consumed by `src/app/auth/callback/route.ts`).

### Files

- `src/app/platform/users/actions.ts` — new `sendPasswordReset` action
- `src/app/platform/users/users-list.tsx` — per-user button

---

## Verification (end-to-end)

1. **Phase 1:** `npm run test:integration` with the new fee-edit / status-flip / package
   scenarios; manually edit a paid session's fee in the app and confirm the `/billing`
   and dashboard "Outstanding" totals move correctly.
2. **Phase 2:** Load `/billing`, confirm tabs read **Overview · Payments Balance ·
   Payments · Packages**; a credit-positive patient shows as **Credit**; Recent-10 +
   View More works; click a balance row → drill-down page shows the per-session tally
   summing to the shown balance. Click each tile on both `/billing` and the dashboard:
   money tiles open the metric-detail view whose records sum to the tile figure,
   Outstanding tiles land on the Payments Balance tab, and count tiles open
   schedule/patients. Confirm staff without `canViewBilling` see no clickable money tiles.
3. **Phase 3:** Open an appointment detail as admin (fee visible) and as staff (hidden
   per `canViewPaymentSignals`).
4. **Phase 4:** As a platform superadmin, click "Send password reset" for a user;
   confirm the recovery email arrives and its link lands on `/auth/update-password`.
5. `npm run lint` + `npm run test:unit` clean. Watch the GitHub Actions `Tests` workflow
   to green after pushing (per CLAUDE.md CI policy).

## Notes

- Branch: `feat/billing-schedule-auth-enhancements` off `main`.
- Next step after spec approval: use the writing-plans skill to produce the step-by-step
  implementation plan.
