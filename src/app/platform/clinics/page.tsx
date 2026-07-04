import { requirePlatformAdminUser } from '@/lib/platform/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Clinic, PlatformClinicSummary } from '@/lib/supabase/types'
import { ClinicsList } from './clinics-list'

function tallyByClinic(rows: { clinic_id: string | null }[] | null): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows ?? []) {
    if (!row.clinic_id) continue
    counts.set(row.clinic_id, (counts.get(row.clinic_id) ?? 0) + 1)
  }
  return counts
}

export default async function PlatformClinicsPage() {
  await requirePlatformAdminUser()
  const adminSupabase = createAdminClient()

  const [{ data: clinics }, { data: profiles }, { data: patients }] = await Promise.all([
    adminSupabase.from('clinics').select('*').order('created_at', { ascending: false }),
    adminSupabase.from('profiles').select('clinic_id'),
    adminSupabase.from('patients').select('clinic_id'),
  ])

  const userCounts = tallyByClinic(profiles)
  const patientCounts = tallyByClinic(patients)

  const summaries: PlatformClinicSummary[] = ((clinics ?? []) as Clinic[]).map((clinic) => ({
    ...clinic,
    user_count: userCounts.get(clinic.id) ?? 0,
    patient_count: patientCounts.get(clinic.id) ?? 0,
  }))

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Clinics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Block a clinic to sign out and lock out all of its users. Unblock to restore access.
        </p>
      </div>
      <ClinicsList clinics={summaries} />
    </div>
  )
}
