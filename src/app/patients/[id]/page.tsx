import { getCurrentProfile } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { getAppointmentVisibilityFilter } from '@/lib/access/appointment-visibility'
import { parseAppointmentPage } from '@/lib/patients/appointment-pagination'
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { logger } from '@/lib/logger'
import { PatientDetail } from './patient-detail'
import { getZonedDate } from '@/lib/timezone'
import { getUserTimeZone } from '@/lib/timezone/server'

const APPOINTMENTS_PAGE_SIZE = 20

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; appointments_page?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const appointmentPage = parseAppointmentPage(query.appointments_page)
  const appointmentRangeStart = (appointmentPage - 1) * APPOINTMENTS_PAGE_SIZE
  const appointmentRangeEnd = appointmentRangeStart + APPOINTMENTS_PAGE_SIZE - 1
  const currentProfile = await getCurrentProfile()
  const access = getRestrictedUiAccess(currentProfile)
  const appointmentVisibilityFilter = getAppointmentVisibilityFilter(currentProfile)
  const supabase = await createClient()
  const userTimeZone = await getUserTimeZone()
  const defaultDate = getZonedDate(new Date(), userTimeZone)

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('*, referred_by_doctor:doctors(id, name, specialty, address), referred_by_patient:patients!patients_referred_by_patient_id_fkey(id, name)')
    .eq('id', id)
    .single()

  if (patientError) logger.error('PatientPage/patient', patientError, { id: id })
  if (!patient) notFound()

  const normalizedPatient = {
    ...patient,
    referred_by_doctor: Array.isArray(patient.referred_by_doctor)
      ? (patient.referred_by_doctor[0] ?? null)
      : (patient.referred_by_doctor ?? null),
    referred_by_patient: Array.isArray(patient.referred_by_patient)
      ? (patient.referred_by_patient[0] ?? null)
      : (patient.referred_by_patient ?? null),
  }

  let appointmentsQuery = supabase
    .from('appointments')
    .select('id, date, time, duration_minutes, type, status', { count: 'exact' })
    .eq('patient_id', id)
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .order('id', { ascending: false })
    .range(appointmentRangeStart, appointmentRangeEnd)

  if (appointmentVisibilityFilter) {
    appointmentsQuery = appointmentsQuery.or(appointmentVisibilityFilter)
  }

  // Count excludes cancelled appointments (they still appear in the list, just not the total).
  let activeCountQuery = supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', id)
    .neq('status', 'cancelled')

  if (appointmentVisibilityFilter) {
    activeCountQuery = activeCountQuery.or(appointmentVisibilityFilter)
  }

  const [
    { data: appointments, error: appointmentsError, count: appointmentsCount },
    { error: activeCountError, count: appointmentsActiveCount },
    { data: treatmentPlans, error: treatmentPlansError },
    { data: packages, error: packagesError },
    { data: payments, error: paymentsError },
    { data: patientBalance, error: balanceError },
    { data: packageBalances, error: packageBalancesError },
  ] = await Promise.all([
    appointmentsQuery,
    activeCountQuery,
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
      ? supabase.from('patient_billing_balances_v2').select('*').eq('patient_id', id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    access.canViewBilling
      ? supabase.from('package_billing_balances_v2').select('*').eq('patient_id', id)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (appointmentsError) logger.error('PatientPage/appointments', appointmentsError, { id: id })
  if (activeCountError) logger.error('PatientPage/appointmentsActiveCount', activeCountError, { id: id })
  if (treatmentPlansError) logger.error('PatientPage/treatmentPlans', treatmentPlansError, { id: id })
  if (packagesError && access.canViewBilling) logger.error('PatientPage/packages', packagesError, { id: id })
  if (paymentsError && access.canViewBilling) logger.error('PatientPage/payments', paymentsError, { id: id })
  if (balanceError && access.canViewBilling) logger.error('PatientPage/balance', balanceError, { id: id })
  if (packageBalancesError && access.canViewBilling) logger.error('PatientPage/packageBalances', packageBalancesError, { id: id })

  const appointmentTotalPages = Math.max(1, Math.ceil((appointmentsCount ?? 0) / APPOINTMENTS_PAGE_SIZE))
  if (appointmentPage > appointmentTotalPages) {
    redirect(`/patients/${id}?tab=appointments&appointments_page=${appointmentTotalPages}`)
  }

  return (
    <div className="px-4 pb-4 md:p-6">
      <PatientDetail
        defaultDate={defaultDate}
        canViewBilling={access.canViewBilling}
        patient={normalizedPatient}
        appointments={appointments ?? []}
        appointmentsTotalCount={appointmentsCount ?? 0}
        appointmentsActiveCount={appointmentsActiveCount ?? 0}
        isAdmin={currentProfile?.role === 'admin'}
        appointmentPage={appointmentPage}
        appointmentPageSize={APPOINTMENTS_PAGE_SIZE}
        initialTab={query.tab === 'appointments' || query.appointments_page ? 'appointments' : 'profile'}
        treatmentPlans={treatmentPlans ?? []}
        packages={packages ?? []}
        payments={payments ?? []}
        patientBalance={patientBalance ?? null}
        packageBalances={Object.fromEntries((packageBalances ?? []).map((balance) => [balance.package_id, balance]))}
      />
    </div>
  )
}
