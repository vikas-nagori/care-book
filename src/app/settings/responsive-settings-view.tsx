'use client'

import { useSyncExternalStore } from 'react'
import {
  getSettingsServerSnapshot,
  SETTINGS_DESKTOP_MEDIA_QUERY,
} from '@/lib/settings/responsive-layout'
import type {
  AppointmentType,
  ExternalStaff,
  GlobalSettings,
  PackageTemplate,
  Profile,
  UserInvite,
} from '@/lib/supabase/types'
import { GuidedTourLauncher } from '@/components/tour/guided-tour-launcher'
import { AccountSummary } from './account-summary'
import { AppointmentTypesList } from './appointment-types-list'
import { ExternalStaffList } from './external-staff-list'
import { InviteForm } from './invite-form'
import { MobileSettingsView } from './mobile-settings-view'
import { PackageTemplatesList } from './package-templates-list'
import { SettingsForm } from './settings-form'
import { UserInvitesList } from './user-invites-list'
import { UsersList } from './users-list'

type ResponsiveSettingsViewProps = {
  accessLevel: 'admin' | 'profile_only'
  profile: Profile
  logoutAction: () => Promise<void>
  appointmentTypes?: AppointmentType[]
  settings?: GlobalSettings | null
  packageTemplates?: PackageTemplate[]
  externalStaff?: ExternalStaff[]
  invites?: UserInvite[]
  profiles?: Profile[]
  isExternalStaffSchemaMissing?: boolean
}

function subscribeToDesktopLayout(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(SETTINGS_DESKTOP_MEDIA_QUERY)
  mediaQuery.addEventListener('change', onStoreChange)
  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

function getDesktopSnapshot() {
  return window.matchMedia(SETTINGS_DESKTOP_MEDIA_QUERY).matches
}

function useSettingsDesktopLayout() {
  return useSyncExternalStore(
    subscribeToDesktopLayout,
    getDesktopSnapshot,
    getSettingsServerSnapshot,
  )
}

export function SettingsResponsiveView({
  accessLevel,
  profile,
  logoutAction,
  appointmentTypes = [],
  settings = null,
  packageTemplates = [],
  externalStaff = [],
  invites = [],
  profiles = [],
  isExternalStaffSchemaMissing = false,
}: ResponsiveSettingsViewProps) {
  const isDesktop = useSettingsDesktopLayout()

  if (isDesktop) {
    return (
      <div className="hidden space-y-6 md:block">
        <GuidedTourLauncher />
        <AccountSummary profile={profile} logoutAction={logoutAction} />
        {accessLevel === 'admin' && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="space-y-6">
              <SettingsForm settings={settings} />
              <AppointmentTypesList appointmentTypes={appointmentTypes} />
              <PackageTemplatesList templates={packageTemplates} />
              <InviteForm />
            </div>
            <div className="space-y-6">
              <ExternalStaffList
                externalStaff={externalStaff}
                invites={invites}
                isSchemaMissing={isExternalStaffSchemaMissing}
              />
              <UserInvitesList invites={invites} />
              <UsersList profiles={profiles} />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="md:hidden">
      <MobileSettingsView
        accessLevel={accessLevel}
        profile={profile}
        logoutAction={logoutAction}
        appointmentTypes={appointmentTypes}
        settings={settings}
        packageTemplates={packageTemplates}
        externalStaff={externalStaff}
        invites={invites}
        profiles={profiles}
        isExternalStaffSchemaMissing={isExternalStaffSchemaMissing}
      />
    </div>
  )
}
