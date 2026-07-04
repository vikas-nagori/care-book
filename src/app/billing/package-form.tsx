'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useToast } from '@/hooks/use-toast'
import { logger } from '@/lib/logger'

interface Props {
  patients: { id: string; name: string }[]
  onSuccess?: () => void
}

export function PackageForm({ patients, onSuccess }: Props) {
  const supabase = createClient()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!selectedPatient) {
      toast({ title: 'Patient required', description: 'Select a patient for this package.', variant: 'destructive' })
      return
    }

    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const data = {
      patient_id: selectedPatient,
      name: formData.get('name') as string,
      total_sessions: parseInt(formData.get('total_sessions') as string),
      total_amount: parseFloat(formData.get('total_amount') as string),
      payment_timing: formData.get('payment_timing') as string,
    }

    const { error } = await supabase.from('packages').insert(data)
    if (error) {
      logger.error('PackageForm/insert', error, { patientId: data.patient_id })
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
      setLoading(false)
    } else {
      toast({ title: 'Package created' })
      onSuccess?.()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Patient *</Label>
        <SearchableSelect
          options={patients.map((p) => ({ value: p.id, label: p.name }))}
          value={selectedPatient || null}
          onChange={setSelectedPatient}
          placeholder="Select patient"
          searchPlaceholder="Search patient…"
          emptyText="No patients found."
        />
      </div>
      <div className="space-y-2">
        <Label>Package Name *</Label>
        <Input name="name" placeholder="e.g. 10 Session Package" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Total Sessions *</Label>
          <Input name="total_sessions" type="number" min="1" required />
        </div>
        <div className="space-y-2">
          <Label>Total Amount (₹) *</Label>
          <Input name="total_amount" type="number" min="0" step="0.01" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Payment Timing</Label>
        <Select name="payment_timing" defaultValue="prepaid">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="prepaid">Prepaid</SelectItem>
            <SelectItem value="postpaid">Postpaid</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Creating…</>
        ) : 'Create Package'}
      </Button>
    </form>
  )
}
