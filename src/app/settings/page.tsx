import { getCurrentProfile } from '@/lib/auth'
import { normalizeEmail } from '@/lib/onboarding/invite-helpers'
import { redirect } from 'next/navigation'
import { getSettingsAccessLevel } from '@/lib/settings/access'
import { createClient } from '@/lib/supabase/server'
import type { ConnectedMcpApp } from '@/lib/supabase/types'
import { logoutFromSettings, revokeConnectedMcpApp } from './actions'
import { SettingsResponsiveView } from './responsive-settings-view'

async function loadConnectedApps(): Promise<ConnectedMcpApp[]> {
  const supabase = await createClient()
  const { data: grants, error } = await supabase
    .from('mcp_access_grants')
    .select('id, client_id, scopes, created_at, last_used_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error || !grants?.length) return []
  const clientIds = [...new Set(grants.map((grant) => grant.client_id))]
  const { data: clients } = await supabase
    .from('mcp_oauth_clients')
    .select('client_id, client_name')
    .in('client_id', clientIds)
  const names = new Map((clients ?? []).map((client) => [client.client_id, client.client_name || client.client_id]))
  return grants.map((grant) => ({ ...grant, client_name: names.get(grant.client_id) ?? grant.client_id })) as ConnectedMcpApp[]
}

export default async function SettingsPage() {
  const currentProfile = await getCurrentProfile()
  const accessLevel = getSettingsAccessLevel(currentProfile)

  if (accessLevel === 'unauthenticated' || !currentProfile) {
    redirect('/')
  }

  if (accessLevel === 'profile_only') {
    const connectedApps = await loadConnectedApps()
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <SettingsResponsiveView
          accessLevel="profile_only"
          profile={currentProfile}
          logoutAction={logoutFromSettings}
          connectedApps={connectedApps}
          revokeConnectedAppAction={revokeConnectedMcpApp}
        />
      </div>
    )
  }

  const supabase = await createClient()
  const connectedApps = await loadConnectedApps()
  const [
    { data: appointmentTypes },
    { data: profiles },
    { data: invites },
    { data: externalStaff, error: externalStaffError },
    { data: packageTemplates },
    { data: globalSettings },
  ] = await Promise.all([
    supabase.from('appointment_types').select('*').order('sort_order'),
    supabase.from('profiles').select('*').eq('status', 'active').order('created_at'),
    supabase.from('user_invites').select('*').order('created_at', { ascending: false }),
    supabase
      .from('external_staff')
      .select('id, clinic_id, name, phone, email, notes, status, linked_profile_id, created_by, created_at, updated_at')
      .order('created_at', { ascending: false }),
    supabase.from('package_templates').select('*').order('created_at', { ascending: false }),
    supabase.from('global_settings').select('*').maybeSingle(),
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
      <SettingsResponsiveView
        accessLevel="admin"
        profile={currentProfile}
        logoutAction={logoutFromSettings}
        connectedApps={connectedApps}
        revokeConnectedAppAction={revokeConnectedMcpApp}
        appointmentTypes={appointmentTypes ?? []}
        settings={globalSettings ?? null}
        packageTemplates={packageTemplates ?? []}
        externalStaff={externalStaff ?? []}
        invites={invites ?? []}
        profiles={activeProfiles}
        isExternalStaffSchemaMissing={externalStaffError?.code === 'PGRST205'}
      />
    </div>
  )
}
