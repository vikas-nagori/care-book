# Payment–Appointment Link Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Link payments to specific appointment sessions, add per-session fees to appointments, add a global settings page for default rates, and auto-complete appointments at end of day via Supabase cron.

**Architecture:** Add `fee` + `payment_status` columns to `appointments`, a new `appointment_payments` junction table for audit trail, and a `global_settings` table for default rates. Payment form gets prepaid/postpaid session-linking logic. A pg_cron job auto-completes unclosed appointments at 23:59 IST daily.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Postgres, pg_cron) · shadcn/ui · Tailwind CSS · IST timezone (`Asia/Kolkata`)

---

## Task 1: Database migrations

**Files:**
- Create: `supabase/migrations/001_payment_appointment_link.sql`

**Step 1: Create the migration file**

```sql
-- supabase/migrations/001_payment_appointment_link.sql

-- 1. Global settings table (single row, id always = 1)
CREATE TABLE global_settings (
  id            integer PRIMARY KEY DEFAULT 1,
  home_visit_fee numeric(10,2) NOT NULL DEFAULT 0,
  clinic_fee     numeric(10,2) NOT NULL DEFAULT 0,
  CHECK (id = 1)
);
INSERT INTO global_settings DEFAULT VALUES;

-- RLS
ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users can read/write global_settings"
  ON global_settings FOR ALL
  USING (auth.role() = 'authenticated');

-- 2. Add fee + payment_status to appointments
ALTER TABLE appointments
  ADD COLUMN fee            numeric(10,2),
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'prepaid', 'paid'));

-- 3. Appointment payments junction table
CREATE TABLE appointment_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, appointment_id)
);

ALTER TABLE appointment_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users can read/write appointment_payments"
  ON appointment_payments FOR ALL
  USING (auth.role() = 'authenticated');

-- Index for fast lookups
CREATE INDEX idx_appointment_payments_payment_id ON appointment_payments(payment_id);
CREATE INDEX idx_appointment_payments_appointment_id ON appointment_payments(appointment_id);
CREATE INDEX idx_appointments_payment_status ON appointments(payment_status);

-- 4. pg_cron: auto-complete appointments at 23:59 IST (18:29 UTC) daily
-- Run this manually in Supabase SQL editor if pg_cron is enabled:
-- SELECT cron.schedule(
--   'auto-complete-appointments',
--   '29 18 * * *',
--   $$
--     UPDATE appointments
--     SET status = 'completed'
--     WHERE status = 'scheduled'
--       AND (date::text || ' ' || SPLIT_PART(time::text, '+', 1))::timestamp
--           < (NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp
--   $$
-- );
```

**Step 2: Run migration in Supabase**

Option A — Supabase CLI:
```bash
supabase db push
```

Option B — Supabase Dashboard:
- Go to SQL Editor → paste the file contents → Run
- Note: Run the cron.schedule() block separately after confirming pg_cron extension is enabled (Database → Extensions → pg_cron)

**Step 3: Commit**

```bash
git add supabase/migrations/001_payment_appointment_link.sql
git commit -m "feat: add migration for fee, payment_status, appointment_payments, global_settings"
```

---

## Task 2: Update TypeScript types

**Files:**
- Modify: `src/lib/supabase/types.ts`

**Step 1: Add new types and extend Appointment**

Replace the contents of `src/lib/supabase/types.ts`:

```typescript
export type Patient = {
  id: string
  name: string
  phone: string
  email: string | null
  dob: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type Appointment = {
  id: string
  patient_id: string
  date: string
  time: string
  duration_minutes: number
  type: 'home_visit' | 'clinic'
  status: 'scheduled' | 'completed' | 'cancelled'
  payment_status: 'unpaid' | 'prepaid' | 'paid'
  fee: number | null
  notes: string | null
  created_at: string
  patient?: Patient
}

export type TreatmentPlan = {
  id: string
  patient_id: string
  diagnosis: string
  goals: string | null
  start_date: string
  expected_end_date: string | null
  status: 'active' | 'completed' | 'discontinued'
  created_at: string
}

export type SessionNote = {
  id: string
  appointment_id: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  exercises_prescribed: string | null
  created_at: string
  appointment?: Appointment
}

export type Package = {
  id: string
  patient_id: string
  name: string
  total_sessions: number
  used_sessions: number
  total_amount: number
  paid_amount: number
  payment_timing: 'prepaid' | 'postpaid'
  status: 'active' | 'completed' | 'cancelled'
  created_at: string
}

export type Payment = {
  id: string
  patient_id: string
  package_id: string | null
  appointment_id: string | null
  amount: number
  payment_method: string
  date: string
  notes: string | null
  created_at: string
}

export type GlobalSettings = {
  id: number
  home_visit_fee: number
  clinic_fee: number
}

export type AppointmentPayment = {
  id: string
  payment_id: string
  appointment_id: string
  created_at: string
}
```

**Step 2: Verify build still compiles**

```bash
npm run build 2>&1 | head -50
```

Expected: build succeeds or only shows errors related to missing `fee`/`payment_status` usage (will fix in subsequent tasks).

**Step 3: Commit**

```bash
git add src/lib/supabase/types.ts
git commit -m "feat: add GlobalSettings, AppointmentPayment types; extend Appointment with fee and payment_status"
```

---

## Task 3: Global Settings page

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/app/settings/settings-form.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/bottom-nav.tsx`

**Step 1: Create server component page**

`src/app/settings/page.tsx`:
```typescript
import { createClient } from '@/lib/supabase/server'
import { SettingsForm } from './settings-form'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: settings } = await supabase
    .from('global_settings')
    .select('*')
    .single()

  return (
    <div className="p-4 md:p-6 max-w-md">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <SettingsForm settings={settings} />
    </div>
  )
}
```

**Step 2: Create client component form**

`src/app/settings/settings-form.tsx`:
```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import type { GlobalSettings } from '@/lib/supabase/types'

interface Props {
  settings: GlobalSettings | null
}

export function SettingsForm({ settings }: Props) {
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const data = {
      id: 1,
      home_visit_fee: parseFloat(formData.get('home_visit_fee') as string) || 0,
      clinic_fee: parseFloat(formData.get('clinic_fee') as string) || 0,
    }

    const { error } = await supabase
      .from('global_settings')
      .upsert(data, { onConflict: 'id' })

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    } else {
      toast({ title: 'Settings saved' })
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session Fees</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clinic_fee">Clinic Visit Fee (₹)</Label>
            <Input
              id="clinic_fee"
              name="clinic_fee"
              type="number"
              min="0"
              step="0.01"
              defaultValue={settings?.clinic_fee ?? 0}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="home_visit_fee">Home Visit Fee (₹)</Label>
            <Input
              id="home_visit_fee"
              name="home_visit_fee"
              type="number"
              min="0"
              step="0.01"
              defaultValue={settings?.home_visit_fee ?? 0}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Saving...' : 'Save Settings'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

**Step 3: Add Settings to sidebar**

In `src/components/layout/sidebar.tsx`, add import and nav item:

```typescript
import { LayoutDashboard, Users, CalendarDays, Receipt, Settings } from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/billing', label: 'Billing', icon: Receipt },
  { href: '/settings', label: 'Settings', icon: Settings },
]
```

**Step 4: Check bottom-nav.tsx and add Settings if it follows same pattern**

Read `src/components/layout/bottom-nav.tsx` and add Settings link there too if the nav items are hardcoded the same way. Settings icon: `Settings` from lucide-react.

**Step 5: Verify page loads**

```bash
npm run dev
```

Navigate to http://localhost:3000/settings — should show the form with two fee fields.

**Step 6: Commit**

```bash
git add src/app/settings/ src/components/layout/sidebar.tsx src/components/layout/bottom-nav.tsx
git commit -m "feat: add global settings page for session fees"
```

---

## Task 4: Add fee field to appointment booking

**Files:**
- Modify: `src/app/schedule/appointment-form.tsx`

**Step 1: Update AppointmentForm to fetch global settings and auto-fill fee**

Replace `src/app/schedule/appointment-form.tsx` with:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { Appointment, GlobalSettings } from '@/lib/supabase/types'

interface AppointmentFormProps {
  patients: { id: string; name: string }[]
  defaultDate?: string
  defaultPatientId?: string
  appointment?: Appointment
  onSuccess?: () => void
}

export function AppointmentForm({ patients, defaultDate, defaultPatientId, appointment, onSuccess }: AppointmentFormProps) {
  const supabase = createClient()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<GlobalSettings | null>(null)
  const [appointmentType, setAppointmentType] = useState<string>(appointment?.type || 'clinic')
  const [fee, setFee] = useState<string>(appointment?.fee?.toString() || '')

  // Load global settings once on mount
  useEffect(() => {
    supabase.from('global_settings').select('*').single().then(({ data }) => {
      if (data) {
        setSettings(data)
        // Only auto-fill if fee not already set (i.e., new appointment)
        if (!appointment?.fee) {
          setFee(appointmentType === 'home_visit'
            ? String(data.home_visit_fee)
            : String(data.clinic_fee)
          )
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update fee when type changes (only for new appointments)
  function handleTypeChange(value: string) {
    setAppointmentType(value)
    if (!appointment && settings) {
      setFee(value === 'home_visit'
        ? String(settings.home_visit_fee)
        : String(settings.clinic_fee)
      )
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const data = {
      patient_id: formData.get('patient_id') as string,
      date: formData.get('date') as string,
      time: formData.get('time') as string,
      duration_minutes: parseInt(formData.get('duration_minutes') as string) || 45,
      type: formData.get('type') as string,
      status: (formData.get('status') as string) || 'scheduled',
      fee: parseFloat(formData.get('fee') as string) || null,
      notes: (formData.get('notes') as string) || null,
    }

    let error
    if (appointment) {
      ({ error } = await supabase.from('appointments').update(data).eq('id', appointment.id))
    } else {
      ({ error } = await supabase.from('appointments').insert(data))
    }

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
      setLoading(false)
    } else {
      toast({ title: appointment ? 'Appointment updated' : 'Appointment booked' })
      onSuccess?.()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="patient_id">Patient *</Label>
        <Select name="patient_id" defaultValue={defaultPatientId || appointment?.patient_id || ''} required>
          <SelectTrigger>
            <SelectValue placeholder="Select patient" />
          </SelectTrigger>
          <SelectContent>
            {patients.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="date">Date *</Label>
          <Input id="date" name="date" type="date" defaultValue={defaultDate || appointment?.date || ''} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="time">Time *</Label>
          <Input id="time" name="time" type="time" defaultValue={appointment?.time?.slice(0, 5) || '09:00'} required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="duration_minutes">Duration (min)</Label>
          <Input id="duration_minutes" name="duration_minutes" type="number" defaultValue={appointment?.duration_minutes || 45} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <Select name="type" defaultValue={appointmentType} onValueChange={handleTypeChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="clinic">Clinic</SelectItem>
              <SelectItem value="home_visit">Home Visit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fee">Session Fee (₹)</Label>
        <Input
          id="fee"
          name="fee"
          type="number"
          min="0"
          step="0.01"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder="Auto-filled from settings"
        />
      </div>

      {appointment && (
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select name="status" defaultValue={appointment.status}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={appointment?.notes ?? ''} />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Saving...' : (appointment ? 'Update' : 'Book Appointment')}
      </Button>
    </form>
  )
}
```

**Step 2: Verify dev server**

```bash
npm run dev
```

Open http://localhost:3000/schedule/new — should show Session Fee field, auto-filled when you change type between Clinic and Home Visit.

**Step 3: Commit**

```bash
git add src/app/schedule/appointment-form.tsx
git commit -m "feat: add per-session fee field to appointment form with auto-fill from global settings"
```

---

## Task 5: Rewrite payment form with session linking

**Files:**
- Modify: `src/app/billing/payment-form.tsx`
- Modify: `src/app/billing/page.tsx` (pass appointments to PaymentForm)

**Step 1: Update billing page to fetch appointments**

In `src/app/billing/page.tsx`, add appointment fetch and pass to BillingView:

```typescript
import { createClient } from '@/lib/supabase/server'
import { BillingView } from './billing-view'

export default async function BillingPage() {
  const supabase = await createClient()

  const [
    { data: packages },
    { data: payments },
    { data: patients },
    { data: appointments },
  ] = await Promise.all([
    supabase.from('packages').select('*, patient:patients(id, name)').order('created_at', { ascending: false }),
    supabase.from('payments').select('*, patient:patients(id, name)').order('date', { ascending: false }),
    supabase.from('patients').select('id, name').order('name'),
    supabase.from('appointments')
      .select('id, patient_id, date, time, status, payment_status, fee, type')
      .in('status', ['completed', 'scheduled'])
      .order('date', { ascending: true }),
  ])

  return (
    <BillingView
      packages={packages || []}
      payments={payments || []}
      patients={patients || []}
      appointments={appointments || []}
    />
  )
}
```

**Step 2: Update BillingView to pass appointments to PaymentForm**

In `src/app/billing/billing-view.tsx`, update the Props interface and Dialog usage to pass `appointments` down to `PaymentForm`. Find where `<PaymentForm` is rendered (inside the Dialog) and add the `appointments` prop:

```typescript
// Add to Props interface:
appointments: Pick<Appointment, 'id' | 'patient_id' | 'date' | 'time' | 'status' | 'payment_status' | 'fee' | 'type'>[]

// Update PaymentForm usage:
<PaymentForm
  patients={patients}
  packages={packages}
  appointments={appointments}
  onSuccess={() => { setPaymentOpen(false); router.refresh() }}
/>
```

Also add `import type { Appointment } from '@/lib/supabase/types'` to billing-view.tsx.

**Step 3: Rewrite payment-form.tsx**

Replace `src/app/billing/payment-form.tsx`:

```typescript
'use client'

import { useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import type { Package, Appointment } from '@/lib/supabase/types'

type AppointmentSlim = Pick<Appointment, 'id' | 'patient_id' | 'date' | 'time' | 'status' | 'payment_status' | 'fee' | 'type'>

interface Props {
  patients: { id: string; name: string }[]
  packages: (Package & { patient: { id: string; name: string } | null })[]
  appointments: AppointmentSlim[]
  onSuccess?: () => void
}

const IST = 'Asia/Kolkata'

function getTodayIST() {
  return formatInTimeZone(new Date(), IST, 'yyyy-MM-dd')
}

export function PaymentForm({ patients, packages, appointments, onSuccess }: Props) {
  const supabase = createClient()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState('')
  const [paymentTiming, setPaymentTiming] = useState<'prepaid' | 'postpaid'>('postpaid')
  const [amount, setAmount] = useState('')

  const selectedPatientName = patients.find(p => p.id === selectedPatient)?.name

  // Appointments for this patient eligible for linking
  const todayIST = getTodayIST()

  const postpaidCandidates = useMemo(() =>
    appointments.filter(a =>
      a.patient_id === selectedPatient &&
      a.status === 'completed' &&
      a.payment_status === 'unpaid'
    ).sort((a, b) => a.date.localeCompare(b.date)),
    [appointments, selectedPatient]
  )

  const prepaidCandidates = useMemo(() =>
    appointments.filter(a =>
      a.patient_id === selectedPatient &&
      a.status === 'scheduled' &&
      a.payment_status === 'unpaid' &&
      a.date >= todayIST
    ).sort((a, b) => a.date.localeCompare(b.date)),
    [appointments, selectedPatient, todayIST]
  )

  const candidates = paymentTiming === 'postpaid' ? postpaidCandidates : prepaidCandidates

  // Calculate how many sessions the amount covers
  const sessionsToCover = useMemo(() => {
    const amt = parseFloat(amount)
    if (!amt || candidates.length === 0) return []
    // Use the fee of the first candidate as the per-session rate, fallback to 1 to avoid divide-by-zero
    const feePerSession = candidates[0]?.fee || 1
    const n = Math.min(Math.floor(amt / feePerSession), candidates.length)
    return candidates.slice(0, n)
  }, [amount, candidates])

  const patientPackages = packages.filter(p => p.patient_id === selectedPatient && p.status === 'active')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedPatient) return
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const packageId = formData.get('package_id') as string
    const amt = parseFloat(formData.get('amount') as string)

    // 1. Insert payment
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        patient_id: selectedPatient,
        package_id: packageId || null,
        amount: amt,
        payment_method: formData.get('payment_method') as string,
        date: formData.get('date') as string,
        notes: (formData.get('notes') as string) || null,
      })
      .select('id')
      .single()

    if (paymentError || !payment) {
      toast({ title: 'Error', description: paymentError?.message, variant: 'destructive' })
      setLoading(false)
      return
    }

    // 2. Link sessions + update their payment_status
    if (sessionsToCover.length > 0) {
      const junctionRows = sessionsToCover.map(a => ({
        payment_id: payment.id,
        appointment_id: a.id,
      }))

      const { error: junctionError } = await supabase
        .from('appointment_payments')
        .insert(junctionRows)

      if (junctionError) {
        toast({ title: 'Warning', description: 'Payment saved but session linking failed: ' + junctionError.message, variant: 'destructive' })
        setLoading(false)
        return
      }

      const newStatus = paymentTiming === 'postpaid' ? 'paid' : 'prepaid'
      await supabase
        .from('appointments')
        .update({ payment_status: newStatus })
        .in('id', sessionsToCover.map(a => a.id))
    }

    // 3. Update package paid_amount if linked
    if (packageId) {
      const pkg = packages.find(p => p.id === packageId)
      if (pkg) {
        await supabase.from('packages').update({
          paid_amount: Number(pkg.paid_amount) + amt,
        }).eq('id', packageId)
      }
    }

    toast({ title: 'Payment recorded', description: sessionsToCover.length > 0 ? `Linked to ${sessionsToCover.length} session(s)` : undefined })
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Patient */}
      <div className="space-y-2">
        <Label>Patient *</Label>
        <Select name="patient_id" required onValueChange={setSelectedPatient}>
          <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
          <SelectContent>
            {patients.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {selectedPatientName && (
          <p className="text-sm font-medium text-primary">Patient: {selectedPatientName}</p>
        )}
      </div>

      {/* Payment timing */}
      {selectedPatient && (
        <div className="space-y-2">
          <Label>Payment Type</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={paymentTiming === 'postpaid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPaymentTiming('postpaid')}
            >
              Postpaid
            </Button>
            <Button
              type="button"
              variant={paymentTiming === 'prepaid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPaymentTiming('prepaid')}
            >
              Prepaid
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {paymentTiming === 'postpaid'
              ? `${postpaidCandidates.length} completed unpaid session(s) available`
              : `${prepaidCandidates.length} upcoming unpaid session(s) available`
            }
          </p>
        </div>
      )}

      {/* Amount + Date */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Amount (₹) *</Label>
          <Input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Date *</Label>
          <Input name="date" type="date" defaultValue={format(new Date(), 'yyyy-MM-dd')} required />
        </div>
      </div>

      {/* Session preview */}
      {selectedPatient && amount && parseFloat(amount) > 0 && sessionsToCover.length > 0 && (
        <div className="rounded-md border p-3 space-y-1 bg-muted/40">
          <p className="text-sm font-medium">
            {paymentTiming === 'postpaid'
              ? `Marking ${sessionsToCover.length} session(s) as paid:`
              : `Prepaying ${sessionsToCover.length} upcoming session(s):`
            }
          </p>
          {sessionsToCover.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="text-xs">{a.type === 'home_visit' ? 'Home' : 'Clinic'}</Badge>
              <span>{format(parseISO(a.date), 'dd MMM yyyy')}</span>
              {a.fee && <span className="ml-auto">₹{Number(a.fee).toLocaleString()}</span>}
            </div>
          ))}
        </div>
      )}

      {selectedPatient && amount && parseFloat(amount) > 0 && candidates.length > 0 && sessionsToCover.length === 0 && (
        <p className="text-sm text-muted-foreground">Amount is less than one session fee — no sessions will be linked.</p>
      )}

      {/* Optional package */}
      {patientPackages.length > 0 && (
        <div className="space-y-2">
          <Label>Link to Package (optional)</Label>
          <Select name="package_id">
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              {patientPackages.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} (₹{Number(p.paid_amount).toLocaleString()}/₹{Number(p.total_amount).toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Payment method */}
      <div className="space-y-2">
        <Label>Payment Method *</Label>
        <Select name="payment_method" defaultValue="cash" required>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="upi">UPI</SelectItem>
            <SelectItem value="card">Card</SelectItem>
            <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea name="notes" rows={2} />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Recording...' : 'Record Payment'}
      </Button>
    </form>
  )
}
```

**Step 4: Install date-fns-tz if not present**

```bash
npm list date-fns-tz 2>/dev/null || npm install date-fns-tz
```

**Step 5: Verify dev server**

```bash
npm run dev
```

Open http://localhost:3000/billing → Record Payment → select a patient. Should show postpaid/prepaid toggle and session preview when amount is entered.

**Step 6: Commit**

```bash
git add src/app/billing/payment-form.tsx src/app/billing/page.tsx src/app/billing/billing-view.tsx
git commit -m "feat: rewrite payment form with prepaid/postpaid session linking"
```

---

## Task 6: Show payment_status badge on appointment views

**Files:**
- Modify: `src/app/schedule/schedule-view.tsx`
- Possibly: `src/app/schedule/[id]/appointment-detail.tsx`

**Step 1: Read the files**

Read `src/app/schedule/schedule-view.tsx` and `src/app/schedule/[id]/appointment-detail.tsx` to understand current structure.

**Step 2: Add payment_status badge**

In `schedule-view.tsx`, wherever appointments are rendered (each appointment card/row), add a Badge after the existing status badge:

```typescript
import { Badge } from '@/components/ui/badge'

// Inside the appointment render:
{appt.payment_status === 'paid' && <Badge className="bg-green-100 text-green-800 text-xs">Paid</Badge>}
{appt.payment_status === 'prepaid' && <Badge className="bg-blue-100 text-blue-800 text-xs">Prepaid</Badge>}
{appt.payment_status === 'unpaid' && <Badge variant="outline" className="text-xs">Unpaid</Badge>}
```

**Step 3: Update schedule page query to include new columns**

In `src/app/schedule/page.tsx`, ensure the appointments select includes `payment_status` and `fee`. Add them to the select string if they are not already present.

**Step 4: Verify visually**

```bash
npm run dev
```

Go to http://localhost:3000/schedule — each appointment should show a payment status badge.

**Step 5: Commit**

```bash
git add src/app/schedule/schedule-view.tsx src/app/schedule/page.tsx
git commit -m "feat: show payment_status badge on appointment cards"
```

---

## Task 7: Enable pg_cron auto-complete in Supabase

**Step 1: Enable pg_cron extension**

In Supabase Dashboard:
- Go to Database → Extensions → search "pg_cron" → Enable it

**Step 2: Schedule the job**

In Supabase SQL Editor, run:

```sql
SELECT cron.schedule(
  'auto-complete-appointments',
  '29 18 * * *',
  $$
    UPDATE appointments
    SET status = 'completed'
    WHERE status = 'scheduled'
      AND (date::text || ' ' || SPLIT_PART(time::text, '+', 1))::timestamp
          < (NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp
  $$
);
```

**Step 3: Verify the job is registered**

```sql
SELECT * FROM cron.job;
```

Expected: row with jobname = `auto-complete-appointments`, schedule = `29 18 * * *`.

**Step 4: Test manually (optional)**

To test without waiting for cron:
```sql
UPDATE appointments
SET status = 'completed'
WHERE status = 'scheduled'
  AND (date::text || ' ' || SPLIT_PART(time::text, '+', 1))::timestamp
      < (NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp;
```

Check affected rows — these should be past-date appointments that were still `scheduled`.

**Step 5: Document in migration file**

Add a comment in `supabase/migrations/001_payment_appointment_link.sql` noting the cron job must be run manually in SQL Editor (it cannot be scripted through migration files without pg_cron already enabled).

**Step 6: Commit**

```bash
git add supabase/migrations/001_payment_appointment_link.sql
git commit -m "docs: note pg_cron job setup in migration file"
```

---

## Task 8: Final build check

**Step 1: Run lint**

```bash
npm run lint
```

Fix any errors reported.

**Step 2: Run production build**

```bash
npm run build
```

Expected: build succeeds with no TypeScript or compilation errors.

**Step 3: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "fix: lint and type errors from payment-appointment feature"
```

---

## Verification Checklist

- [ ] `/settings` — can set clinic fee and home visit fee, saves successfully
- [ ] `/schedule/new` — fee field shows, auto-fills based on type, changes when type changes
- [ ] `/billing` → Record Payment → select patient → toggle postpaid/prepaid → enter amount → session preview shows correct sessions
- [ ] Record a postpaid payment → appointments appear as "Paid" on schedule page
- [ ] Record a prepaid payment → upcoming appointments appear as "Prepaid" on schedule page
- [ ] pg_cron job registered: `SELECT * FROM cron.job` shows the row
- [ ] Past scheduled appointments auto-complete at 23:59 IST (verify next morning or test with manual SQL)
- [ ] `npm run build` passes clean
