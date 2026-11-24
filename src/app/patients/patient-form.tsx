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
import { Card, CardContent } from '@/components/ui/card'
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
import { ReferralFields, useReferralSelection, type ReferralPatientOption } from '@/components/referral/referral-fields'
import { useToast } from '@/hooks/use-toast'
import { logger } from '@/lib/logger'
import { requestErrorMessage } from '@/lib/actions/request-error-message'
import { ageFieldsForSave, parseAgeInput, patientAge, type PatientAgeWrite } from '@/lib/patients/age'
import type { Doctor, Patient } from '@/lib/supabase/types'

type PatientFormValues = {
  name: string
  phone: string | null
  email: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
  referral_source: string | null
  referred_by_doctor_id: string | null
  referred_by_patient_id: string | null
  referral_other: string | null
  // An edit that leaves the shown age alone omits these keys; the legacy `dob` is only ever written
  // as null, when an edit empties the Age field (decision D4a).
} & PatientAgeWrite

export function PatientForm({
  patient,
  doctors = [],
  referralPatients = [],
}: {
  patient?: Patient
  doctors?: Doctor[]
  /** Existing patients offered as referrers. */
  referralPatients?: ReferralPatientOption[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [ageError, setAgeError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const initialAge = patient ? patientAge(patient) : null
  // Synchronous re-entrancy guard: blocks a second save (main submit or the
  // "Add anyway" confirm) while one insert/update is already in flight.
  const savingRef = useRef(false)

  // When creating a patient whose phone matches an existing record, hold the
  // pending values here and surface a confirm dialog instead of inserting.
  const [duplicateNames, setDuplicateNames] = useState<string[]>([])
  const [pendingData, setPendingData] = useState<PatientFormValues | null>(null)

  const referral = useReferralSelection({
    source: patient?.referral_source,
    doctorId: patient?.referred_by_doctor_id,
    referrerPatientId: patient?.referred_by_patient_id,
    other: patient?.referral_other,
  })

  // Persist the patient (insert on create, update on edit) and navigate on success.
  async function savePatient(data: PatientFormValues) {
    if (savingRef.current) return
    savingRef.current = true

    try {
      let error
      let updatedRows: unknown[] | null = null
      if (patient) {
        // Read back the id: an update that matches no row (the patient was deleted meanwhile)
        // returns no error, only an empty list (G-3).
        ({ data: updatedRows, error } = await supabase.from('patients').update(data).eq('id', patient.id).select('id'))
      } else {
        ({ error } = await supabase.from('patients').insert(data))
      }

      if (!error && patient && updatedRows?.length === 0) {
        toast({
          title: 'Patient not saved',
          description: 'This patient no longer exists. It may have been deleted by someone else.',
          variant: 'destructive',
        })
        return
      }

      if (error) {
        logger.error('PatientForm/save', error, { patientId: patient?.id })
        // A dropped connection comes back as `TypeError: Failed to fetch`; say it in plain words (G-12).
        toast({ title: 'Error', description: requestErrorMessage(error, 'Unable to save patient. Please try again.'), variant: 'destructive' })
        return
      }

      toast({ title: patient ? 'Patient updated' : 'Patient added' })
      router.push('/patients')
      router.refresh()
    } catch (error) {
      logger.error('PatientForm/save', error, { patientId: patient?.id })
      toast({
        title: 'Error',
        description: 'Unable to save patient. Please try again.',
        variant: 'destructive',
      })
    } finally {
      savingRef.current = false
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    // `required` lets a name of only spaces through; it would save as a blank patient (G-11).
    const name = ((formData.get('name') as string | null) ?? '').trim()
    const ageInput = parseAgeInput(formData.get('age') as string | null)
    setNameError(name ? null : 'Enter the patient’s name.')
    setAgeError(ageInput.ok ? null : ageInput.message)
    if (!name || !ageInput.ok) return
    setLoading(true)

    try {
      const resolvedReferral = await referral.resolveReferral()
      if (!resolvedReferral) {
        setLoading(false)
        return
      }

      const data: PatientFormValues = {
        name,
        phone: (formData.get('phone') as string) || null,
        email: (formData.get('email') as string) || null,
        gender: (formData.get('gender') as string) || null,
        address: (formData.get('address') as string) || null,
        medical_history: (formData.get('medical_history') as string) || null,
        notes: (formData.get('notes') as string) || null,
        referral_source: referral.referralSource || null,
        ...resolvedReferral,
        ...ageFieldsForSave(ageInput.age, patient ?? null),
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
    } catch (error) {
      logger.error('PatientForm/submit', error, { patientId: patient?.id })
      toast({
        title: 'Error',
        description: 'Unable to save patient. Please try again.',
        variant: 'destructive',
      })
      savingRef.current = false
      setLoading(false)
    }
  }

  function cancelDuplicate() {
    setPendingData(null)
    setDuplicateNames([])
    setLoading(false)
  }

  async function confirmDuplicate(event: React.MouseEvent) {
    // Close the dialog ourselves: Radix's own close would call onOpenChange(false) →
    // cancelDuplicate(), which clears `loading` while the insert is still in flight (G-17a).
    event.preventDefault()
    const data = pendingData
    setPendingData(null)
    setDuplicateNames([])
    if (data) await savePatient(data)
    else setLoading(false)
  }

  return (
    <>
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={patient?.name}
              required
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'name-error' : undefined}
              onChange={() => { if (nameError) setNameError(null) }}
            />
            {nameError && <p id="name-error" role="alert" className="text-sm text-destructive">{nameError}</p>}
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
              <Label htmlFor="age">Age (years)</Label>
              {/* Text + numeric keypad rather than type="number": blank, letters and fractions all
                  reach parseAgeInput, so every bad value gets the same message. */}
              <Input
                id="age"
                name="age"
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                defaultValue={initialAge ?? ''}
                aria-invalid={ageError ? true : undefined}
                aria-describedby={ageError ? 'age-error' : undefined}
                onChange={() => { if (ageError) setAgeError(null) }}
              />
              {ageError && <p id="age-error" role="alert" className="text-sm text-destructive">{ageError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              {/* undefined, not '': with '' Radix's hidden native <select> has no empty option, so
                  the browser submits the first one and an unanswered Gender saves as "male". */}
              <Select name="gender" defaultValue={patient?.gender ?? undefined}>
                <SelectTrigger id="gender">
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

          <ReferralFields
            referral={referral}
            doctors={doctors}
            patients={referralPatients}
            excludePatientId={patient?.id}
          />

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
