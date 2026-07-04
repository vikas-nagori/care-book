import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { NewAppointmentBackNav } from './back-nav'
import { NewAppointmentForm } from './new-appointment-form'
import { format } from 'date-fns'

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: { patient_id?: string; from?: string }
}) {
  const currentProfile = await getCurrentProfile()
  const supabase = await createClient()
  const [{ data: patients }, { data: assigneeOptions }, { data: externalStaffOptions }] = await Promise.all([
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
      .select('id, name, phone, email, notes, status, linked_profile_id, created_by, created_at, updated_at')
      .order('name'),
  ])

  return (
    <div className="px-4 pb-4 md:p-6">
      <NewAppointmentBackNav from={searchParams.from} />
      <NewAppointmentForm
        patients={patients ?? []}
        assigneeOptions={assigneeOptions ?? []}
        externalStaffOptions={externalStaffOptions ?? []}
        currentProfileId={currentProfile?.id ?? null}
        canManageExternalStaff={currentProfile?.role === 'admin'}
        defaultDate={format(new Date(), 'yyyy-MM-dd')}
        defaultPatientId={searchParams.patient_id}
        from={searchParams.from}
      />
    </div>
  )
}
