'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { saveSessionNote } from '../actions'
import type { SessionNote } from '@/lib/supabase/types'

interface Props {
  appointmentId: string
  sessionNote?: SessionNote | null
  onSuccess?: () => void
}

export function SessionNoteForm({ appointmentId, sessionNote, onSuccess }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await saveSessionNote({
      appointmentId,
      noteId: sessionNote?.id ?? null,
      subjective: (formData.get('subjective') as string) || null,
      objective: (formData.get('objective') as string) || null,
      assessment: (formData.get('assessment') as string) || null,
      plan: (formData.get('plan') as string) || null,
      exercises_prescribed: (formData.get('exercises_prescribed') as string) || null,
    })

    if (!result.success) {
      toast({ title: 'Error', description: result.message, variant: 'destructive' })
      setLoading(false)
      return
    }

    toast({ title: sessionNote ? 'Notes updated' : 'Notes saved' })
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="subjective">Subjective</Label>
        <Textarea id="subjective" name="subjective" rows={3} placeholder="Patient's complaints, symptoms, history..." defaultValue={sessionNote?.subjective ?? ''} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="objective">Objective</Label>
        <Textarea id="objective" name="objective" rows={3} placeholder="Examination findings, measurements, observations..." defaultValue={sessionNote?.objective ?? ''} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="assessment">Assessment</Label>
        <Textarea id="assessment" name="assessment" rows={3} placeholder="Clinical assessment, diagnosis, progress..." defaultValue={sessionNote?.assessment ?? ''} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="plan">Plan</Label>
        <Textarea id="plan" name="plan" rows={3} placeholder="Treatment plan, next steps, follow-up..." defaultValue={sessionNote?.plan ?? ''} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="exercises_prescribed">Exercises Prescribed</Label>
        <Textarea id="exercises_prescribed" name="exercises_prescribed" rows={3} placeholder="Home exercises, frequency, sets, reps..." defaultValue={sessionNote?.exercises_prescribed ?? ''} />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Saving…</>
        ) : 'Save Notes'}
      </Button>
    </form>
  )
}
