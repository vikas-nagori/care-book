import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { PatientList } from './patient-list'

const PAGE_SIZE = 50

export default async function PatientsPage() {
  const supabase = await createClient()
  const { data: patients, error: patientsError, count } = await supabase
    .from('patients')
    .select('*', { count: 'exact' })
    .order('name')
    .range(0, PAGE_SIZE - 1)

  if (patientsError) logger.error('PatientsPage/patients', patientsError)

  return (
    <div className="p-4 md:p-6">
      <PatientList initialPatients={patients ?? []} totalCount={count ?? 0} pageSize={PAGE_SIZE} />
    </div>
  )
}
