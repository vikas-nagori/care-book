import { requirePlatformAdminUser } from '@/lib/platform/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ClinicOnboardingRequest } from '@/lib/supabase/types'
import { ClinicRequestsList } from './clinic-requests-list'

export default async function PlatformClinicRequestsPage() {
  await requirePlatformAdminUser()
  const adminSupabase = createAdminClient()
  const { data: requests } = await adminSupabase
    .from('clinic_onboarding_requests')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Clinic Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review new clinic onboarding requests.
        </p>
      </div>
      <ClinicRequestsList requests={(requests ?? []) as ClinicOnboardingRequest[]} />
    </div>
  )
}
