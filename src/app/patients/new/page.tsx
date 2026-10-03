import { createClient } from '@/lib/supabase/server'
import { PatientForm } from '../patient-form'

export default async function NewPatientPage() {
  const supabase = await createClient()
  const [{ data: doctors }, { data: referralPatients }] = await Promise.all([
    supabase.from('doctors').select('*').order('name'),
    supabase.from('patients').select('id, name, phone').order('name'),
  ])

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">New Patient</h1>
      <PatientForm doctors={doctors ?? []} referralPatients={referralPatients ?? []} />
    </div>
  )
}
