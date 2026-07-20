'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  calculatePackageTotal,
  getPaymentAllocationPreview,
  sumAppointmentFees,
} from '@/lib/billing/payment-helpers'
import { getBillingModeLabel, type BillingTimelinePackage } from '@/lib/billing/unified-billing'
import { applyPackageTemplate } from '@/lib/billing/package-template'
import type {
  Appointment,
  BillingEntryKind,
  CreateBillingEntryInput,
  PackageTemplate,
} from '@/lib/supabase/types'
import { createBillingEntry } from './actions'

type AppointmentSlim = Pick<Appointment, 'id' | 'patient_id' | 'date' | 'time' | 'status' | 'payment_status' | 'fee' | 'type'>

interface Props {
  patients: { id: string; name: string }[]
  packages: BillingTimelinePackage[]
  packageTemplates?: PackageTemplate[]
  appointments: AppointmentSlim[]
  // Each patient's unspent advance credit, so the preview reflects pooled FIFO allocation.
  patientCredit?: Record<string, number>
  defaultPaymentDate: string
  clinicToday: string
  onSuccess?: () => void
}

function numberFromInput(value: string) {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function integerFromInput(value: string) {
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function Money({ amount }: { amount: number }) {
  return <span>₹{amount.toLocaleString('en-IN')}</span>
}

export function BillingEntryForm({
  patients,
  packageTemplates = [],
  appointments,
  patientCredit,
  defaultPaymentDate,
  clinicToday,
  onSuccess,
}: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState('')
  const [mode, setMode] = useState<BillingEntryKind>('payment_only')
  const [amount, setAmount] = useState('')
  const [packageName, setPackageName] = useState('')
  const [packageSessions, setPackageSessions] = useState('')
  const [packagePerSessionAmount, setPackagePerSessionAmount] = useState('')

  function handleTemplateSelect(templateId: string) {
    const template = packageTemplates.find((t) => t.id === templateId)
    if (!template) return
    const values = applyPackageTemplate(template)
    setPackageName(values.name)
    setPackageSessions(values.sessions)
    setPackagePerSessionAmount(values.perSessionAmount)
    // Prepaid packages collect the full total up front; pre-fill the amount too (editable).
    setAmount(String(calculatePackageTotal(template.min_sessions, template.per_session_amount)))
  }

  const selectedPatientName = patients.find((patient) => patient.id === selectedPatient)?.name
  const paymentAmount = numberFromInput(amount)
  const packageTotalSessions = integerFromInput(packageSessions)
  const packageRate = numberFromInput(packagePerSessionAmount)
  const packageTotal = calculatePackageTotal(packageTotalSessions, packageRate)

  const allocationPreview = useMemo(
    () =>
      getPaymentAllocationPreview({
        appointments,
        patientId: selectedPatient,
        amount: paymentAmount,
        today: clinicToday,
        existingCredit: patientCredit?.[selectedPatient] ?? 0,
      }),
    [appointments, selectedPatient, paymentAmount, clinicToday, patientCredit],
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)

    const formData = new FormData(event.currentTarget)
    const input: CreateBillingEntryInput = {
      patientId: selectedPatient,
      mode,
      paymentAmount,
      paymentMethod: (formData.get('payment_method') as string) || undefined,
      paymentDate: (formData.get('payment_date') as string) || undefined,
      paymentNotes: (formData.get('payment_notes') as string) || null,
    }

    if (mode === 'package_with_payment') {
      input.packageName = packageName
      input.packageTotalSessions = packageTotalSessions
      input.packagePerSessionAmount = packageRate
    }

    const result = await createBillingEntry(input)

    if (!result.success) {
      toast({
        title: 'Billing entry not saved',
        description: result.message,
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    const descriptionParts = []
    if (result.linkedAppointmentIds.length > 0) {
      descriptionParts.push(`Linked ${result.linkedAppointmentIds.length} session(s)`)
    }
    if (result.remainingCredit > 0) {
      descriptionParts.push(`${result.remainingCredit.toLocaleString('en-IN')} advance credit`)
    }

    toast({
      title: mode === 'payment_only' ? 'Payment recorded' : 'Package saved',
      description: descriptionParts.join(' · ') || undefined,
    })
    setLoading(false)
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="billing_patient">Patient *</Label>
        <SearchableSelect
          id="billing_patient"
          options={patients.map((patient) => ({ value: patient.id, label: patient.name }))}
          value={selectedPatient || null}
          onChange={setSelectedPatient}
          placeholder="Select patient"
          searchPlaceholder="Search patient…"
          emptyText="No patients found."
        />
        {selectedPatientName && (
          <p className="text-sm font-medium text-primary">Patient: {selectedPatientName}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Billing Entry Type</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(['payment_only', 'package_with_payment'] as BillingEntryKind[]).map((billingMode) => (
            <Button
              key={billingMode}
              type="button"
              variant={mode === billingMode ? 'default' : 'outline'}
              onClick={() => setMode(billingMode)}
              className="h-auto justify-start py-3 text-left"
            >
              <span className="block">
                <span className="block text-sm font-semibold">{getBillingModeLabel(billingMode)}</span>
                <span className="block text-xs opacity-80">
                  {billingMode === 'payment_only' ? 'Receive money' : 'Create package'}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </div>

      {mode === 'package_with_payment' && (
        <div className="space-y-4 rounded-md border p-4">
          <div>
            <p className="font-medium">Package Details</p>
            <p className="text-sm text-muted-foreground">
              <Money amount={packageTotal} /> total
            </p>
          </div>

          {packageTemplates.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="package_template">Package Template</Label>
              <Select onValueChange={handleTemplateSelect}>
                <SelectTrigger id="package_template">
                  <SelectValue placeholder="Select a template (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {packageTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name} · {template.min_sessions} sessions · ₹{template.per_session_amount.toLocaleString('en-IN')}/session
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Pre-fills the fields below — all still editable.</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="package_name">Package Name *</Label>
            <Input
              id="package_name"
              name="package_name"
              placeholder="e.g. 10 Session Package"
              required
              value={packageName}
              onChange={(event) => setPackageName(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="package_total_sessions">Sessions *</Label>
              <Input
                id="package_total_sessions"
                name="package_total_sessions"
                type="number"
                min="1"
                required
                value={packageSessions}
                onChange={(event) => setPackageSessions(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="package_per_session_amount">Per Session *</Label>
              <Input
                id="package_per_session_amount"
                name="package_per_session_amount"
                type="number"
                min="0"
                step="0.01"
                required
                value={packagePerSessionAmount}
                onChange={(event) => setPackagePerSessionAmount(event.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-md border p-4">
        <div>
          <p className="font-medium">Payment Details</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="payment_amount">Amount Received *</Label>
            <Input
              id="payment_amount"
              name="payment_amount"
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-2 min-w-0 overflow-hidden">
            <Label htmlFor="payment_date">Date *</Label>
            <Input
              id="payment_date"
              name="payment_date"
              type="date"
              required
              defaultValue={defaultPaymentDate}
              className="max-w-full"
            />
          </div>
        </div>

        {selectedPatient && paymentAmount > 0 && (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">Payment Allocation</p>

            {allocationPreview.outstandingSessions.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Outstanding</p>
                {allocationPreview.outstandingSessions.map((appointment) => (
                  <div key={appointment.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline" className="text-xs">
                      {appointment.type}
                    </Badge>
                    <span>{format(parseISO(appointment.date), 'dd MMM yyyy')}</span>
                    {appointment.fee && <span className="ml-auto">₹{Number(appointment.fee).toLocaleString('en-IN')}</span>}
                  </div>
                ))}
              </div>
            )}

            {allocationPreview.prepaidSessions.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Advance Sessions</p>
                {allocationPreview.prepaidSessions.map((appointment) => (
                  <div key={appointment.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline" className="text-xs">
                      {appointment.type}
                    </Badge>
                    <span>{format(parseISO(appointment.date), 'dd MMM yyyy')}</span>
                    {appointment.fee && <span className="ml-auto">₹{Number(appointment.fee).toLocaleString('en-IN')}</span>}
                  </div>
                ))}
              </div>
            )}

            {allocationPreview.allocatedTotal > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                Linked value: <Money amount={allocationPreview.allocatedTotal} />
              </div>
            )}

            {allocationPreview.remainingCredit > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                Advance credit: <Money amount={allocationPreview.remainingCredit} />
              </div>
            )}

            {allocationPreview.allocatedTotal === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                Amount stays as advance credit.
              </p>
            )}
          </div>
        )}

        {selectedPatient && paymentAmount > 0 && allocationPreview.allocatedTotal > 0 && (
          <div className="text-xs text-muted-foreground">
            {sumAppointmentFees([
              ...allocationPreview.outstandingSessions,
              ...allocationPreview.prepaidSessions,
            ]).toLocaleString('en-IN')} linked from available sessions.
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="payment_method">Payment Method *</Label>
          <Select name="payment_method" defaultValue="cash" required>
            <SelectTrigger id="payment_method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="card">Card</SelectItem>
              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="payment_notes">Notes</Label>
          <Textarea id="payment_notes" name="payment_notes" rows={2} />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading || !selectedPatient}>
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Saving...</>
        ) : mode === 'payment_only' ? 'Save Payment' : 'Save Package'}
      </Button>
    </form>
  )
}
