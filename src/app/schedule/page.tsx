import { getCurrentProfile } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { getAppointmentVisibilityFilter } from '@/lib/access/appointment-visibility'
import { createClient } from '@/lib/supabase/server'
import { resolveScheduleDateRange } from '@/lib/schedule/date-range'
import { logger } from '@/lib/logger'
import { ScheduleView } from './schedule-view'
import type { Appointment, ExternalStaff } from '@/lib/supabase/types'

type ScheduleAppointmentRow = Pick<
  Appointment,
  'id' | 'patient_id' | 'date' | 'time' | 'duration_minutes' | 'type' | 'type_is_shared' | 'status'
> & {
  payment_status?: Appointment['payment_status']
  assigned_to?: string | null
  external_staff_id?: string | null
  patient: { id: string; name: string; phone: string }[] | { id: string; name: string; phone: string } | null
  external_staff?: Pick<ExternalStaff, 'id' | 'name' | 'phone' | 'status' | 'linked_profile_id'>[] | Pick<ExternalStaff, 'id' | 'name' | 'phone' | 'status' | 'linked_profile_id'> | null
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>
}) {
  const { date } = await searchParams
  const { selectedDate, rangeStart, rangeEnd } = resolveScheduleDateRange(date)
  const currentProfile = await getCurrentProfile()
  const access = getRestrictedUiAccess(currentProfile)
  const appointmentVisibilityFilter = getAppointmentVisibilityFilter(currentProfile)
  const supabase = await createClient()

  let appointmentsQuery = access.canViewPaymentSignals
    ? supabase
        .from('appointments')
        .select('id, patient_id, date, time, duration_minutes, type, type_is_shared, status, payment_status, assigned_to, external_staff_id, patient:patients(id, name, phone), external_staff:external_staff(id, clinic_id, name, phone, status, linked_profile_id)')
        .gte('date', rangeStart)
        .lte('date', rangeEnd)
        .order('date')
        .order('time')
    : supabase
        .from('appointments')
        .select('id, patient_id, date, time, duration_minutes, type, type_is_shared, status, assigned_to, external_staff_id, patient:patients(id, name, phone), external_staff:external_staff(id, clinic_id, name, phone, status, linked_profile_id)')
        .gte('date', rangeStart)
        .lte('date', rangeEnd)
        .order('date')
        .order('time')

  if (appointmentVisibilityFilter) {
    appointmentsQuery = appointmentsQuery.or(appointmentVisibilityFilter)
  }

  const [
    { data: appointments, error: appointmentsError },
    { data: patients, error: patientsError },
    { data: doctors, error: doctorsError },
    { data: assigneeOptions, error: assigneeOptionsError },
    { data: externalStaffOptions, error: externalStaffOptionsError },
  ] = await Promise.all([
    appointmentsQuery,
    supabase
      .from('patients')
      .select('id, name')
      .order('name'),
    supabase
      .from('doctors')
      .select('*')
      .order('name'),
    supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .order('full_name'),
    supabase
      .from('external_staff')
      .select('id, clinic_id, name, phone, email, notes, status, linked_profile_id, created_by, created_at, updated_at')
      .order('name'),
  ])

  if (appointmentsError) logger.error('SchedulePage/appointments', appointmentsError)
  if (patientsError) logger.error('SchedulePage/patients', patientsError)
  if (doctorsError) logger.error('SchedulePage/doctors', doctorsError)
  if (assigneeOptionsError) logger.error('SchedulePage/assigneeOptions', assigneeOptionsError)
  if (externalStaffOptionsError) logger.error('SchedulePage/externalStaffOptions', externalStaffOptionsError)

  const normalizedAppointments = ((appointments ?? []) as ScheduleAppointmentRow[]).map((appointment) => ({
    ...appointment,
    patient: Array.isArray(appointment.patient)
      ? (appointment.patient[0] ?? null)
      : (appointment.patient ?? null),
    external_staff: Array.isArray(appointment.external_staff)
      ? (appointment.external_staff[0] ?? null)
      : (appointment.external_staff ?? null),
  }))

  return (
    <div className="p-4 md:p-6">
      <ScheduleView
        initialSelectedDate={selectedDate}
        initialAppointments={normalizedAppointments}
        patients={patients ?? []}
        doctors={doctors ?? []}
        assigneeOptions={assigneeOptions ?? []}
        externalStaffOptions={externalStaffOptions ?? []}
        currentProfileId={currentProfile?.id ?? null}
        canManageExternalStaff={currentProfile?.role === 'admin'}
        canViewPaymentSignals={access.canViewPaymentSignals}
      />
    </div>
  )
}
