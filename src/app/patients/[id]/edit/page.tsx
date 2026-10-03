import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { PatientForm } from '../../patient-form'

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [{ data: patient }, { data: doctors }, { data: referralPatients }] = await Promise.all([
    supabase.from('patients').select('*').eq('id', id).single(),
    supabase.from('doctors').select('*').order('name'),
    supabase.from('patients').select('id, name, phone').order('name'),
  ])

  if (!patient) notFound()

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">Edit Patient</h1>
      <PatientForm patient={patient} doctors={doctors ?? []} referralPatients={referralPatients ?? []} />
    </div>
  )
}
