'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { TreatmentPlan } from '@/lib/supabase/types'

interface Props {
  patientId: string
  defaultDate: string
  plan?: TreatmentPlan
  onSuccess?: () => void
}

export function TreatmentPlanForm({ patientId, defaultDate, plan, onSuccess }: Props) {
  const supabase = createClient()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const data = {
      patient_id: patientId,
      diagnosis: formData.get('diagnosis') as string,
      goals: (formData.get('goals') as string) || null,
      start_date: formData.get('start_date') as string,
      expected_end_date: (formData.get('expected_end_date') as string) || null,
      status: (formData.get('status') as string) || 'active',
    }

    let error
    if (plan) {
      ({ error } = await supabase.from('treatment_plans').update(data).eq('id', plan.id))
    } else {
      ({ error } = await supabase.from('treatment_plans').insert(data))
    }

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
      setLoading(false)
    } else {
      toast({ title: plan ? 'Plan updated' : 'Plan created' })
      onSuccess?.()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Diagnosis *</Label>
        <Input name="diagnosis" defaultValue={plan?.diagnosis ?? ''} required />
      </div>
      <div className="space-y-2">
        <Label>Goals</Label>
        <Textarea name="goals" rows={3} defaultValue={plan?.goals ?? ''} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Date *</Label>
          <Input name="start_date" type="date" defaultValue={plan?.start_date ?? defaultDate} required />
        </div>
        <div className="space-y-2">
          <Label>Expected End</Label>
          <Input name="expected_end_date" type="date" defaultValue={plan?.expected_end_date ?? ''} />
        </div>
      </div>
      {plan && (
        <div className="space-y-2">
          <Label>Status</Label>
          <Select name="status" defaultValue={plan.status}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="discontinued">Discontinued</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Saving…</>
        ) : (plan ? 'Update Plan' : 'Create Plan')}
      </Button>
    </form>
  )
}
