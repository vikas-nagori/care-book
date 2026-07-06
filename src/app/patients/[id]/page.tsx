import { getCurrentProfile } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { getAppointmentVisibilityFilter } from '@/lib/access/appointment-visibility'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { logger } from '@/lib/logger'
import { PatientDetail } from './patient-detail'

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const currentProfile = await getCurrentProfile()
  const access = getRestrictedUiAccess(currentProfile)
  const appointmentVisibilityFilter = getAppointmentVisibilityFilter(currentProfile)
  const supabase = await createClient()

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('*, referred_by_doctor:doctors(id, name, specialty, address)')
    .eq('id', id)
    .single()

  if (patientError) logger.error('PatientPage/patient', patientError, { id: id })
  if (!patient) notFound()

  const normalizedPatient = {
    ...patient,
    referred_by_doctor: Array.isArray(patient.referred_by_doctor)
      ? (patient.referred_by_doctor[0] ?? null)
      : (patient.referred_by_doctor ?? null),
  }

  let appointmentsQuery = supabase
    .from('appointments')
    .select('id, date, time, duration_minutes, type, status')
    .eq('patient_id', id)
    .order('date', { ascending: false })

  if (appointmentVisibilityFilter) {
    appointmentsQuery = appointmentsQuery.or(appointmentVisibilityFilter)
  }

  const [
    { data: appointments, error: appointmentsError },
    { data: treatmentPlans, error: treatmentPlansError },
    { data: packages, error: packagesError },
    { data: payments, error: paymentsError },
    { data: outstandingAppts, error: outstandingError },
  ] = await Promise.all([
    appointmentsQuery,
    supabase
      .from('treatment_plans')
      .select('*')
      .eq('patient_id', id)
      .order('created_at', { ascending: false }),
    access.canViewBilling
      ? supabase
          .from('packages')
          .select('*')
          .eq('patient_id', id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    access.canViewBilling
      ? supabase
          .from('payments')
          .select('*')
          .eq('patient_id', id)
          .order('date', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    access.canViewBilling
      ? supabase
          .from('appointments')
          .select('fee')
          .eq('patient_id', id)
          .eq('status', 'completed')
          .eq('payment_status', 'unpaid')
          .not('fee', 'is', null)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (appointmentsError) logger.error('PatientPage/appointments', appointmentsError, { id: id })
  if (treatmentPlansError) logger.error('PatientPage/treatmentPlans', treatmentPlansError, { id: id })
  if (packagesError && access.canViewBilling) logger.error('PatientPage/packages', packagesError, { id: id })
  if (paymentsError && access.canViewBilling) logger.error('PatientPage/payments', paymentsError, { id: id })
  if (outstandingError && access.canViewBilling) logger.error('PatientPage/outstanding', outstandingError, { id: id })

  const outstanding = (outstandingAppts ?? []).reduce((s, a) => s + Number((a as { fee: number | null }).fee ?? 0), 0)

  return (
    <div className="px-4 pb-4 md:p-6">
      <PatientDetail
        canViewBilling={access.canViewBilling}
        patient={normalizedPatient}
        appointments={appointments ?? []}
        treatmentPlans={treatmentPlans ?? []}
        packages={packages ?? []}
        payments={payments ?? []}
        outstanding={outstanding}
      />
    </div>
  )
}
