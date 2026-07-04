# Product Requirements Document
## Care-Book — Current State (as of March 2026)

**Product:** Solo physiotherapy practice management tool
**Owner:** Amruta (solo practitioner)
**Stack:** Next.js 14 · TypeScript · Supabase · Tailwind CSS · shadcn/ui
**Deployment:** Vercel

---

## 1. Product Overview

A mobile-first CRM for a solo physiotherapy practice. The tool replaces manual record-keeping for patient management, scheduling, clinical notes, and billing. Designed for a single authenticated user (the practitioner) with all data isolated behind Supabase Row Level Security.

**Primary use case:** Physiotherapist opens the app on phone before/after sessions, records appointments, writes SOAP notes, and tracks payments — all from one place.

---

## 2. What's Built

### 2.1 Authentication
- Email + password login via Supabase Auth
- Session stored in cookies via `@supabase/ssr`
- All routes protected by `src/middleware.ts` — unauthenticated users are redirected to `/login`
- Authenticated users are redirected away from `/login` to `/`

---

### 2.2 Dashboard (`/`)

**Purpose:** At-a-glance view of the day and week.

**Metrics shown:**
| Card | Query |
|---|---|
| Today's appointments | `appointments WHERE date = today` |
| This week's appointments | `appointments WHERE date BETWEEN monday AND sunday` |
| Week revenue | Sum of `payments.amount` this week |
| Outstanding balance | Sum of `packages.total_amount - packages.paid_amount` where balance > 0 |

**Today's schedule list:** All of today's appointments with patient name, time, type badge (Home Visit / Clinic), status badge, and payment status badge.

**Quick actions:** Buttons to create new appointment and new patient.

---

### 2.3 Patients (`/patients`)

#### Patient List (`/patients`)
- Fetches all patients server-side, passes to `PatientList` client component
- Real-time search (client-side) by name or phone number
- Tap a patient card → goes to patient detail

#### New Patient (`/patients/new`)
- Form fields: Name (required), Phone (required), Email, Date of Birth, Gender, Address, Medical History, Notes
- On submit: `supabase.from('patients').insert(...)` → redirect to `/patients`

#### Edit Patient (`/patients/[id]/edit`)
- Same form pre-filled with existing data
- On submit: `supabase.from('patients').update(...)` → redirect to patient detail

#### Patient Detail (`/patients/[id]`)
All related data fetched in parallel on the server:
- Patient profile
- All appointments (with status + payment_status)
- Treatment plans
- Packages
- Payments

Rendered by `PatientDetail` client component with tabbed sections.

**Treatment Plan form** (`treatment-plan-form.tsx`):
- Fields: Diagnosis, Goals, Planned Sessions, Notes
- Can add/edit treatment plans directly from patient detail page

---

### 2.4 Schedule (`/schedule`)

#### Schedule View (`/schedule`)
- Server fetches appointments from today onwards + full patients list
- `ScheduleView` client component with two display modes:
  - **Day view** — single day's appointments
  - **Week view** — 7-day grid
- Date navigation (prev/next arrows)
- Payment status badge on each appointment card (`unpaid` / `prepaid` / `paid`)
- "New Appointment" button opens inline dialog

#### New Appointment (`/schedule/new` or dialog)
`AppointmentForm` fields:
- Patient (dropdown, required)
- Date (required)
- Time (required)
- Duration (minutes, default 60)
- Type: `home_visit` | `clinic`
- Status: `scheduled` | `completed` | `cancelled`
- Fee (₹) — auto-filled from `global_settings` based on appointment type, editable
- Notes

#### Appointment Detail (`/schedule/[id]`)
- Shows appointment info + patient name
- Payment status badge
- Session note section (SOAP format)

#### Session Notes (`session-note-form.tsx`)
SOAP-structured clinical notes:
- **S** — Subjective (patient-reported)
- **O** — Objective (practitioner observed)
- **A** — Assessment
- **P** — Plan
- **Exercises Prescribed** (free text)

One session note per appointment. Create or edit from appointment detail.

---

### 2.5 Billing (`/billing`)

Fetches on server: packages, payments, patients, appointments (completed/scheduled only).

`BillingView` client component with two sections:

#### Packages
Track prepaid session bundles per patient:
- Fields: Patient, Total Sessions, Total Amount (₹), Sessions Used, Paid Amount (₹), Notes
- Package form: `package-form.tsx`

#### Payments
Record payments with session linking:

**Payment Form** (`payment-form.tsx`) — rewrites as of Feb 2026:
- Patient (required, shown prominently)
- Amount (₹, required)
- Date (required)
- Payment method: Cash / UPI / Card / Bank Transfer
- **Payment timing toggle: Prepaid / Postpaid**
- **Session calculation preview:** Amount ÷ session fee = N sessions to be linked
- **Postpaid flow:**
  - Queries completed, unpaid appointments for this patient ordered by date ASC
  - Takes first N appointments to cover the amount
  - Shows preview: "Covers 3 completed sessions (Jan 5, Jan 7, Jan 10)"
  - On save: inserts payment row + N rows into `appointment_payments` + sets those appointments' `payment_status = 'paid'`
- **Prepaid flow:**
  - Queries upcoming scheduled, unpaid appointments (date ≥ today IST)
  - Takes first N appointments
  - Shows preview: "Prepays 3 upcoming sessions (Feb 21, Feb 24, Feb 26)"
  - On save: inserts payment row + N rows into `appointment_payments` + sets those appointments' `payment_status = 'prepaid'`
- Optional FK to a package

---

### 2.6 Settings (`/settings`)

Single-row config table (`global_settings`) for default session rates:
- **Home Visit Fee (₹)**
- **Clinic Fee (₹)**

Used to auto-fill the Fee field when booking appointments. Values are editable per booking.

---

## 3. Database Schema

### Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `patients` | Patient records | `name`, `phone`, `email`, `dob`, `gender`, `address`, `medical_history` |
| `appointments` | Scheduled/completed sessions | `patient_id`, `date`, `time`, `duration_minutes`, `type`, `status`, `payment_status`, `fee` |
| `treatment_plans` | Clinical plans per patient | `patient_id`, `diagnosis`, `goals`, `planned_sessions`, `notes` |
| `session_notes` | SOAP notes per appointment | `appointment_id`, `subjective`, `objective`, `assessment`, `plan`, `exercises_prescribed` |
| `packages` | Prepaid session bundles | `patient_id`, `total_sessions`, `sessions_used`, `total_amount`, `paid_amount` |
| `payments` | Payment records | `patient_id`, `amount`, `date`, `payment_method`, `appointment_id` (opt), `package_id` (opt) |
| `appointment_payments` | Payment↔Appointment junction | `payment_id`, `appointment_id` (unique pair) |
| `global_settings` | Singleton config (id=1) | `home_visit_fee`, `clinic_fee` |

### Status Enums

**Appointment `status`:** `scheduled` | `completed` | `cancelled`
**Appointment `payment_status`:** `unpaid` | `prepaid` | `paid`

### RLS
All tables: `auth.role() = 'authenticated'` — single-user blanket policy.

### Auto-complete cron
A `pg_cron` job is designed (but must be manually run in Supabase SQL editor) to auto-complete scheduled appointments at **23:59 IST (18:29 UTC)** daily:
```sql
UPDATE appointments SET status = 'completed'
WHERE status = 'scheduled'
  AND (date::text || ' ' || time::text)::timestamp
      < (NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp
```

---

## 4. Architecture

### Request Flow

```
Request
  → middleware.ts (auth check → redirect if unauthenticated)
  → Root layout (Sidebar + BottomNav)
  → page.tsx (Server Component: fetch data via createServerClient)
  → *-view.tsx / *-list.tsx / *-form.tsx (Client Component: interactivity)
  → mutation (supabase.from(...).insert/update/delete via createBrowserClient)
  → router.refresh() (re-runs Server Component, fresh data)
```

### Key Patterns

| Pattern | Explanation |
|---|---|
| Server-first data fetching | Pages fetch all needed data server-side; no loading spinners on initial render |
| `router.refresh()` after mutations | Avoids a client-side state sync layer — server re-fetches truth |
| Denormalized `payment_status` | `appointments.payment_status` is kept in sync when payments are recorded, avoiding joins on the schedule view |
| Client-side search | Patient and appointment search is filtered client-side from the already-fetched full list |

---

## 5. Navigation

### Desktop (Sidebar)
Dashboard · Patients · Schedule · Billing · Settings

### Mobile (Bottom Nav)
Same 5 tabs using Lucide icons, `hidden md:flex` / `flex md:hidden` responsive classes.

---

## 6. PWA

- `public/manifest.json` — app name, icons, theme color
- `public/sw.js` — service worker
- Service worker registered in root `layout.tsx` via inline script

---

## 7. Logging

`src/lib/logger.ts` — structured logger tagging all output with `[CareBook]`. Used server-side in middleware and server actions for Vercel log drain compatibility.

---

## 8. Currencies & Localisation

- All monetary values: **INR (₹)**
- Timezone: **IST (Asia/Kolkata)**
- Date utilities: `date-fns` + `date-fns-tz`

---

## 9. What's Not Yet Built

| Feature | Notes |
|---|---|
| pg_cron auto-complete | SQL written, must be manually executed in Supabase dashboard |
| Patient reports / export | No PDF or CSV export |
| Notifications / reminders | No SMS or push notification for appointments |
| Multi-user / staff roles | Single-user only |
| Invoice generation | No printable invoice per payment |
| Treatment plan sessions tracking | `planned_sessions` stored but not cross-referenced with actual appointments |
