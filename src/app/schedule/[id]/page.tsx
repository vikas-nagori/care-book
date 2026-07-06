import { getCurrentProfile } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { getAppointmentVisibilityFilter } from '@/lib/access/appointment-visibility'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { logger } from '@/lib/logger'
import { AppointmentDetail } from './appointment-detail'

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const currentProfile = await getCurrentProfile()
  const appointmentVisibilityFilter = getAppointmentVisibilityFilter(currentProfile)
  const supabase = await createClient()

  let appointmentQuery = supabase
    .from('appointments')
    .select('*, patient:patients(id, name, phone, address, medical_history, notes), external_staff:external_staff(id, clinic_id, name, phone, email, notes, status, linked_profile_id, created_by, created_at, updated_at)')
    .eq('id', id)

  if (appointmentVisibilityFilter) {
    appointmentQuery = appointmentQuery.or(appointmentVisibilityFilter)
  }

  const { data: appointment, error: appointmentError } = await appointmentQuery.maybeSingle()

  if (appointmentError) logger.error('AppointmentPage/appointment', appointmentError, { id: id })
  if (!appointment) notFound()

  const normalizedAppointment = {
    ...appointment,
    patient: Array.isArray(appointment.patient)
      ? (appointment.patient[0] ?? null)
      : (appointment.patient ?? null),
    external_staff: Array.isArray(appointment.external_staff)
      ? (appointment.external_staff[0] ?? null)
      : (appointment.external_staff ?? null),
  }

  const { data: sessionNote, error: sessionNoteError } = await supabase
    .from('session_notes')
    .select('*')
    .eq('appointment_id', id)
    .single()

  // PGRST116 = no rows found, expected when no session note exists yet
  if (sessionNoteError && sessionNoteError.code !== 'PGRST116') {
    logger.error('AppointmentPage/sessionNote', sessionNoteError, { id: id })
  }

  const [
    { data: patients, error: patientsError },
    { data: assigneeOptions, error: assigneeOptionsError },
    { data: externalStaffOptions, error: externalStaffOptionsError },
  ] = await Promise.all([
    supabase
      .from('patients')
      .select('id, name')
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

  if (patientsError) logger.error('AppointmentPage/patients', patientsError)
  if (assigneeOptionsError) logger.error('AppointmentPage/assigneeOptions', assigneeOptionsError)
  if (externalStaffOptionsError) logger.error('AppointmentPage/externalStaffOptions', externalStaffOptionsError)

  return (
    <div className="px-4 pb-4 md:p-6">
      <AppointmentDetail
        appointment={normalizedAppointment}
        sessionNote={sessionNote}
        patients={patients ?? []}
        assigneeOptions={assigneeOptions ?? []}
        externalStaffOptions={externalStaffOptions ?? []}
        currentProfileId={currentProfile?.id ?? null}
        canManageExternalStaff={currentProfile?.role === 'admin'}
        canViewPaymentSignals={getRestrictedUiAccess(currentProfile).canViewPaymentSignals}
      />
    </div>
  )
}
