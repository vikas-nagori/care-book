# User Timezone Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user-facing current-date boundaries follow the browser timezone with Kolkata fallback, and calculate upcoming appointments by absolute timestamp.

**Architecture:** A pure timezone module owns validation, zoned calendar arithmetic, user-day intervals, clinic appointment timestamp conversion, and date-only formatting. A client synchronizer stores the browser IANA timezone in a cookie; a server-only accessor validates that cookie for Server Components. Pages consume derived values, while clinic business jobs and stored wall-clock values remain Kolkata-based.

**Tech Stack:** Next.js App Router, React, TypeScript, `date-fns-tz`, Node test runner, Supabase.

---

## File map

- Create `src/lib/timezone.ts`: pure timezone constants and calendar/timestamp helpers.
- Create `src/lib/timezone.test.ts`: boundary, validation, interval, appointment timestamp, and date-only tests.
- Create `src/lib/timezone/server.ts`: validated timezone-cookie accessor for Server Components.
- Create `src/components/layout/timezone-sync.tsx`: browser timezone cookie synchronization.
- Modify `src/app/layout.tsx`: mount timezone synchronization globally.
- Create `src/lib/dashboard/appointments.ts`: dashboard interval filtering and next-appointment selection.
- Create `src/lib/dashboard/appointments.test.ts`: regression for the 18→19 July IST rollover.
- Modify `src/app/page.tsx`: query candidate clinic dates and filter/compare timestamps.
- Modify `src/app/dashboard-new-appointment.tsx`: accept the server-derived default date.
- Modify `src/lib/dashboard/current-date.ts` and its test: use Kolkata fallback for invalid browser zones.
- Modify `src/lib/schedule/date-range.ts` and its test: accept a resolved user timezone.
- Modify `src/app/schedule/page.tsx`, `src/app/schedule/schedule-view.tsx`, and `src/app/schedule/new/page.tsx`: use server-resolved today.
- Modify `src/app/billing/page.tsx`, `src/app/billing/billing-view.tsx`, `src/app/billing/billing-entry-form.tsx`, and `src/app/billing/metrics/[metric]/page.tsx`: user-zone month ranges and form defaults while preserving Kolkata allocation rules.
- Modify `src/app/patients/[id]/page.tsx`, `src/app/patients/[id]/patient-detail.tsx`, `src/app/patients/[id]/treatment-plan-form.tsx`, and relevant appointment/billing detail views: pass user default dates and safely render date-only values.

### Task 1: Pure timezone utilities

**Files:**
- Create: `src/lib/timezone.ts`
- Create: `src/lib/timezone.test.ts`

- [ ] **Step 1: Write failing tests**

Cover these public contracts:

```ts
assert.equal(resolveTimeZone(undefined), 'Asia/Kolkata')
assert.equal(resolveTimeZone('Invalid/Zone'), 'Asia/Kolkata')
assert.equal(resolveTimeZone('America/New_York'), 'America/New_York')

const instant = new Date('2026-07-18T18:30:00.000Z')
assert.equal(getZonedDate(instant, 'Asia/Kolkata'), '2026-07-19')
assert.equal(getZonedTime(instant, 'Asia/Kolkata'), '00:00')
assert.equal(getZonedDate(instant, 'America/New_York'), '2026-07-18')
assert.equal(getZonedTime(instant, 'America/New_York'), '14:30')

assert.deepEqual(getZonedCalendarContext(instant, 'Asia/Kolkata'), {
  date: '2026-07-19',
  time: '00:00',
  weekStart: '2026-07-13',
  weekEnd: '2026-07-19',
  monthStart: '2026-07-01',
  monthEnd: '2026-07-31',
  previousMonthStart: '2026-06-01',
  previousMonthEnd: '2026-06-30',
  monthLabel: 'July 2026',
  previousMonthLabel: 'June',
})
```

Also test half-open user-day intervals, clinic date keys overlapped by `America/New_York`, appointment conversion for `2026-07-18 11:30 Asia/Kolkata`, inclusive start/exclusive end checks, and `formatDateOnly('2026-07-18', 'dd MMM yyyy')` under a process timezone that would otherwise shift the date.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test --experimental-strip-types src/lib/timezone.test.ts`

Expected: failure because `src/lib/timezone.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure API**

Implement these exports using `formatInTimeZone` and `fromZonedTime`:

```ts
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata'
export const CLINIC_TIME_ZONE = 'Asia/Kolkata'
export const USER_TIME_ZONE_COOKIE = 'care_book_timezone'

export function isValidTimeZone(value: unknown): value is string
export function resolveTimeZone(value: unknown): string
export function getZonedDate(now: Date, timeZone: string): string
export function getZonedTime(now: Date, timeZone: string): string
export function getZonedCalendarContext(now: Date, timeZone: string): ZonedCalendarContext
export function getZonedDayInterval(now: Date, timeZone: string): { start: Date; end: Date }
export function getClinicDateRangeForInterval(start: Date, end: Date): { startDate: string; endDate: string }
export function appointmentToInstant(date: string, time: string): Date
export function isInstantInInterval(value: Date, start: Date, end: Date): boolean
export function formatDateOnly(value: string, pattern: string): string
```

Use UTC calendar arithmetic for date keys, Monday week boundaries, and month boundaries so results do not depend on the Node process timezone. Treat intervals as `[start, end)`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test --experimental-strip-types src/lib/timezone.test.ts`

Expected: all timezone utility tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timezone.ts src/lib/timezone.test.ts
git commit -m "feat: add shared user timezone utilities"
```

### Task 2: Browser/server timezone synchronization

**Files:**
- Create: `src/lib/timezone/server.ts`
- Create: `src/components/layout/timezone-sync.tsx`
- Create: `src/lib/timezone-sync-integration.test.ts`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Write a failing integration/source test**

Assert that the synchronizer reads `Intl.DateTimeFormat().resolvedOptions().timeZone`, writes `care_book_timezone` with `Path=/`, `SameSite=Lax`, and one-year max age only when it differs, calls `router.refresh()`, and is mounted by `RootLayout`. Assert that the server accessor reads the same cookie and calls `resolveTimeZone`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test --experimental-strip-types src/lib/timezone-sync-integration.test.ts`

Expected: failure because the synchronization files do not exist.

- [ ] **Step 3: Implement synchronization**

`getUserTimeZone()` in `src/lib/timezone/server.ts` must call `await cookies()`, read `USER_TIME_ZONE_COOKIE`, decode it safely, and return `resolveTimeZone(value)`.

`TimezoneSync` must run in `useEffect`, ignore an invalid/empty browser zone, compare the decoded cookie value, and write/refresh only on mismatch. Mount it once in `src/app/layout.tsx`.

- [ ] **Step 4: Run focused tests**

Run: `node --test --experimental-strip-types src/lib/timezone.test.ts src/lib/timezone-sync-integration.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timezone src/lib/timezone-sync-integration.test.ts src/components/layout/timezone-sync.tsx src/app/layout.tsx
git commit -m "feat: synchronize browser timezone with server"
```

### Task 3: Timestamp-based dashboard behavior

**Files:**
- Create: `src/lib/dashboard/appointments.ts`
- Create: `src/lib/dashboard/appointments.test.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/dashboard-new-appointment.tsx`
- Modify: `src/lib/dashboard/current-date.ts`
- Modify: `src/lib/dashboard/current-date.test.ts`

- [ ] **Step 1: Write the midnight regression test**

At `2026-07-18T18:30:00.000Z`, verify that a scheduled `2026-07-18 11:30` Kolkata appointment is before the current timestamp and is not selected, while a scheduled `2026-07-19 11:30` appointment is selected. Test day/week filtering at exact interval boundaries.

- [ ] **Step 2: Run the dashboard test and verify RED**

Run: `node --test --experimental-strip-types src/lib/dashboard/appointments.test.ts`

Expected: failure because the dashboard appointment helper does not exist.

- [ ] **Step 3: Implement the pure dashboard helper**

Export functions that filter rows by appointment timestamp within a half-open interval and choose the earliest scheduled row whose appointment timestamp is `>= now`.

- [ ] **Step 4: Wire the dashboard**

Read `getUserTimeZone()`, create one `now`, derive calendar/day/week contexts, query the clinic date keys overlapping the day and week, then filter returned rows by appointment timestamps. Remove all server-local `format(new Date())` boundaries and the `toLocaleString`/`HH:mm` string comparison. Pass the derived default date into dashboard appointment dialogs. Change invalid dashboard-label timezone fallback from UTC to Kolkata.

- [ ] **Step 5: Run focused dashboard tests**

Run: `node --test --experimental-strip-types src/lib/timezone.test.ts src/lib/dashboard/appointments.test.ts src/lib/dashboard/current-date.test.ts`

Expected: pass, including the original midnight reproduction.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/dashboard-new-appointment.tsx src/lib/dashboard src/lib/timezone.ts
git commit -m "fix: compare dashboard appointments by timestamp"
```

### Task 4: Schedule and appointment defaults

**Files:**
- Modify: `src/lib/schedule/date-range.ts`
- Modify: `src/lib/schedule/date-range.test.ts`
- Modify: `src/lib/schedule/historical-schedule-page.test.ts`
- Modify: `src/app/schedule/page.tsx`
- Modify: `src/app/schedule/schedule-view.tsx`
- Modify: `src/app/schedule/new/page.tsx`

- [ ] **Step 1: Extend schedule tests and verify RED**

Add a third `timeZone` argument to `resolveScheduleDateRange`. For the same instant, assert the fallback date differs appropriately between Kolkata and New York, while a valid explicit URL date remains unchanged. Update the schedule source contract test to require the timezone-aware resolver call and server-derived `todayDate` prop.

Run: `node --test --experimental-strip-types src/lib/schedule/date-range.test.ts src/lib/schedule/historical-schedule-page.test.ts`

Expected: new timezone-specific assertion fails.

- [ ] **Step 2: Implement and wire**

Replace the hard-coded schedule formatter with `getZonedDate(now, resolveTimeZone(timeZone))`. The schedule page reads the cookie timezone and passes a server-derived `todayDate` prop to `ScheduleView`. The standalone new-appointment page uses the same date for `defaultDate`.

- [ ] **Step 3: Run focused tests**

Run: `node --test --experimental-strip-types src/lib/schedule/date-range.test.ts src/lib/schedule/historical-schedule-page.test.ts src/lib/timezone.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/schedule/date-range.ts src/lib/schedule/date-range.test.ts src/lib/schedule/historical-schedule-page.test.ts src/app/schedule
git commit -m "fix: honor user timezone in schedule defaults"
```

### Task 5: Billing boundaries and user-facing defaults

**Files:**
- Modify: `src/app/billing/page.tsx`
- Modify: `src/app/billing/billing-view.tsx`
- Modify: `src/app/billing/billing-entry-form.tsx`
- Modify: `src/app/billing/metrics/[metric]/page.tsx`
- Modify: `src/app/billing/payment-form.tsx`
- Create: `src/lib/timezone-usage-integration.test.ts`

- [ ] **Step 1: Write a failing source/integration test**

Assert that billing pages call `getUserTimeZone`/`getZonedCalendarContext`, month drill-downs derive their range from that context, user-facing form defaults are passed from the server-derived user date, and billing allocation preview still uses `CLINIC_TIME_ZONE` rather than the browser cookie.

- [ ] **Step 2: Run and verify RED**

Run: `node --test --experimental-strip-types src/lib/timezone-usage-integration.test.ts`

- [ ] **Step 3: Implement billing changes**

Use the shared calendar context for current and previous month keys/labels. Pass `currentMonthLabel` and `defaultPaymentDate` through `BillingView` to `BillingEntryForm`. Continue deriving allocation-preview `today` with `CLINIC_TIME_ZONE`, matching database allocation functions. Update the unused legacy payment form consistently without altering allocation semantics.

- [ ] **Step 4: Run focused tests**

Run: `node --test --experimental-strip-types src/lib/timezone.test.ts src/lib/timezone-usage-integration.test.ts src/lib/billing/payment-helpers.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/billing src/lib/timezone-usage-integration.test.ts
git commit -m "fix: use user timezone for billing periods"
```

### Task 6: Date-only rendering and remaining form defaults

**Files:**
- Modify: `src/app/patients/[id]/page.tsx`
- Modify: `src/app/patients/[id]/patient-detail.tsx`
- Modify: `src/app/patients/[id]/treatment-plan-form.tsx`
- Modify: `src/app/schedule/[id]/appointment-detail.tsx`
- Modify: `src/app/billing/billing-view.tsx`
- Modify: `src/lib/timezone-usage-integration.test.ts`

- [ ] **Step 1: Extend the failing integration test**

Assert the patient page passes a server-derived default date into treatment-plan creation and unsafe `format(new Date(dateOnly), ...)` patterns are absent from the identified date-only display paths.

- [ ] **Step 2: Implement safe date-only handling**

Use `formatDateOnly` for database `date` columns and pass `defaultDate` from the user timezone context into `TreatmentPlanForm`. Do not change absolute timestamp displays such as `created_at`.

- [ ] **Step 3: Run focused and full unit tests**

Run: `npm run test:unit`

Expected: all unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/patients src/app/schedule/'[id]'/appointment-detail.tsx src/app/billing/billing-view.tsx src/lib/timezone-usage-integration.test.ts
git commit -m "fix: preserve date-only calendar values"
```

### Task 7: Full verification and publish branch

**Files:**
- Verify all changed files

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: exit 0 with no errors.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: exit 0 and all routes compile.

- [ ] **Step 3: Inspect the final diff**

Run: `git status --short && git diff --check && git log --oneline --decorate -10`

Expected: clean worktree, no whitespace errors, focused commits on `fix/dashboard-ist-boundary`.

- [ ] **Step 4: Push the branch**

Run: `git push -u origin fix/dashboard-ist-boundary`

Expected: GitHub accepts the branch and sets the upstream.
