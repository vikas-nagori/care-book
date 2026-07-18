'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useToast } from '@/hooks/use-toast'
import { logger } from '@/lib/logger'
import type { Doctor, ReferralSource } from '@/lib/supabase/types'

export const REFERRAL_SOURCE_LABEL: Record<ReferralSource, string> = {
  walk_in: 'Walk-in',
  doctor: 'Referred by doctor',
  other: 'Other',
}

export type ReferralSelection = ReturnType<typeof useReferralSelection>

/**
 * Owns the referral-tracking state for a patient form: the referral source and,
 * when "doctor" is chosen, the referring-doctor selection (including creating a
 * new doctor record). `resolveReferredDoctorId` is called at submit time to turn
 * the selection into a doctor id, creating the doctor row if needed.
 */
export function useReferralSelection(initial?: {
  source?: ReferralSource | null
  doctorId?: string | null
}) {
  const supabase = createClient()
  const { toast } = useToast()

  const [referralSource, setReferralSource] = useState<ReferralSource | ''>(initial?.source ?? '')
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(initial?.doctorId ?? null)
  const [isCreatingDoctor, setIsCreatingDoctor] = useState(false)
  const [newDoctorName, setNewDoctorName] = useState('')
  const [newDoctorSpecialty, setNewDoctorSpecialty] = useState('')
  const [newDoctorAddress, setNewDoctorAddress] = useState('')

  function handleReferralSourceChange(value: string) {
    const next = value as ReferralSource
    setReferralSource(next)
    if (next !== 'doctor') {
      setSelectedDoctorId(null)
      setIsCreatingDoctor(false)
    }
  }

  function selectDoctor(doctorId: string) {
    setSelectedDoctorId(doctorId)
    setIsCreatingDoctor(false)
  }

  function startCreatingDoctor(name: string) {
    setSelectedDoctorId(null)
    setIsCreatingDoctor(true)
    setNewDoctorName(name)
    setNewDoctorSpecialty('')
    setNewDoctorAddress('')
  }

  // Resolve the referring doctor to an id, creating a new doctor record if needed.
  // Returns { doctorId } on success, or null after surfacing an error toast.
  async function resolveReferredDoctorId(): Promise<{ doctorId: string | null } | null> {
    if (referralSource !== 'doctor') return { doctorId: null }

    if (isCreatingDoctor) {
      const name = newDoctorName.trim()
      if (!name) {
        toast({ title: 'Doctor name required', description: 'Enter the referring doctor’s name.', variant: 'destructive' })
        return null
      }

      const { data: inserted, error } = await supabase
        .from('doctors')
        .insert({
          name,
          specialty: newDoctorSpecialty.trim() || null,
          address: newDoctorAddress.trim() || null,
        })
        .select('id')
        .single()

      if (inserted) return { doctorId: inserted.id }

      // A doctor with this name may already exist (case-insensitive unique index).
      if (error?.code === '23505') {
        const { data: existing } = await supabase
          .from('doctors')
          .select('id')
          .ilike('name', name)
          .limit(1)
          .maybeSingle()
        if (existing) return { doctorId: existing.id }
      }

      logger.error('ReferralFields/createDoctor', error, { name })
      toast({ title: 'Doctor not saved', description: error?.message ?? 'Unable to create the doctor record.', variant: 'destructive' })
      return null
    }

    if (!selectedDoctorId) {
      toast({ title: 'Doctor required', description: 'Select or add the referring doctor.', variant: 'destructive' })
      return null
    }
    return { doctorId: selectedDoctorId }
  }

  return {
    referralSource,
    selectedDoctorId,
    isCreatingDoctor,
    newDoctorName,
    newDoctorSpecialty,
    newDoctorAddress,
    setNewDoctorName,
    setNewDoctorSpecialty,
    setNewDoctorAddress,
    handleReferralSourceChange,
    selectDoctor,
    startCreatingDoctor,
    resolveReferredDoctorId,
  }
}

/** Presentational referral fields driven by {@link useReferralSelection}. */
export function ReferralFields({
  referral,
  doctors,
}: {
  referral: ReferralSelection
  doctors: Doctor[]
}) {
  const {
    referralSource,
    selectedDoctorId,
    isCreatingDoctor,
    newDoctorName,
    newDoctorSpecialty,
    newDoctorAddress,
    setNewDoctorName,
    setNewDoctorSpecialty,
    setNewDoctorAddress,
    handleReferralSourceChange,
    selectDoctor,
    startCreatingDoctor,
  } = referral

  return (
    <>
      {/* Referral tracking */}
      <div className="space-y-2">
        <Label htmlFor="referral_source">How were they referred?</Label>
        <Select value={referralSource || undefined} onValueChange={handleReferralSourceChange}>
          <SelectTrigger id="referral_source">
            <SelectValue placeholder="Select referral source" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(REFERRAL_SOURCE_LABEL) as ReferralSource[]).map((source) => (
              <SelectItem key={source} value={source}>
                {REFERRAL_SOURCE_LABEL[source]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {referralSource === 'doctor' && (
        <div className="space-y-2">
          <Label htmlFor="referring_doctor">Referring Doctor</Label>
          <SearchableSelect
            id="referring_doctor"
            options={doctors.map((d) => ({ value: d.id, label: d.name, hint: d.specialty ?? undefined }))}
            value={selectedDoctorId}
            onChange={selectDoctor}
            placeholder="Search or add a doctor"
            searchPlaceholder="Search doctor name…"
            emptyText="No doctors yet — type a name to add one."
            allowCreate
            onCreate={startCreatingDoctor}
            createLabel={(q) => `Add doctor “${q}”`}
          />

          {isCreatingDoctor && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">New Doctor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new_doctor_name">Name *</Label>
                  <Input
                    id="new_doctor_name"
                    value={newDoctorName}
                    onChange={(e) => setNewDoctorName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new_doctor_specialty">Specialty (optional)</Label>
                  <Input
                    id="new_doctor_specialty"
                    placeholder="e.g. Orthopaedic Surgeon"
                    value={newDoctorSpecialty}
                    onChange={(e) => setNewDoctorSpecialty(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new_doctor_address">Address (optional)</Label>
                  <Textarea
                    id="new_doctor_address"
                    rows={2}
                    value={newDoctorAddress}
                    onChange={(e) => setNewDoctorAddress(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  )
}
