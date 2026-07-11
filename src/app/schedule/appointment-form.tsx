'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useToast } from '@/hooks/use-toast'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import {
  buildPatientInsertData,
  createPatientDraftFromName,
  filterAppointmentPatientOptions,
  shouldOfferCreatePatientOption,
  type AppointmentPatientDraft,
  type AppointmentPatientOption,
} from '@/lib/schedule/patient-search'
import type { Appointment, AppointmentAssigneeOption, AppointmentType, ExternalStaff } from '@/lib/supabase/types'
import { defaultAppointmentType, sortAppointmentTypes } from '@/lib/appointments/appointment-type'
import { normalizeAppointmentAssignment, parseStaffAssignmentValue } from '@/lib/appointments/assignment'

const UNASSIGNED_ASSIGNEE_VALUE = '__unassigned__'

interface AppointmentFormProps {
  patients: AppointmentPatientOption[]
  assigneeOptions?: AppointmentAssigneeOption[]
  externalStaffOptions?: ExternalStaff[]
  currentProfileId?: string | null
  canManageExternalStaff?: boolean
  defaultDate?: string
  defaultPatientId?: string
  appointment?: Appointment
  onSuccess?: () => void
}

function getAssigneeLabel(assignee: AppointmentAssigneeOption) {
  return assignee.full_name || assignee.email
}

export function AppointmentForm({
  patients,
  assigneeOptions = [],
  externalStaffOptions = [],
  currentProfileId = null,
  canManageExternalStaff = false,
  defaultDate,
  defaultPatientId,
  appointment,
  onSuccess,
}: AppointmentFormProps) {
  const supabase = createClient()
  const { toast } = useToast()
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([])
  const [appointmentTypeId, setAppointmentTypeId] = useState<string>(appointment?.appointment_type_id ?? '')
  const [assignedTo, setAssignedTo] = useState(appointment?.assigned_to ?? '')
  const initialStaffAssignment = appointment?.external_staff_id
    ? `external:${appointment.external_staff_id}`
    : appointment?.assigned_to
      ? `internal:${appointment.assigned_to}`
      : UNASSIGNED_ASSIGNEE_VALUE
  const [staffAssignment, setStaffAssignment] = useState(initialStaffAssignment)
  const [fee, setFee] = useState<string>(appointment?.fee?.toString() || '')

  const selectedType = appointmentTypes.find((type) => type.id === appointmentTypeId) ?? null
  const isSharedType = selectedType?.is_shared ?? false
  const initialSelectedPatientId = appointment?.patient_id || defaultPatientId || ''
  const initialSelectedPatient = patients.find((patient) => patient.id === initialSelectedPatientId) ?? null
  const [selectedPatientId, setSelectedPatientId] = useState(initialSelectedPatientId)
  const [patientSearchQuery, setPatientSearchQuery] = useState(initialSelectedPatient?.name || '')
  const [patientSearchOpen, setPatientSearchOpen] = useState(false)
  const [isCreatingPatient, setIsCreatingPatient] = useState(false)
  const [patientDraft, setPatientDraft] = useState<AppointmentPatientDraft>(createPatientDraftFromName(''))

  const filteredPatients = useMemo(
    () => filterAppointmentPatientOptions(patients, patientSearchQuery).slice(0, 8),
    [patients, patientSearchQuery],
  )
  const canCreatePatient = shouldOfferCreatePatientOption(patients, patientSearchQuery)

  // Load the clinic's appointment types once on mount
  useEffect(() => {
    supabase.from('appointment_types').select('*').order('sort_order').then(({ data }) => {
      if (!data) return
      setAppointmentTypes(data)
      // For new appointments, default to a sensible type and auto-fill its rate.
      if (!appointment) {
        const def = defaultAppointmentType(data)
        if (def) {
          setAppointmentTypeId(def.id)
          setFee((current) => current || String(def.session_rate))
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (appointment) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setPatientSearchOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [appointment])

  // Update assignment + fee when the selected type changes
  function handleTypeChange(typeId: string) {
    setAppointmentTypeId(typeId)
    const type = appointmentTypes.find((candidate) => candidate.id === typeId)
    const shared = type?.is_shared ?? false

    setAssignedTo((currentAssignee) => (shared ? '' : currentAssignee || currentProfileId || ''))
    if (shared) {
      setStaffAssignment(UNASSIGNED_ASSIGNEE_VALUE)
    } else if (staffAssignment === UNASSIGNED_ASSIGNEE_VALUE && currentProfileId) {
      setStaffAssignment(`internal:${currentProfileId}`)
    }

    // Auto-fill the rate for new appointments (admins can still override).
    if (!appointment && type) {
      setFee(String(type.session_rate))
    }
  }

  function handleAssigneeChange(value: string) {
    setStaffAssignment(value)
    const parsed = parseStaffAssignmentValue(value)
    setAssignedTo(parsed.assignedTo ?? '')
  }

  function handlePatientSearchChange(value: string) {
    setPatientSearchQuery(value)
    setPatientSearchOpen(true)
    setSelectedPatientId('')

    if (isCreatingPatient) {
      setPatientDraft((currentDraft) => ({
        ...currentDraft,
        name: value,
      }))
    }
  }

  function selectExistingPatient(patient: AppointmentPatientOption) {
    setSelectedPatientId(patient.id)
    setPatientSearchQuery(patient.name)
    setPatientSearchOpen(false)
    setIsCreatingPatient(false)
    setPatientDraft(createPatientDraftFromName(''))
  }

  function enableCreatePatientMode() {
    const patientName = patientSearchQuery.trim()

    setSelectedPatientId('')
    setIsCreatingPatient(true)
    setPatientDraft(createPatientDraftFromName(patientName))
    setPatientSearchQuery(patientName)
    setPatientSearchOpen(false)
  }

  function updatePatientDraft(field: keyof AppointmentPatientDraft, value: string) {
    setPatientDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    let patientId = selectedPatientId
    let createdPatient: { id: string; name: string } | null = null

    if (!appointment && isCreatingPatient) {
      const patientData = buildPatientInsertData(patientDraft)

      if (!patientData.name || !patientData.phone) {
        toast({
          title: 'Patient details required',
          description: 'Please enter at least the patient name and phone number.',
          variant: 'destructive',
        })
        setLoading(false)
        return
      }

      const { data: insertedPatient, error: patientError } = await supabase
        .from('patients')
        .insert(patientData)
        .select('id, name')
        .single()

      if (patientError || !insertedPatient) {
        logger.error('AppointmentForm/createPatient', patientError, {
          patientName: patientData.name,
        })
        toast({
          title: 'Patient not added',
          description: patientError?.message || 'Unable to create the patient record.',
          variant: 'destructive',
        })
        setLoading(false)
        return
      }

      patientId = insertedPatient.id
      createdPatient = insertedPatient
    }

    if (!patientId) {
      toast({
        title: 'Patient required',
        description: 'Select an existing patient or create a new patient before booking.',
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    if (!appointmentTypeId) {
      toast({
        title: 'Appointment type required',
        description: 'Choose an appointment type before saving.',
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    const selectedAssignment = parseStaffAssignmentValue(staffAssignment)

    const assignment = normalizeAppointmentAssignment({
      isShared: isSharedType,
      assignedTo: canManageExternalStaff
        ? selectedAssignment.assignedTo
        : (appointment?.external_staff_id ? null : assignedTo),
      externalStaffId: canManageExternalStaff
        ? selectedAssignment.externalStaffId
        : (appointment?.external_staff_id ?? null),
    })

    const data = {
      patient_id: patientId,
      date: formData.get('date') as string,
      time: formData.get('time') as string,
      duration_minutes: parseInt(formData.get('duration_minutes') as string) || 45,
      appointment_type_id: appointmentTypeId,
      status: (formData.get('status') as string) || 'scheduled',
      fee: parseFloat(formData.get('fee') as string) || null,
      assigned_to: assignment.assigned_to,
      external_staff_id: assignment.external_staff_id,
      notes: (formData.get('notes') as string) || null,
    }

    let error
    if (appointment) {
      ({ error } = await supabase.from('appointments').update(data).eq('id', appointment.id))
    } else {
      ({ error } = await supabase.from('appointments').insert(data))
    }

    if (error) {
      logger.error('AppointmentForm/save', error, { appointmentId: appointment?.id, patientId })
      if (createdPatient) {
        setSelectedPatientId(createdPatient.id)
        setPatientSearchQuery(createdPatient.name)
        setIsCreatingPatient(false)
        setPatientDraft(createPatientDraftFromName(''))
      }
      toast({
        title: createdPatient ? 'Appointment not booked' : 'Error',
        description: createdPatient
          ? `Patient was added, but the appointment could not be saved: ${error.message}`
          : error.message,
        variant: 'destructive',
      })
      setLoading(false)
    } else {
      toast({
        title: appointment
          ? 'Appointment updated'
          : createdPatient
            ? 'Patient added and appointment booked'
            : 'Appointment booked',
      })
      setLoading(false)
      onSuccess?.()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {appointment ? (
        <div className="space-y-2">
          <Label htmlFor="patient_id">Patient *</Label>
          <SearchableSelect
            id="patient_id"
            options={patients.map((patient) => ({ value: patient.id, label: patient.name }))}
            value={selectedPatientId || null}
            onChange={setSelectedPatientId}
            placeholder="Select patient"
            searchPlaceholder="Search patient…"
            emptyText="No patients found."
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="patient_search">Patient *</Label>
          <div ref={searchContainerRef} className="relative">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="patient_search"
                value={patientSearchQuery}
                onChange={(e) => handlePatientSearchChange(e.target.value)}
                onFocus={() => setPatientSearchOpen(true)}
                placeholder="Search patient name or type a new one"
                className="pl-9"
                autoComplete="off"
              />
            </div>

            {patientSearchOpen && (
              <div className="absolute z-20 mt-2 w-full rounded-md border bg-background shadow-lg">
                <div className="max-h-64 overflow-y-auto py-1">
                  {filteredPatients.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted',
                        selectedPatientId === patient.id && 'bg-muted',
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectExistingPatient(patient)}
                    >
                      <span>{patient.name}</span>
                      {selectedPatientId === patient.id && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  ))}

                  {canCreatePatient && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={enableCreatePatientMode}
                    >
                      <Plus className="h-4 w-4" />
                      Create new patient: &quot;{patientSearchQuery.trim()}&quot;
                    </button>
                  )}

                  {filteredPatients.length === 0 && !canCreatePatient && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      No patients found.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Choose an existing patient, or create a new patient from the typed name.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="date">Date *</Label>
          <Input id="date" name="date" type="date" defaultValue={defaultDate || appointment?.date || ''} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="time">Time *</Label>
          <Input id="time" name="time" type="time" defaultValue={appointment?.time?.slice(0, 5) || '09:00'} required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="duration_minutes">Duration (min)</Label>
          <Input id="duration_minutes" name="duration_minutes" type="number" defaultValue={appointment?.duration_minutes || 45} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <Select value={appointmentTypeId} onValueChange={handleTypeChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {sortAppointmentTypes(appointmentTypes).map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedType && !selectedType.is_shared && (
        <div className="space-y-2">
          <Label htmlFor="assigned_to">Assigned Staff</Label>
          <Select
            value={canManageExternalStaff ? staffAssignment : (assignedTo ? `internal:${assignedTo}` : UNASSIGNED_ASSIGNEE_VALUE)}
            onValueChange={handleAssigneeChange}
          >
            <SelectTrigger id="assigned_to">
              <SelectValue placeholder="Select staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED_ASSIGNEE_VALUE}>Unassigned</SelectItem>
              {assigneeOptions.map((assignee) => (
                <SelectItem key={assignee.id} value={`internal:${assignee.id}`}>
                  {getAssigneeLabel(assignee)} · {assignee.role}
                </SelectItem>
              ))}
              {canManageExternalStaff && externalStaffOptions.map((staff) => (
                <SelectItem key={staff.id} value={`external:${staff.id}`}>
                  {staff.name} · External Staff
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="fee">Session Fee (₹)</Label>
        <Input
          id="fee"
          name="fee"
          type="number"
          min="0"
          step="0.01"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder="Auto-filled from type"
        />
      </div>

      {appointment && (
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select name="status" defaultValue={appointment.status}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={appointment?.notes ?? ''} />
      </div>

      {!appointment && isCreatingPatient && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Patient Details</CardTitle>
            <CardDescription>
              This patient will be created when you save the appointment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new_patient_name">Name *</Label>
              <Input
                id="new_patient_name"
                value={patientDraft.name}
                onChange={(e) => {
                  updatePatientDraft('name', e.target.value)
                  setPatientSearchQuery(e.target.value)
                }}
                required={isCreatingPatient}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new_patient_phone">Phone *</Label>
              <Input
                id="new_patient_phone"
                type="tel"
                value={patientDraft.phone}
                onChange={(e) => updatePatientDraft('phone', e.target.value)}
                required={isCreatingPatient}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new_patient_email">Email</Label>
              <Input
                id="new_patient_email"
                type="email"
                value={patientDraft.email}
                onChange={(e) => updatePatientDraft('email', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new_patient_dob">Date of Birth</Label>
                <Input
                  id="new_patient_dob"
                  type="date"
                  value={patientDraft.dob}
                  onChange={(e) => updatePatientDraft('dob', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_patient_gender">Gender</Label>
                <Select
                  value={patientDraft.gender || undefined}
                  onValueChange={(value) => updatePatientDraft('gender', value)}
                >
                  <SelectTrigger id="new_patient_gender">
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

            <div className="space-y-2">
              <Label htmlFor="new_patient_address">Address</Label>
              <Textarea
                id="new_patient_address"
                rows={2}
                value={patientDraft.address}
                onChange={(e) => updatePatientDraft('address', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new_patient_medical_history">Medical History</Label>
              <Textarea
                id="new_patient_medical_history"
                rows={3}
                value={patientDraft.medical_history}
                onChange={(e) => updatePatientDraft('medical_history', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new_patient_notes">Patient Notes</Label>
              <Textarea
                id="new_patient_notes"
                rows={2}
                value={patientDraft.notes}
                onChange={(e) => updatePatientDraft('notes', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Saving…</>
        ) : (appointment ? 'Update' : 'Book Appointment')}
      </Button>
    </form>
  )
}
