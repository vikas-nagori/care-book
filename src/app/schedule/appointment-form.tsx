'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import { format, getDay, isValid, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ReferralFields, useReferralSelection } from '@/components/referral/referral-fields'
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
import type { Appointment, AppointmentAssigneeOption, AppointmentType, Doctor, ExternalStaff } from '@/lib/supabase/types'
import { defaultAppointmentType, sortAppointmentTypes } from '@/lib/appointments/appointment-type'
import { normalizeAppointmentAssignment, parseStaffAssignmentValue } from '@/lib/appointments/assignment'
import { generateRecurringAppointmentDates } from '@/lib/appointments/recurrence'
import { resolveAppointmentStatus } from '@/lib/appointments/appointment-creation'
import { CLINIC_TIME_ZONE, getZonedDate } from '@/lib/timezone'
import type { DashboardAppointmentTypeOption } from '@/lib/dashboard/appointment-options'
import { createAppointment } from './actions'
import type { NewPatientInput } from './actions'

const UNASSIGNED_ASSIGNEE_VALUE = '__unassigned__'
const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

type AppointmentFormAppointment = Omit<Appointment, 'fee' | 'payment_status' | 'patient' | 'creator' | 'assignee' | 'external_staff'> &
  Partial<Pick<Appointment, 'fee' | 'payment_status'>>

type AppointmentFormBaseProps = {
  patients: AppointmentPatientOption[]
  doctors?: Doctor[]
  assigneeOptions?: AppointmentAssigneeOption[]
  externalStaffOptions?: ExternalStaff[]
  currentProfileId?: string | null
  canManageExternalStaff?: boolean
  defaultDate?: string
  defaultPatientId?: string
  appointment?: AppointmentFormAppointment
  onSuccess?: () => void
}

type AppointmentFormProps = AppointmentFormBaseProps & (
  | {
      canViewPaymentSignals: true
      initialAppointmentTypes?: AppointmentType[]
    }
  | {
      canViewPaymentSignals: false
      initialAppointmentTypes?: DashboardAppointmentTypeOption[]
    }
)

function getAppointmentTypeSessionRate(type: DashboardAppointmentTypeOption): number | null {
  if (!('session_rate' in type)) return null
  return Number.isFinite(type.session_rate) && type.session_rate >= 0
    ? type.session_rate
    : null
}

function getAssigneeLabel(assignee: AppointmentAssigneeOption) {
  return assignee.full_name || assignee.email
}

export function AppointmentForm({
  patients,
  doctors = [],
  assigneeOptions = [],
  externalStaffOptions = [],
  currentProfileId = null,
  canManageExternalStaff = false,
  canViewPaymentSignals,
  initialAppointmentTypes,
  defaultDate,
  defaultPatientId,
  appointment,
  onSuccess,
}: AppointmentFormProps) {
  const supabase = createClient()
  const { toast } = useToast()
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [appointmentTypes, setAppointmentTypes] = useState<DashboardAppointmentTypeOption[]>(
    () => initialAppointmentTypes ?? [],
  )
  const [appointmentTypeId, setAppointmentTypeId] = useState<string>(appointment?.appointment_type_id ?? '')
  const [assignedTo, setAssignedTo] = useState(appointment?.assigned_to ?? '')
  const initialStaffAssignment = appointment?.external_staff_id
    ? `external:${appointment.external_staff_id}`
    : appointment?.assigned_to
      ? `internal:${appointment.assigned_to}`
      : UNASSIGNED_ASSIGNEE_VALUE
  const [staffAssignment, setStaffAssignment] = useState(initialStaffAssignment)
  const [fee, setFee] = useState<string>(
    canViewPaymentSignals ? appointment?.fee?.toString() || '' : '',
  )
  const [appointmentDate, setAppointmentDate] = useState(appointment?.date || defaultDate || '')
  const [repeatAppointment, setRepeatAppointment] = useState(false)
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([])
  const [totalSessions, setTotalSessions] = useState('10')

  const selectedType = appointmentTypes.find((type) => type.id === appointmentTypeId) ?? null
  const isSharedType = selectedType?.is_shared ?? false
  const initialSelectedPatientId = appointment?.patient_id || defaultPatientId || ''
  const initialSelectedPatient = patients.find((patient) => patient.id === initialSelectedPatientId) ?? null
  const [selectedPatientId, setSelectedPatientId] = useState(initialSelectedPatientId)
  const [patientSearchQuery, setPatientSearchQuery] = useState(initialSelectedPatient?.name || '')
  const [patientSearchOpen, setPatientSearchOpen] = useState(false)
  const [isCreatingPatient, setIsCreatingPatient] = useState(false)
  const [patientDraft, setPatientDraft] = useState<AppointmentPatientDraft>(createPatientDraftFromName(''))
  const referral = useReferralSelection()

  const filteredPatients = useMemo(
    () => filterAppointmentPatientOptions(patients, patientSearchQuery).slice(0, 8),
    [patients, patientSearchQuery],
  )
  const canCreatePatient = shouldOfferCreatePatientOption(patients, patientSearchQuery)
  const recurringSchedule = useMemo(() => {
    if (!repeatAppointment) return { dates: [] as string[], error: null as string | null }
    try {
      return {
        dates: generateRecurringAppointmentDates({
          startDate: appointmentDate,
          weekdays: selectedWeekdays,
          totalSessions: Number(totalSessions),
        }),
        error: null,
      }
    } catch (error) {
      return {
        dates: [] as string[],
        error: error instanceof Error ? error.message : 'The repeat schedule is invalid.',
      }
    }
  }, [appointmentDate, repeatAppointment, selectedWeekdays, totalSessions])
  const recurringDates = recurringSchedule.dates

  // Resolved after mount rather than during render: the clinic date is clock-derived, and deriving
  // it on the server too would let a booking made across midnight hydrate with a different answer.
  const [clinicToday, setClinicToday] = useState<string | null>(null)
  useEffect(() => { setClinicToday(getZonedDate(new Date(), CLINIC_TIME_ZONE)) }, [])
  const backdatedDates = clinicToday && !appointment
    ? (recurringDates.length > 0 ? recurringDates : [appointmentDate])
        .filter((date) => date && resolveAppointmentStatus(date, clinicToday) === 'completed')
    : []

  // Load the clinic's appointment types once on mount
  useEffect(() => {
    if (initialAppointmentTypes !== undefined) {
      if (!appointment) {
        const def = defaultAppointmentType(initialAppointmentTypes)
        if (def) {
          setAppointmentTypeId(def.id)
          if (canViewPaymentSignals) {
            const rate = getAppointmentTypeSessionRate(def)
            setFee((current) => current || (rate === null ? '' : String(rate)))
          }
        }
      }
      return
    }

    const appointmentTypesQuery = canViewPaymentSignals
      ? supabase.from('appointment_types').select('*')
      : supabase
          .from('appointment_types')
          .select('id, clinic_id, name, is_shared, is_default, sort_order, created_at')

    appointmentTypesQuery.order('sort_order').then(({ data }) => {
      if (!data) return
      const types = data as DashboardAppointmentTypeOption[]
      setAppointmentTypes(types)
      // For new appointments, default to a sensible type and auto-fill its rate.
      if (!appointment) {
        const def = defaultAppointmentType(types)
        if (def) {
          setAppointmentTypeId(def.id)
          if (canViewPaymentSignals) {
            const rate = getAppointmentTypeSessionRate(def)
            setFee((current) => current || (rate === null ? '' : String(rate)))
          }
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
    if (!appointment && type && canViewPaymentSignals) {
      const rate = getAppointmentTypeSessionRate(type)
      setFee(rate === null ? '' : String(rate))
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

  function toggleRepeatAppointment() {
    const next = !repeatAppointment
    if (next && selectedWeekdays.length === 0) {
      const parsedDate = parseISO(appointmentDate)
      if (isValid(parsedDate)) setSelectedWeekdays([getDay(parsedDate)])
    }
    setRepeatAppointment(next)
  }

  function toggleWeekday(weekday: number) {
    setSelectedWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((candidate) => candidate !== weekday)
        : [...current, weekday],
    )
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const patientId = selectedPatientId
    const parsedFee = fee.trim() === '' ? null : Number(fee)
    const normalizedFee = Number.isFinite(parsedFee) ? parsedFee : null
    let newPatient: NewPatientInput | null = null

    if (!appointmentTypeId) {
      toast({
        title: 'Appointment type required',
        description: 'Choose an appointment type before saving.',
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    if (!appointment && canViewPaymentSignals && normalizedFee === null) {
      toast({
        title: 'Session fee required',
        description: 'Choose a type with a default rate or enter a session fee before booking.',
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    if (!appointment && repeatAppointment && recurringSchedule.error) {
      toast({
        title: 'Repeat schedule required',
        description: recurringSchedule.error,
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    if (!appointment && isCreatingPatient) {
      const basePatientData = buildPatientInsertData(patientDraft)

      if (!basePatientData.name || !basePatientData.phone) {
        toast({
          title: 'Patient details required',
          description: 'Please enter at least the patient name and phone number.',
          variant: 'destructive',
        })
        setLoading(false)
        return
      }

      const resolvedReferral = await referral.resolveReferral()
      if (!resolvedReferral) {
        setLoading(false)
        return
      }

      newPatient = {
        ...basePatientData,
        referral_source: referral.referralSource || null,
        ...resolvedReferral,
      }
    }

    if (!patientId && !newPatient) {
      toast({
        title: 'Patient required',
        description: 'Select an existing patient or create a new patient before booking.',
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

    const time = formData.get('time') as string
    const durationMinutes = parseInt(formData.get('duration_minutes') as string) || 45
    const notes = (formData.get('notes') as string) || null

    if (appointment) {
      const { error } = await supabase
        .from('appointments')
        .update({
          patient_id: patientId,
          date: appointmentDate,
          time,
          duration_minutes: durationMinutes,
          appointment_type_id: appointmentTypeId,
          status: (formData.get('status') as string) || 'scheduled',
          ...(canViewPaymentSignals ? { fee: normalizedFee } : {}),
          assigned_to: assignment.assigned_to,
          external_staff_id: assignment.external_staff_id,
          notes,
        })
        .eq('id', appointment.id)

      if (error) {
        logger.error('AppointmentForm/save', error, { appointmentId: appointment.id, patientId })
        toast({ title: 'Error', description: error.message, variant: 'destructive' })
        setLoading(false)
        return
      }

      toast({
        title: 'Appointment updated',
      })
      setLoading(false)
      onSuccess?.()
      return
    }

    const result = await createAppointment({
      patientId: patientId || undefined,
      newPatient,
      date: appointmentDate,
      time,
      durationMinutes,
      appointmentTypeId,
      fee: normalizedFee,
      assignedTo: assignment.assigned_to,
      externalStaffId: assignment.external_staff_id,
      notes,
      recurrence: repeatAppointment
        ? { weekdays: selectedWeekdays, totalSessions: Number(totalSessions) }
        : null,
    })

    if (!result.success) {
      const conflictDetails = result.conflictingDates?.length
        ? ` Conflicting dates: ${result.conflictingDates.map((date) => format(parseISO(date), 'dd MMM yyyy')).join(', ')}.`
        : ''
      if (result.createdPatientId && newPatient) {
        setSelectedPatientId(result.createdPatientId)
        setPatientSearchQuery(newPatient.name)
        setIsCreatingPatient(false)
        setPatientDraft(createPatientDraftFromName(''))
      }
      toast({
        title: result.createdPatientId ? 'Patient added, appointment not booked' : 'Appointment not booked',
        description: result.createdPatientId
          ? `The patient was added, but the appointment could not be saved: ${result.message}${conflictDetails}`
          : `${result.message}${conflictDetails}`,
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    toast({
      title: result.appointmentIds.length > 1
        ? `${result.appointmentIds.length} appointments booked`
        : newPatient
          ? 'Patient added and appointment booked'
          : 'Appointment booked',
    })
    setLoading(false)
    onSuccess?.()
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
          <Input
            id="date"
            name="date"
            type="date"
            value={appointmentDate}
            onChange={(event) => setAppointmentDate(event.target.value)}
            required
          />
          {backdatedDates.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="backdated-status-hint">
              {backdatedDates.length === 1
                ? 'This date has already passed — the session will be saved as completed.'
                : `${backdatedDates.length} of these dates have already passed — those sessions will be saved as completed.`}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="time">Time *</Label>
          <Input id="time" name="time" type="time" defaultValue={appointment?.time?.slice(0, 5) || '09:00'} required />
        </div>
      </div>

      {!appointment && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Repeat appointment</p>
                <p className="text-xs text-muted-foreground">Book the same time, details, and rate on selected weekdays.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={repeatAppointment}
                onClick={toggleRepeatAppointment}
                className={cn(
                  'relative h-7 w-12 shrink-0 rounded-full transition-colors',
                  repeatAppointment ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 h-5 w-5 rounded-full bg-background shadow transition-transform',
                    repeatAppointment ? 'left-6' : 'left-1',
                  )}
                />
                <span className="sr-only">Toggle repeat appointment</span>
              </button>
            </div>

            {repeatAppointment && (
              <div className="mt-4 space-y-4 border-t pt-4">
                <div className="space-y-2">
                  <Label>Repeat on *</Label>
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAYS.map((weekday) => {
                      const selected = selectedWeekdays.includes(weekday.value)
                      return (
                        <button
                          key={weekday.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleWeekday(weekday.value)}
                          className={cn(
                            'min-h-11 rounded-md border text-[11px] font-medium transition-colors',
                            selected
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-input bg-background text-muted-foreground',
                          )}
                        >
                          {weekday.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="total_sessions">Total sessions *</Label>
                  <Input
                    id="total_sessions"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    step={1}
                    value={totalSessions}
                    onChange={(event) => setTotalSessions(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Maximum 100 appointments.</p>
                </div>

                {recurringSchedule.error ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    {recurringSchedule.error}
                  </p>
                ) : recurringDates.length > 0 ? (
                  <p className="rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800">
                    <strong>{recurringDates.length} appointments</strong>
                    {' · '}
                    {format(parseISO(recurringDates[0]), 'dd MMM yyyy')}
                    {' – '}
                    {format(parseISO(recurringDates[recurringDates.length - 1]), 'dd MMM yyyy')}
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="duration_minutes">Duration (min)</Label>
          <Input id="duration_minutes" name="duration_minutes" type="number" defaultValue={appointment?.duration_minutes || 45} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <Select value={appointmentTypeId} onValueChange={handleTypeChange}>
            <SelectTrigger id="type">
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

      {canViewPaymentSignals && (
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
      )}

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

            <ReferralFields referral={referral} doctors={doctors} patients={patients} />
          </CardContent>
        </Card>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Saving…</>
        ) : appointment ? (
          'Update'
        ) : repeatAppointment && recurringDates.length > 0 ? (
          <>Book {recurringDates.length} appointments</>
        ) : (
          'Book Appointment'
        )}
      </Button>
    </form>
  )
}
