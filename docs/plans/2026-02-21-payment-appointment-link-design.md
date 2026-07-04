# Payment–Appointment Link Design

**Date:** 2026-02-21
**Status:** Approved

## Problem

Payments are currently recorded against patients with no link to specific appointment sessions. There is no per-session fee, no way to know which sessions have been paid for, and appointments are never automatically closed at end of day.

## Goals

1. Capture a per-session fee at appointment booking time (auto-filled from global rates, editable)
2. When entering a payment, link it to specific appointments — either past completed sessions (postpaid) or upcoming sessions (prepaid, including today)
3. Auto-complete appointments at end of day (IST) if not explicitly cancelled
4. All date/time logic in IST (`Asia/Kolkata`)

---

## Database Changes

### New table: `global_settings`
Single-row config table (always id = 1).

```sql
CREATE TABLE global_settings (
  id            integer PRIMARY KEY DEFAULT 1,
  home_visit_fee numeric(10,2) NOT NULL DEFAULT 0,
  clinic_fee     numeric(10,2) NOT NULL DEFAULT 0,
  CHECK (id = 1)  -- enforce single row
);
INSERT INTO global_settings DEFAULT VALUES;
```

### `appointments` — new columns
```sql
ALTER TABLE appointments
  ADD COLUMN fee            numeric(10,2),
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'prepaid', 'paid'));
```

### New table: `appointment_payments` (junction / audit trail)
```sql
CREATE TABLE appointment_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  appointment_id  uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, appointment_id)
);
```

---

## Feature Designs

### 1. Global Settings Page (`/settings`)

- New page added to sidebar navigation
- Simple form: **Home Visit Fee (₹)** and **Clinic Fee (₹)**
- Server Component page + Client Component form (follows existing pattern)
- `upsert` into `global_settings` on save

### 2. Appointment Booking — Fee Field

In `appointment-form.tsx`:
- Add **Fee (₹)** numeric field
- On load and on `type` change, fetch `global_settings` and pre-fill fee from `home_visit_fee` or `clinic_fee`
- Field is editable — can override per booking
- Saved to `appointments.fee`
- No prepaid/postpaid concept at booking time

### 3. Payment Form — Session Linking

In `payment-form.tsx`, additions:
- **Patient confirmation**: patient name shown prominently at top (patient_id already required)
- **Payment timing toggle**: Prepaid / Postpaid (new field in UI, not stored separately — inferred from which appointments get linked)
- **Session calculation preview**: amount ÷ session fee = N sessions

**Postpaid flow:**
- Query: `appointments WHERE patient_id = ? AND status = 'completed' AND payment_status = 'unpaid' ORDER BY date ASC`
- Take the first N results
- Show list: "This covers 3 completed sessions (Jan 5, Jan 7, Jan 10)"
- On save:
  1. Insert `payments` row
  2. Insert N rows into `appointment_payments`
  3. Set those appointments' `payment_status = 'paid'`

**Prepaid flow:**
- Query: `appointments WHERE patient_id = ? AND status = 'scheduled' AND payment_status = 'unpaid' AND date >= CURRENT_DATE (IST) ORDER BY date ASC`
- Take the first N results (includes today's sessions)
- Show list: "This prepays 3 upcoming sessions (Feb 21, Feb 24, Feb 26)"
- On save:
  1. Insert `payments` row
  2. Insert N rows into `appointment_payments`
  3. Set those appointments' `payment_status = 'prepaid'`

**Session fee for calculation**: use fee from the patient's most recent appointment (from the queried sessions), or fall back to global settings.

### 4. Auto-Complete Cron Job (Supabase pg_cron)

Runs at **18:29 UTC = 23:59 IST** daily.

```sql
SELECT cron.schedule(
  'auto-complete-appointments',
  '29 18 * * *',
  $$
    UPDATE appointments
    SET status = 'completed'
    WHERE status = 'scheduled'
      AND (date::text || ' ' || time::text)::timestamp
            < (NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp
  $$
);
```

This runs entirely in Supabase — no app-side code required.

---

## TypeScript Types to Add

```typescript
// global_settings
export type GlobalSettings = {
  id: number
  home_visit_fee: number
  clinic_fee: number
}

// appointment_payments
export type AppointmentPayment = {
  id: string
  payment_id: string
  appointment_id: string
  created_at: string
}

// extend Appointment
// add: fee?: number | null, payment_status: 'unpaid' | 'prepaid' | 'paid'
```

---

## UI Touch Points

| Location | Change |
|---|---|
| Sidebar | Add "Settings" link |
| `/settings` | New page |
| `appointment-form.tsx` | Add Fee field with auto-fill |
| `payment-form.tsx` | Add prepaid/postpaid toggle + session preview |
| Appointment detail/list | Show `payment_status` badge |

---

## Currencies

All monetary values are in **INR (₹)**.
