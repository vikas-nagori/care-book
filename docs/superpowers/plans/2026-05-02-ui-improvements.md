# UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add loading spinners to all interactions, switch dashboard revenue stat to monthly, and add a calendar date-picker to the schedule page.

**Architecture:** Shared `LoadingSpinner` component powers Next.js `loading.tsx` files for route transitions; `Loader2` from lucide-react is added inline to form submit buttons and inline action buttons; the schedule's client component gets a `Popover`+`Calendar` date-jump; dashboard revenue query switches from week to month bounds.

**Tech Stack:** Next.js 14 App Router · lucide-react (`Loader2`, `CalendarIcon`) · shadcn/ui `Popover` + `Calendar` (already installed) · date-fns (`startOfMonth`, `endOfMonth`)

---

## File Map

**Create:**
- `src/components/ui/loading-spinner.tsx` — shared centered spinner + label
- `src/app/loading.tsx`
- `src/app/schedule/loading.tsx`
- `src/app/patients/loading.tsx`
- `src/app/patients/[id]/loading.tsx`
- `src/app/billing/loading.tsx`
- `src/app/settings/loading.tsx`

**Modify:**
- `src/app/page.tsx` — month revenue query + label
- `src/app/schedule/schedule-view.tsx` — calendar popup (desktop + mobile)
- `src/app/schedule/appointment-form.tsx` — Loader2 on submit
- `src/app/patients/patient-form.tsx` — Loader2 on submit
- `src/app/billing/package-form.tsx` — Loader2 on submit
- `src/app/billing/payment-form.tsx` — Loader2 on submit
- `src/app/billing/billing-entry-form.tsx` — Loader2 on submit
- `src/app/settings/settings-form.tsx` — Loader2 on submit
- `src/app/settings/invite-form.tsx` — Loader2 on submit
- `src/app/auth/complete-invite/complete-invite-form.tsx` — Loader2 on submit
- `src/app/patients/[id]/treatment-plan-form.tsx` — Loader2 on submit
- `src/app/schedule/[id]/session-note-form.tsx` — Loader2 on submit
- `src/app/schedule/[id]/appointment-detail.tsx` — Loader2 on inline status update

---

## Task 1: Create shared LoadingSpinner component

**Files:**
- Create: `src/components/ui/loading-spinner.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/ui/loading-spinner.tsx
import { Loader2 } from 'lucide-react'

export function LoadingSpinner() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: 200,
        width: '100%',
      }}
    >
      <Loader2
        className="animate-spin"
        size={28}
        style={{ color: 'var(--ph-accent)' }}
      />
      <span style={{ fontSize: 12.5, color: 'var(--ph-ink-4)' }}>Loading…</span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/loading-spinner.tsx
git commit -m "feat: add shared LoadingSpinner component"
```

---

## Task 2: Add loading.tsx files for all route segments

**Files:**
- Create: `src/app/loading.tsx`
- Create: `src/app/schedule/loading.tsx`
- Create: `src/app/patients/loading.tsx`
- Create: `src/app/patients/[id]/loading.tsx`
- Create: `src/app/billing/loading.tsx`
- Create: `src/app/settings/loading.tsx`

All six files are identical — they re-export `LoadingSpinner` as the default Next.js loading UI.

- [ ] **Step 1: Create `src/app/loading.tsx`**

```tsx
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export default function Loading() {
  return <LoadingSpinner />
}
```

- [ ] **Step 2: Create `src/app/schedule/loading.tsx`** (same content)

```tsx
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export default function Loading() {
  return <LoadingSpinner />
}
```

- [ ] **Step 3: Create `src/app/patients/loading.tsx`** (same content)

```tsx
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export default function Loading() {
  return <LoadingSpinner />
}
```

- [ ] **Step 4: Create `src/app/patients/[id]/loading.tsx`** (same content)

```tsx
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export default function Loading() {
  return <LoadingSpinner />
}
```

- [ ] **Step 5: Create `src/app/billing/loading.tsx`** (same content)

```tsx
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export default function Loading() {
  return <LoadingSpinner />
}
```

- [ ] **Step 6: Create `src/app/settings/loading.tsx`** (same content)

```tsx
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export default function Loading() {
  return <LoadingSpinner />
}
```

- [ ] **Step 7: Verify in dev server**

Run `npm run dev`. Click between sidebar links (Dashboard → Schedule → Patients → Billing → Settings). Each navigation should briefly show the spinner+label centered in the main content area while the server component fetches. The sidebar and bottom nav stay visible throughout.

- [ ] **Step 8: Commit**

```bash
git add src/app/loading.tsx src/app/schedule/loading.tsx src/app/patients/loading.tsx \
  "src/app/patients/[id]/loading.tsx" src/app/billing/loading.tsx src/app/settings/loading.tsx
git commit -m "feat: add route-level loading spinners for all page segments"
```

---

## Task 3: Add Loader2 spinner to form submit buttons

**Files:** 10 form files — all follow the same pattern:
1. Add `Loader2` to the lucide-react import line
2. Replace `{loading ? 'Text...' : 'Normal text'}` with the spinner+text version

- [ ] **Step 1: Update `src/app/schedule/appointment-form.tsx`**

Change import (line 4):
```tsx
// Before
import { Check, Plus, Search } from 'lucide-react'
// After
import { Check, Loader2, Plus, Search } from 'lucide-react'
```

Change button content (line 492):
```tsx
// Before
{loading ? 'Saving...' : (appointment ? 'Update' : 'Book Appointment')}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Saving…</>
) : (appointment ? 'Update' : 'Book Appointment')}
```

- [ ] **Step 2: Update `src/app/patients/patient-form.tsx`**

Find the lucide-react import and add `Loader2`. Then change button content (line 112):
```tsx
// Before
{loading ? 'Saving...' : (patient ? 'Update Patient' : 'Add Patient')}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Saving…</>
) : (patient ? 'Update Patient' : 'Add Patient')}
```

- [ ] **Step 3: Update `src/app/billing/package-form.tsx`**

Add `Loader2` to lucide-react import. Change button content (line 82):
```tsx
// Before
{loading ? 'Creating...' : 'Create Package'}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Creating…</>
) : 'Create Package'}
```

- [ ] **Step 4: Update `src/app/billing/payment-form.tsx`**

Add `Loader2` to lucide-react import. Change button content (line 245):
```tsx
// Before
{loading ? 'Recording...' : 'Record Payment'}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Recording…</>
) : 'Record Payment'}
```

- [ ] **Step 5: Update `src/app/billing/billing-entry-form.tsx`**

Add `Loader2` to lucide-react import. Change button content (line 353):
```tsx
// Before
{loading ? 'Saving...' : 'Save Billing Entry'}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Saving…</>
) : 'Save Billing Entry'}
```

- [ ] **Step 6: Update `src/app/settings/settings-form.tsx`**

Add `Loader2` to lucide-react import. Change button content (line 73):
```tsx
// Before
{loading ? 'Saving...' : 'Save Settings'}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Saving…</>
) : 'Save Settings'}
```

- [ ] **Step 7: Update `src/app/settings/invite-form.tsx`**

Add `Loader2` to lucide-react import. Change button content (line 95):
```tsx
// Before
{loading ? 'Sending invite...' : 'Send Invite'}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Sending invite…</>
) : 'Send Invite'}
```

- [ ] **Step 8: Update `src/app/auth/complete-invite/complete-invite-form.tsx`**

Add `Loader2` to lucide-react import. Change button content (line 200):
```tsx
// Before
{loading ? 'Saving account...' : 'Finish Sign-Up'}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Saving account…</>
) : 'Finish Sign-Up'}
```

- [ ] **Step 9: Update `src/app/patients/[id]/treatment-plan-form.tsx`**

Add `Loader2` to lucide-react import. Change button content (line 89):
```tsx
// Before
{loading ? 'Saving...' : (plan ? 'Update Plan' : 'Create Plan')}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Saving…</>
) : (plan ? 'Update Plan' : 'Create Plan')}
```

- [ ] **Step 10: Update `src/app/schedule/[id]/session-note-form.tsx`**

Add `Loader2` to lucide-react import. Change button content (line 75):
```tsx
// Before
{loading ? 'Saving...' : 'Save Notes'}
// After
{loading ? (
  <><Loader2 className="animate-spin" size={14} /> Saving…</>
) : 'Save Notes'}
```

- [ ] **Step 11: Commit**

```bash
git add \
  src/app/schedule/appointment-form.tsx \
  src/app/patients/patient-form.tsx \
  src/app/billing/package-form.tsx \
  src/app/billing/payment-form.tsx \
  src/app/billing/billing-entry-form.tsx \
  src/app/settings/settings-form.tsx \
  src/app/settings/invite-form.tsx \
  src/app/auth/complete-invite/complete-invite-form.tsx \
  "src/app/patients/[id]/treatment-plan-form.tsx" \
  "src/app/schedule/[id]/session-note-form.tsx"
git commit -m "feat: add Loader2 spinner to all form submit buttons"
```

---

## Task 4: Add spinner to inline status action in appointment-detail

**Files:**
- Modify: `src/app/schedule/[id]/appointment-detail.tsx`

The `updateStatus` function is fired from a `<Select onValueChange>`. Add a `statusPending` boolean that disables the select and shows a spinner while the Supabase call is in flight.

- [ ] **Step 1: Add Loader2 to imports**

```tsx
// Before (line 6)
import { ArrowLeft, Edit, FileText, User } from 'lucide-react'
// After
import { ArrowLeft, Edit, FileText, Loader2, User } from 'lucide-react'
```

- [ ] **Step 2: Add statusPending state and update updateStatus**

After line 30 (`const [noteOpen, setNoteOpen] = useState(false)`), add:
```tsx
const [statusPending, setStatusPending] = useState(false)
```

Replace the `updateStatus` function (lines 33–45):
```tsx
async function updateStatus(status: string) {
  setStatusPending(true)
  const { error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointment.id)

  if (error) {
    toast({ title: 'Error', description: error.message, variant: 'destructive' })
  } else {
    toast({ title: 'Status updated' })
    router.refresh()
  }
  setStatusPending(false)
}
```

- [ ] **Step 3: Show spinner next to the Select while pending**

Find the Select usage (around line 72). Wrap it in a div with a flex row so the spinner can appear alongside:
```tsx
// Before
<Select defaultValue={appointment.status} onValueChange={updateStatus}>
// After
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <Select defaultValue={appointment.status} onValueChange={updateStatus} disabled={statusPending}>
    {/* existing SelectContent unchanged */}
  </Select>
  {statusPending && <Loader2 className="animate-spin" size={14} style={{ color: 'var(--ph-accent)', flexShrink: 0 }} />}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/schedule/[id]/appointment-detail.tsx"
git commit -m "feat: add loading spinner to appointment status inline action"
```

---

## Task 5: Switch dashboard revenue stat from weekly to monthly

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update the import line**

```tsx
// Before (line 4)
import { format, startOfWeek, endOfWeek } from 'date-fns'
// After
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
```

- [ ] **Step 2: Add month date variables after line 56**

After:
```tsx
const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
```
Add:
```tsx
const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')
```

- [ ] **Step 3: Change the revenue query to use month bounds**

```tsx
// Before (line 70–72)
const weekRevP = access.canViewBilling
  ? supabase.from('payments').select('amount').gte('date', weekStart).lte('date', weekEnd)
  : Promise.resolve({ data: [], error: null })
// After
const weekRevP = access.canViewBilling
  ? supabase.from('payments').select('amount').gte('date', monthStart).lte('date', monthEnd)
  : Promise.resolve({ data: [], error: null })
```

(Variable name `weekRevP`/`weekPayments`/`weekRevenue` is kept as-is to minimise diff; only the query bounds change.)

- [ ] **Step 4: Update the stat label**

```tsx
// Before (line 150)
<div className="ph-stat-label"><IndianRupee size={13} /><span>Week revenue</span></div>
// After
<div className="ph-stat-label"><IndianRupee size={13} /><span>This month</span></div>
```

- [ ] **Step 5: Verify in browser**

Open `/`. The third stat card should now read "This month" and show the total payments for the current calendar month (higher than the weekly figure for most of the month).

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: show monthly revenue on dashboard instead of weekly"
```

---

## Task 6: Add calendar date-picker popup to schedule

**Files:**
- Modify: `src/app/schedule/schedule-view.tsx`

- [ ] **Step 1: Update imports**

```tsx
// Before (lines 3–10)
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AppointmentForm } from './appointment-form'
import type { Appointment } from '@/lib/supabase/types'
import Link from 'next/link'

// After
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { CalendarIcon, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { AppointmentForm } from './appointment-form'
import type { Appointment } from '@/lib/supabase/types'
import Link from 'next/link'
```

- [ ] **Step 2: Add calendarOpen state**

After line 43 (`const [dialogOpen, setDialogOpen] = useState(false)`), add:
```tsx
const [calendarOpen, setCalendarOpen] = useState(false)
```

- [ ] **Step 3: Add calendar button to desktop nav**

Find the closing ChevronRight button (lines 97–102):
```tsx
          <button
            onClick={() => setSelectedDate((d) => addDays(d, calView === 'day' ? 1 : 7))}
            style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer' }}
          >
            <ChevronRight size={14} />
          </button>
```

Add the calendar popover immediately after it (before the `<div style={{ width: 1... }}` separator):
```tsx
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <button
                style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer' }}
              >
                <CalendarIcon size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) { setSelectedDate(date); setCalendarOpen(false) }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
```

- [ ] **Step 4: Add calendar button for mobile (above date strip)**

Find the date strip section (line 153–154):
```tsx
      {/* Date strip (always visible) */}
      <div className="ph-date-strip mb-4">
```

Insert a mobile-only calendar button row directly above it:
```tsx
      {/* Mobile calendar jump */}
      <div className="flex justify-end mb-2 md:hidden">
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <button
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer', color: 'var(--ph-ink-2)' }}
            >
              <CalendarIcon size={13} />
              Jump to date
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                if (date) { setSelectedDate(date); setCalendarOpen(false) }
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Date strip (always visible) */}
      <div className="ph-date-strip mb-4">
```

- [ ] **Step 5: Verify in browser**

Open `/schedule`. On desktop: click the calendar icon (🗓) after the › button — a month calendar should appear. Click any date — the schedule should jump to that date's week and close the popover. On mobile (resize browser to <768px): a "Jump to date" button should appear above the date strip with the same behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/app/schedule/schedule-view.tsx
git commit -m "feat: add calendar date-picker popup to schedule navigation"
```
