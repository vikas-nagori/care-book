'use client'

import { useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { recordPayment } from './actions'
import { getPaymentAllocationPreview } from '@/lib/billing/payment-helpers'
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
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState('')
  const [amount, setAmount] = useState('')

  const selectedPatientName = patients.find(p => p.id === selectedPatient)?.name

  const todayIST = getTodayIST()

  // Mirrors allocate_patient_payment_credit: this payment pays off completed unpaid
  // sessions first (oldest-first), then prepays upcoming scheduled ones, full fee only.
  const allocationPreview = useMemo(
    () =>
      getPaymentAllocationPreview({
        appointments,
        patientId: selectedPatient,
        amount: parseFloat(amount),
        today: todayIST,
      }),
    [appointments, selectedPatient, amount, todayIST]
  )

  const { outstandingSessions, prepaidSessions, allocatedTotal } = allocationPreview
  const linkedSessions = [...outstandingSessions, ...prepaidSessions]

  const patientPackages = packages.filter(p => p.patient_id === selectedPatient && p.status === 'active')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedPatient) return
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const packageId = formData.get('package_id') as string
    const amt = parseFloat(formData.get('amount') as string)

    const result = await recordPayment({
      patientId: selectedPatient,
      packageId: packageId || null,
      amount: amt,
      paymentMethod: formData.get('payment_method') as string,
      date: formData.get('date') as string,
      notes: (formData.get('notes') as string) || null,
    })

    if (!result.success) {
      toast({ title: 'Error', description: result.message, variant: 'destructive' })
      setLoading(false)
      return
    }

    toast({
      title: 'Payment recorded',
      description:
        result.linkedAppointmentIds.length > 0
          ? `Linked to ${result.linkedAppointmentIds.length} session(s)`
          : undefined,
    })
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Patient */}
      <div className="space-y-2">
        <Label>Patient *</Label>
        <SearchableSelect
          options={patients.map(p => ({ value: p.id, label: p.name }))}
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

      {/* Allocation preview — mirrors how the payment credit is applied server-side */}
      {selectedPatient && amount && parseFloat(amount) > 0 && linkedSessions.length > 0 && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/40">
          {outstandingSessions.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Marking {outstandingSessions.length} completed session(s) as paid:</p>
              {outstandingSessions.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="text-xs">{a.type}</Badge>
                  <span>{format(parseISO(a.date), 'dd MMM yyyy')}</span>
                  {a.fee && <span className="ml-auto">₹{Number(a.fee).toLocaleString()}</span>}
                </div>
              ))}
            </div>
          )}
          {prepaidSessions.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Prepaying {prepaidSessions.length} upcoming session(s):</p>
              {prepaidSessions.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="text-xs">{a.type}</Badge>
                  <span>{format(parseISO(a.date), 'dd MMM yyyy')}</span>
                  {a.fee && <span className="ml-auto">₹{Number(a.fee).toLocaleString()}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="pt-1 text-xs text-muted-foreground">
            Total linked value: ₹{allocatedTotal.toLocaleString()}
            {parseFloat(amount) > allocatedTotal && (
              <> · ₹{(parseFloat(amount) - allocatedTotal).toLocaleString()} kept as advance credit</>
            )}
          </div>
        </div>
      )}

      {selectedPatient && amount && parseFloat(amount) > 0 && linkedSessions.length === 0 && (
        <p className="text-sm text-muted-foreground">No unpaid session is fully covered by this amount — it will be kept as advance credit.</p>
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
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Recording…</>
        ) : 'Record Payment'}
      </Button>
    </form>
  )
}
