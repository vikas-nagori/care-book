'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { calculatePackageTotal } from '@/lib/billing/payment-helpers'
import { getBillingModeLabel } from '@/lib/billing/unified-billing'
import { applyPackageTemplate } from '@/lib/billing/package-template'
import type { BillingEntryKind, CreateBillingEntryInput, PackageTemplate } from '@/lib/supabase/types'
import { createBillingEntry, recordPayment } from './actions'

interface Props {
  patients: { id: string; name: string }[]
  packageTemplates?: PackageTemplate[]
  appointmentTypes: { id: string; name: string; session_rate: number }[]
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
  appointmentTypes,
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
  }

  const selectedPatientName = patients.find((patient) => patient.id === selectedPatient)?.name
  const packageTotalSessions = integerFromInput(packageSessions)
  const packageRate = numberFromInput(packagePerSessionAmount)
  const packageTotal = calculatePackageTotal(packageTotalSessions, packageRate)
  // Packages are prepaid: the receipt is always the full package total. Allowing a partial
  // amount here would strand a package due that no other screen can collect.
  const paymentAmount = mode === 'package_with_payment' ? packageTotal : numberFromInput(amount)

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
      input.appointmentTypeId = (formData.get('appointment_type_id') as string) || undefined
      input.packageStartsOn = (formData.get('package_starts_on') as string) || undefined
    }

    const result = mode === 'payment_only'
      ? await recordPayment({
        patientId: selectedPatient,
        // Standalone receipts are always regular-scoped; package money is collected
        // through the "Package + payment" entry type.
        fundingScope: 'ordinary',
        packageId: null,
        amount: paymentAmount,
        paymentMethod: input.paymentMethod ?? '',
        date: input.paymentDate ?? '',
        notes: input.paymentNotes ?? null,
      })
      : await createBillingEntry(input)

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
    if ('remainingCredit' in result && result.remainingCredit > 0) {
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
                min="0.01"
                step="0.01"
                required
                value={packagePerSessionAmount}
                onChange={(event) => setPackagePerSessionAmount(event.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 min-w-0">
              <Label htmlFor="appointment_type_id">Appointment Type *</Label>
              <Select name="appointment_type_id" required>
                <SelectTrigger id="appointment_type_id"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Only matching appointments on or after the start date use this package.</p>
            </div>
            <div className="space-y-2 min-w-0">
              <Label htmlFor="package_starts_on">Package Start Date *</Label>
              <Input id="package_starts_on" name="package_starts_on" type="date" required defaultValue={clinicToday} />
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
              min="0.01"
              step="0.01"
              required
              readOnly={mode === 'package_with_payment'}
              className={mode === 'package_with_payment' ? 'bg-muted' : undefined}
              value={mode === 'package_with_payment' ? (packageTotal > 0 ? String(packageTotal) : '') : amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            {mode === 'package_with_payment' && (
              <p className="text-xs text-muted-foreground">
                Packages are collected in full — this is sessions × per-session charge.
              </p>
            )}
          </div>
          <div className="space-y-2 min-w-0 overflow-hidden">
            <Label htmlFor="payment_date">Payment Date *</Label>
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

        {mode === 'payment_only' && selectedPatient && paymentAmount > 0 && (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">Regular allocation</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This receipt applies oldest-first to eligible regular charges, including partial sessions.
              Any remainder stays as refundable credit; package balances are never used.
            </p>
          </div>
        )}

        {mode === 'package_with_payment' && paymentAmount > 0 && (
          <p className="text-xs text-muted-foreground">
            This receipt is scoped only to the new package. Regular credit remains separate.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="payment_method">Payment Method *</Label>
          <Select name="payment_method" defaultValue="upi" required>
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
          <Label htmlFor="payment_notes">Notes{mode === 'package_with_payment' ? ' *' : ''}</Label>
          <Textarea id="payment_notes" name="payment_notes" rows={2} required={mode === 'package_with_payment'} />
        </div>
      </div>

      {/* A readOnly amount is barred from HTML constraint validation, so guard the total here. */}
      <Button type="submit" className="w-full" disabled={loading || !selectedPatient || (mode === 'package_with_payment' && packageTotal <= 0)}>
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Saving...</>
        ) : mode === 'payment_only' ? 'Save Payment' : 'Save Package'}
      </Button>
    </form>
  )
}
