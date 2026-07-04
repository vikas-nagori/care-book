import { getCurrentProfile } from '@/lib/auth'
import { normalizeEmail } from '@/lib/onboarding/invite-helpers'
import { redirect } from 'next/navigation'
import { getSettingsAccessLevel } from '@/lib/settings/access'
import { createClient } from '@/lib/supabase/server'
import { AccountSummary } from './account-summary'
import { logoutFromSettings } from './actions'
import { InviteForm } from './invite-form'
import { SettingsForm } from './settings-form'
import { ExternalStaffList } from './external-staff-list'
import { UserInvitesList } from './user-invites-list'
import { UsersList } from './users-list'

export default async function SettingsPage() {
  const currentProfile = await getCurrentProfile()
  const accessLevel = getSettingsAccessLevel(currentProfile)

  if (accessLevel === 'unauthenticated' || !currentProfile) {
    redirect('/')
  }

  if (accessLevel === 'profile_only') {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <AccountSummary profile={currentProfile} logoutAction={logoutFromSettings} />
      </div>
    )
  }

  const supabase = await createClient()
  const [
    { data: settings },
    { data: profiles },
    { data: invites },
    { data: externalStaff, error: externalStaffError },
  ] = await Promise.all([
    supabase.from('global_settings').select('*').single(),
    supabase.from('profiles').select('*').order('created_at'),
    supabase.from('user_invites').select('*').order('created_at', { ascending: false }),
    supabase
      .from('external_staff')
      .select('id, name, phone, email, notes, status, linked_profile_id, created_by, created_at, updated_at')
      .order('created_at', { ascending: false }),
  ])

  const pendingInviteEmails = new Set(
    (invites ?? [])
      .filter((invite) => invite.status === 'pending')
      .map((invite) => normalizeEmail(invite.email))
  )

  const activeProfiles =
    profiles?.filter((profile) => !pendingInviteEmails.has(normalizeEmail(profile.email))) ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <AccountSummary profile={currentProfile} logoutAction={logoutFromSettings} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SettingsForm settings={settings} />
          <InviteForm />
        </div>
        <div className="space-y-6">
          <ExternalStaffList
            externalStaff={externalStaff ?? []}
            invites={invites ?? []}
            isSchemaMissing={externalStaffError?.code === 'PGRST205'}
          />
          <UserInvitesList invites={invites ?? []} />
          <UsersList profiles={activeProfiles} />
        </div>
      </div>
    </div>
  )
}
