# UI Improvements Design

**Date:** 2026-05-02  
**Scope:** Three independent UI improvements — loading feedback, monthly revenue stat, schedule date picker

---

## 1. Loading Spinners

### Problem
No visual feedback during route transitions or async mutations. The app feels "stuck" due to server-side data fetching latency.

### Solution

**Route transitions** — Next.js App Router `loading.tsx` files per segment. Each renders a shared `LoadingSpinner` component (centered spinner ring + "Loading…" label) while the server component fetches data. The bottom nav and sidebar remain visible during the load.

**Shared component**: `src/components/ui/loading-spinner.tsx`  
- Centered layout, full available height  
- Teal animated ring (`border-t-[--ph-accent]`, `animate-spin`)  
- "Loading…" label in muted text below the ring  

**Route segments needing `loading.tsx`:**
- `src/app/loading.tsx` — dashboard `/`
- `src/app/schedule/loading.tsx`
- `src/app/patients/loading.tsx`
- `src/app/patients/[id]/loading.tsx`
- `src/app/billing/loading.tsx`
- `src/app/settings/loading.tsx`

**Form submit buttons** — Replace bare "Saving..." text with `<Loader2 className="animate-spin" size={14} />` + "Saving…" in all 10 form files when `loading === true`. The button stays disabled. Files:
- `src/app/schedule/appointment-form.tsx`
- `src/app/patients/patient-form.tsx`
- `src/app/billing/package-form.tsx`
- `src/app/billing/payment-form.tsx`
- `src/app/billing/billing-entry-form.tsx`
- `src/app/settings/settings-form.tsx`
- `src/app/settings/invite-form.tsx`
- `src/app/auth/complete-invite/complete-invite-form.tsx`
- `src/app/patients/[id]/treatment-plan-form.tsx`
- `src/app/schedule/[id]/session-note-form.tsx`

**Inline action buttons** — Any button triggering a Supabase mutation (mark appointment complete, delete, status change) gets a local `isPending` boolean. While `isPending` is true: show `<Loader2 className="animate-spin" size={14} />` and disable the button.

### Non-goals
- No top-of-page progress bar
- No per-page skeleton placeholders (spinner only)
- No changes to error states

---

## 2. Monthly Revenue on Dashboard

### Problem
Dashboard shows "Week revenue" but monthly totals are more useful for practice management.

### Solution
In `src/app/page.tsx`:
- Replace `startOfWeek` / `endOfWeek` with `startOfMonth` / `endOfMonth` (both from `date-fns`)
- Rename variables from `weekStart`/`weekEnd`/`weekPayments`/`weekRevenue` → `monthStart`/`monthEnd`/`monthPayments`/`monthRevenue`
- Update the Supabase query date range accordingly
- Change the stat label from "Week revenue" to "This month"
- The `IndianRupee` icon and `Money` component stay unchanged

The "This week appointments" stat (separate query) is unaffected.

---

## 3. Calendar Popup on Schedule

### Problem
Schedule navigation only supports ±1 day / ±7 day jumps. Navigating to a date weeks or months away requires many button presses.

### Solution
Add a calendar icon button to the schedule header that opens a shadcn `Popover` + `Calendar` for direct date selection.

**Components used** (already installed):
- `src/components/ui/popover.tsx`
- `src/components/ui/calendar.tsx`
- `CalendarIcon` from `lucide-react`

**Changes to `src/app/schedule/schedule-view.tsx`:**

State:
```ts
const [calendarOpen, setCalendarOpen] = useState(false)
```

Desktop nav — add after the › button:
```tsx
<Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
  <PopoverTrigger asChild>
    <Button variant="outline" size="icon" className="ph-btn-outline">
      <CalendarIcon size={15} />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-auto p-0" align="end">
    <Calendar
      mode="single"
      selected={selectedDate}
      onSelect={(date) => { if (date) { setSelectedDate(date); setCalendarOpen(false); } }}
      initialFocus
    />
  </PopoverContent>
</Popover>
```

Mobile — add the same `Popover`/`CalendarIcon` button in a row above the date strip (`ph-date-strip`), right-aligned, so mobile users can also jump to any date.

The existing ‹ Today › buttons and the date strip remain unchanged.

---

## Implementation Order

1. `LoadingSpinner` component (shared dependency)
2. `loading.tsx` files (all route segments)
3. Form button spinners (10 files, mechanical)
4. Inline action button spinners
5. Monthly revenue change (isolated, low risk)
6. Calendar popup on schedule
