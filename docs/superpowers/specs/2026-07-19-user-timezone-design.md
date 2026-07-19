# User Timezone Handling

## Problem

User-facing date calculations currently mix the server process timezone, hard-coded `Asia/Kolkata`, and the browser timezone. On a UTC server, the dashboard can query the previous calendar day while comparing appointment times against the new IST day's clock. Similar boundary errors can affect schedule defaults, billing month ranges, and form defaults.

The application also stores appointments and other calendar fields as separate date-only and time-only values. Those values represent clinic wall-clock data and must not shift merely because a viewer uses another timezone.

## Timezone Policy

Use the browser/device IANA timezone for user-facing concepts of "now":

- dashboard today, week, month, and current-time filtering;
- the schedule's default selected date and today marker;
- user-facing current-month billing ranges and labels;
- default dates in appointment, payment, billing, and treatment-plan forms.

Use `Asia/Kolkata` when the browser timezone is unavailable, invalid, or has not yet reached the server.

Preserve these clinic-local or system rules:

- appointment date and time values remain unchanged clinic wall-clock values and are not converted for display;
- date-only values such as dates of birth, treatment-plan dates, payment dates, and appointment dates remain the same calendar date in every timezone;
- automatic appointment completion, database billing allocation, and other background work continue using `Asia/Kolkata`, because they have no active browser user and must follow one deterministic clinic business day;
- absolute audit timestamps such as `created_at` and `updated_at` remain UTC ISO timestamps and may be localized only when displayed.

## Architecture

### Browser timezone synchronization

Add a small client component to the root layout. On mount it resolves `Intl.DateTimeFormat().resolvedOptions().timeZone`, validates that a non-empty timezone was returned, and compares it with a `care_book_timezone` cookie. When different, it writes the cookie for the whole application with `Path=/`, `SameSite=Lax`, and a one-year lifetime, then calls `router.refresh()` once so Server Components refetch with the browser timezone.

The first server render uses the Kolkata fallback. Subsequent renders use the synchronized cookie. A timezone change on the device is picked up on the next mount and causes one refresh; matching values do not refresh, preventing loops.

### Shared timezone utilities

Add pure utilities that:

- validate an IANA timezone using `Intl.DateTimeFormat`;
- resolve an invalid or missing value to `Asia/Kolkata`;
- format an instant into a calendar date or time in a supplied timezone;
- derive Monday-based week and calendar-month boundaries from the same instant and timezone;
- format date-only database values without interpreting them as UTC instants.

Add a server-only accessor that reads and validates the timezone cookie. Server-rendered pages use this accessor and pass the resolved timezone or derived date values to Client Components when needed for hydration consistency.

## Affected Areas

### Dashboard

Create one `Date` per request and derive the appointment query date, current time, week range, and month range from the resolved user timezone. The "Up next" filter must consume the same context, eliminating mixed date/time zones.

### Schedule and appointment creation

Make the schedule date-range resolver accept a timezone instead of hard-coding Kolkata. The schedule page, today marker, standalone new-appointment route, and dashboard appointment dialogs use the resolved user calendar date. Explicit dates in the URL remain unchanged.

### Billing and form defaults

Use the resolved timezone for user-visible current/previous month ranges and labels, and for default payment/billing dates. Billing allocation previews and database allocation functions remain on the Kolkata clinic business day so preview and persisted allocation behavior stay aligned.

### Date-only rendering

Replace unsafe `new Date('YYYY-MM-DD')` display paths in touched appointment, patient, billing, and treatment-plan views with date-only-safe parsing/formatting. This prevents a stored calendar date from rendering as the previous day in negative UTC offsets.

### Exclusions

Do not change the database schema, migrate appointment records, convert stored appointment times, alter recurrence semantics, or make cron/database functions depend on a browser cookie.

## Testing

Add focused unit coverage for:

- `2026-07-18T18:30:00.000Z` resolving to 19 July at 00:00 in Kolkata;
- the same instant resolving correctly in a second browser timezone;
- Monday-based week and month boundaries across timezone day/month transitions;
- invalid or missing timezones falling back to Kolkata;
- strict date-only formatting without calendar-day shifts;
- schedule defaults honoring the supplied timezone while explicit URL dates remain unchanged.

Run the focused tests first, then the complete unit suite, lint, and production build. Manually verify the dashboard, schedule, new appointment, billing, and treatment-plan default-date flows with browser timezone emulation where practical.
