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
  google: 'Google page',
  patient: 'Referred by existing patient',
  other: 'Other',
}

/** An existing patient offered as a referrer. */
export type ReferralPatientOption = { id: string; name: string; phone?: string | null }

/** The referral detail columns written to `patients`; each is null unless its source is chosen. */
export type ResolvedReferral = {
  referred_by_doctor_id: string | null
  referred_by_patient_id: string | null
  referral_other: string | null
}

export type ReferralSelection = ReturnType<typeof useReferralSelection>

/**
 * Owns the referral-tracking state for a patient form: the referral source and the
 * detail that goes with it: the referring doctor (including creating a new doctor
 * record), the referring existing patient, or the typed "Other" source.
 * `resolveReferral` is called at submit time to turn the selection into the
 * referral columns, creating the doctor row if needed.
 */
export function useReferralSelection(initial?: {
  source?: ReferralSource | null
  doctorId?: string | null
  referrerPatientId?: string | null
  other?: string | null
}) {
  const supabase = createClient()
  const { toast } = useToast()

  const [referralSource, setReferralSource] = useState<ReferralSource | ''>(initial?.source ?? '')
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(initial?.doctorId ?? null)
  const [isCreatingDoctor, setIsCreatingDoctor] = useState(false)
  const [newDoctorName, setNewDoctorName] = useState('')
  const [newDoctorSpecialty, setNewDoctorSpecialty] = useState('')
  const [newDoctorAddress, setNewDoctorAddress] = useState('')
  const [referrerPatientId, setReferrerPatientId] = useState<string | null>(initial?.referrerPatientId ?? null)
  const [referralOther, setReferralOther] = useState(initial?.other ?? '')

  // Detail only belongs to its own source (the database enforces this too), so
  // switching away from a source drops what was entered for it.
  function handleReferralSourceChange(value: string) {
    const next = value as ReferralSource
    setReferralSource(next)
    if (next !== 'doctor') {
      setSelectedDoctorId(null)
      setIsCreatingDoctor(false)
    }
    if (next !== 'patient') setReferrerPatientId(null)
    if (next !== 'other') setReferralOther('')
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

  // Resolve the selection to the referral columns, creating a new doctor record if
  // needed. Returns null after surfacing an error toast when the selection is incomplete.
  async function resolveReferral(): Promise<ResolvedReferral | null> {
    const none: ResolvedReferral = { referred_by_doctor_id: null, referred_by_patient_id: null, referral_other: null }

    if (referralSource === 'patient') {
      if (!referrerPatientId) {
        toast({ title: 'Referring patient required', description: 'Search for and select the patient who referred them.', variant: 'destructive' })
        return null
      }
      return { ...none, referred_by_patient_id: referrerPatientId }
    }
    if (referralSource === 'other') return { ...none, referral_other: referralOther.trim() || null }
    if (referralSource !== 'doctor') return none

    const doctor = await resolveReferredDoctorId()
    return doctor && { ...none, referred_by_doctor_id: doctor.doctorId }
  }

  // Resolve the referring doctor to an id, creating a new doctor record if needed.
  // Returns { doctorId } on success, or null after surfacing an error toast.
  async function resolveReferredDoctorId(): Promise<{ doctorId: string | null } | null> {
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
    referrerPatientId,
    referralOther,
    setReferrerPatientId,
    setReferralOther,
    handleReferralSourceChange,
    selectDoctor,
    startCreatingDoctor,
    resolveReferral,
  }
}

/** Presentational referral fields driven by {@link useReferralSelection}. */
export function ReferralFields({
  referral,
  doctors,
  patients,
  excludePatientId,
}: {
  referral: ReferralSelection
  doctors: Doctor[]
  /** Existing patients offered when "Referred by existing patient" is chosen. */
  patients: ReferralPatientOption[]
  /** The patient being edited, who cannot be their own referrer. */
  excludePatientId?: string
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
    referrerPatientId,
    referralOther,
    setReferrerPatientId,
    setReferralOther,
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

      {referralSource === 'patient' && (
        <div className="space-y-2">
          <Label htmlFor="referring_patient">Referring Patient</Label>
          <SearchableSelect
            id="referring_patient"
            options={patients
              .filter((p) => p.id !== excludePatientId)
              .map((p) => ({ value: p.id, label: p.name, hint: p.phone ?? undefined }))}
            value={referrerPatientId}
            onChange={setReferrerPatientId}
            placeholder="Search existing patients"
            searchPlaceholder="Search patient name…"
            emptyText="No matching patient."
          />
        </div>
      )}

      {referralSource === 'other' && (
        <div className="space-y-2">
          <Label htmlFor="referral_other">Please specify</Label>
          <Input
            id="referral_other"
            maxLength={200}
            placeholder="e.g. Instagram, newspaper, health camp"
            value={referralOther}
            onChange={(e) => setReferralOther(e.target.value)}
          />
        </div>
      )}
    </>
  )
}
