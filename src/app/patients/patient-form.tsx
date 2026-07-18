'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { logger } from '@/lib/logger'
import type { Doctor, Patient, ReferralSource } from '@/lib/supabase/types'

const REFERRAL_SOURCE_LABEL: Record<ReferralSource, string> = {
  walk_in: 'Walk-in',
  doctor: 'Referred by doctor',
  other: 'Other',
}

type PatientFormValues = {
  name: string
  phone: string | null
  email: string | null
  dob: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
  referral_source: string | null
  referred_by_doctor_id: string | null
}

export function PatientForm({ patient, doctors = [] }: { patient?: Patient; doctors?: Doctor[] }) {
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  // Synchronous re-entrancy guard: blocks a second save (main submit or the
  // "Add anyway" confirm) while one insert/update is already in flight.
  const savingRef = useRef(false)

  // When creating a patient whose phone matches an existing record, hold the
  // pending values here and surface a confirm dialog instead of inserting.
  const [duplicateNames, setDuplicateNames] = useState<string[]>([])
  const [pendingData, setPendingData] = useState<PatientFormValues | null>(null)

  const [referralSource, setReferralSource] = useState<ReferralSource | ''>(patient?.referral_source ?? '')
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(patient?.referred_by_doctor_id ?? null)
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

      logger.error('PatientForm/createDoctor', error, { name })
      toast({ title: 'Doctor not saved', description: error?.message ?? 'Unable to create the doctor record.', variant: 'destructive' })
      return null
    }

    if (!selectedDoctorId) {
      toast({ title: 'Doctor required', description: 'Select or add the referring doctor.', variant: 'destructive' })
      return null
    }
    return { doctorId: selectedDoctorId }
  }

  // Persist the patient (insert on create, update on edit) and navigate on success.
  async function savePatient(data: PatientFormValues) {
    if (savingRef.current) return
    savingRef.current = true

    let error
    if (patient) {
      ({ error } = await supabase.from('patients').update(data).eq('id', patient.id))
    } else {
      ({ error } = await supabase.from('patients').insert(data))
    }

    if (error) {
      logger.error('PatientForm/save', error, { patientId: patient?.id })
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
      savingRef.current = false
      setLoading(false)
    } else {
      toast({ title: patient ? 'Patient updated' : 'Patient added' })
      router.push('/patients')
      router.refresh()
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const resolvedDoctor = await resolveReferredDoctorId()
    if (!resolvedDoctor) {
      setLoading(false)
      return
    }

    const formData = new FormData(e.currentTarget)
    const data: PatientFormValues = {
      name: formData.get('name') as string,
      phone: (formData.get('phone') as string) || null,
      email: (formData.get('email') as string) || null,
      dob: (formData.get('dob') as string) || null,
      gender: (formData.get('gender') as string) || null,
      address: (formData.get('address') as string) || null,
      medical_history: (formData.get('medical_history') as string) || null,
      notes: (formData.get('notes') as string) || null,
      referral_source: referralSource || null,
      referred_by_doctor_id: resolvedDoctor.doctorId,
    }

    // On create, warn if an existing patient in this clinic already has this phone.
    // RLS scopes the lookup to the current clinic; shared family numbers are still
    // allowed via "Add anyway".
    if (!patient && data.phone) {
      const { data: dupes } = await supabase
        .from('patients')
        .select('id, name')
        .eq('phone', data.phone)

      if (dupes && dupes.length > 0) {
        setDuplicateNames(dupes.map((d) => d.name))
        setPendingData(data)
        return
      }
    }

    await savePatient(data)
  }

  function cancelDuplicate() {
    setPendingData(null)
    setDuplicateNames([])
    setLoading(false)
  }

  async function confirmDuplicate() {
    const data = pendingData
    setPendingData(null)
    setDuplicateNames([])
    if (data) await savePatient(data)
  }

  return (
    <>
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" name="name" defaultValue={patient?.name} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" defaultValue={patient?.phone ?? ''} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={patient?.email ?? ''} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dob">Date of Birth</Label>
              <Input id="dob" name="dob" type="date" defaultValue={patient?.dob ?? ''} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select name="gender" defaultValue={patient?.gender ?? ''}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

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

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" name="address" rows={2} defaultValue={patient?.address ?? ''} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="medical_history">Medical History</Label>
            <Textarea id="medical_history" name="medical_history" rows={3} defaultValue={patient?.medical_history ?? ''} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} defaultValue={patient?.notes ?? ''} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? (
                <><Loader2 className="animate-spin" size={14} /> Saving…</>
              ) : (patient ? 'Update Patient' : 'Add Patient')}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <AlertDialog open={pendingData !== null} onOpenChange={(open) => { if (!open) cancelDuplicate() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Patient may already exist</AlertDialogTitle>
          <AlertDialogDescription>
            {duplicateNames.length === 1
              ? `A patient with this phone number already exists: ${duplicateNames[0]}.`
              : `${duplicateNames.length} patients with this phone number already exist: ${duplicateNames.join(', ')}.`}
            {' '}Add this patient anyway?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={cancelDuplicate}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDuplicate}>Add anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
