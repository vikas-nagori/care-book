import { getCurrentProfile } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { createClient } from '@/lib/supabase/server'
import { NewAppointmentBackNav } from './back-nav'
import { NewAppointmentForm } from './new-appointment-form'
import { getZonedDate } from '@/lib/timezone'
import { getUserTimeZone } from '@/lib/timezone/server'

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patient_id?: string; from?: string }>
}) {
  const { patient_id, from } = await searchParams
  const userTimeZone = await getUserTimeZone()
  const defaultDate = getZonedDate(new Date(), userTimeZone)
  const currentProfile = await getCurrentProfile()
  const access = getRestrictedUiAccess(currentProfile)
  const supabase = await createClient()
  const [{ data: patients }, { data: doctors }, { data: assigneeOptions }, { data: externalStaffOptions }] = await Promise.all([
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
      .eq('status', 'active')
      .order('full_name'),
    supabase
      .from('external_staff')
      .select('id, clinic_id, name, phone, email, notes, status, linked_profile_id, created_by, created_at, updated_at')
      .order('name'),
  ])

  return (
    <div className="px-4 pb-4 md:p-6">
      <NewAppointmentBackNav from={from} />
      <NewAppointmentForm
        patients={patients ?? []}
        doctors={doctors ?? []}
        assigneeOptions={assigneeOptions ?? []}
        externalStaffOptions={externalStaffOptions ?? []}
        currentProfileId={currentProfile?.id ?? null}
        canManageExternalStaff={currentProfile?.role === 'admin'}
        canViewPaymentSignals={access.canViewPaymentSignals}
        defaultDate={defaultDate}
        defaultPatientId={patient_id}
        from={from}
      />
    </div>
  )
}
