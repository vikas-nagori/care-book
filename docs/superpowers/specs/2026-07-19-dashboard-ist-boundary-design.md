# Dashboard IST Boundary Fix

## Problem

The dashboard derives its appointment query date from the server's local timezone but derives its current clock time separately in `Asia/Kolkata`. Between 00:00 and 05:29 IST on a UTC server, this combines the previous UTC calendar date with the new IST day's clock time. A scheduled appointment from the previous day can therefore appear as "Up next."

## Design

Add a small dashboard time helper that accepts a `Date` and returns all calendar values needed by the dashboard from the same `Asia/Kolkata` instant:

- current date in `yyyy-MM-dd` form;
- current local time in `HH:mm` form;
- Monday-based week start and end dates;
- month start and end dates.

The helper will be server-safe and independent of the process timezone. The dashboard will create one `Date`, pass it to the helper once, and use the returned values for its appointment, weekly-count, monthly-revenue, and "Up next" calculations. No database schema or stored appointment representation will change.

## Testing

Add focused unit coverage for 19 July 2026 at 00:00 IST (`2026-07-18T18:30:00.000Z`) while the test process runs independently of local timezone assumptions. The regression must prove that the dashboard context reports 19 July and 00:00, with the correct week and month boundaries. Include a normal daytime case to protect the date/time formatting contract.

Run the focused test first, then the complete unit suite, lint, and production build.

## Scope

This change is limited to dashboard calendar calculations. It does not alter appointment creation, schedule navigation, automatic completion, billing allocation rules, or the browser-rendered dashboard date label.
