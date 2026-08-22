'use client'

import { useRef, useState } from 'react'
import {
  CalendarRange,
  BadgeIndianRupee,
  ChevronRight,
  Mail,
  Package,
  UserPlus,
  UserRound,
  UsersRound,
  Link2,
  type LucideIcon,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  getMobileSettingsSections,
  type MobileSettingsSectionKey,
} from '@/lib/settings/mobile-sections'
import { shouldRestoreSettingsFocus } from '@/lib/settings/responsive-layout'
import type {
  AppointmentType,
  ExternalStaff,
  GlobalSettings,
  PackageTemplate,
  Profile,
  UserInvite,
  ConnectedMcpApp,
} from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { GuidedTourLauncher } from '@/components/tour/guided-tour-launcher'
import { AccountSummary } from './account-summary'
import { ConnectedApps } from './connected-apps'
import { AppointmentTypesList } from './appointment-types-list'
import { ExternalStaffList } from './external-staff-list'
import { InviteForm } from './invite-form'
import { PackageTemplatesList } from './package-templates-list'
import { SettingsForm } from './settings-form'
import { UserInvitesList } from './user-invites-list'
import { UsersList } from './users-list'

const sectionIcons: Record<MobileSettingsSectionKey, LucideIcon> = {
  account: UserRound,
  fees: BadgeIndianRupee,
  types: CalendarRange,
  packages: Package,
  invite: UserPlus,
  staff: UsersRound,
  invites: Mail,
  users: UsersRound,
  connected_apps: Link2,
}

type MobileSettingsViewProps = {
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
  connectedApps?: ConnectedMcpApp[]
  revokeConnectedAppAction: (formData: FormData) => Promise<void>
}

export function MobileSettingsView({
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
  connectedApps = [],
  revokeConnectedAppAction,
}: MobileSettingsViewProps) {
  const [selectedSection, setSelectedSection] = useState<MobileSettingsSectionKey | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null)
  const sections = getMobileSettingsSections(accessLevel, {
    appointmentTypes: appointmentTypes.length,
    packageTemplates: packageTemplates.length,
    externalStaff: externalStaff.length,
    invites: invites.length,
    activeUsers: profiles.length,
    connectedApps: connectedApps.length,
  })
  const activeSection = sections.find((section) => section.key === selectedSection)

  function renderOpenSection() {
    switch (selectedSection) {
      case 'account':
        return <AccountSummary profile={profile} logoutAction={logoutAction} variant="sheet" />
      case 'connected_apps':
        return <ConnectedApps apps={connectedApps} variant="sheet" revokeAction={revokeConnectedAppAction} />
      case 'types':
        return <AppointmentTypesList appointmentTypes={appointmentTypes} variant="sheet" />
      case 'fees':
        return <SettingsForm settings={settings} variant="sheet" />
      case 'packages':
        return <PackageTemplatesList templates={packageTemplates} variant="sheet" />
      case 'invite':
        return <InviteForm variant="sheet" />
      case 'staff':
        return (
          <ExternalStaffList
            externalStaff={externalStaff}
            invites={invites}
            isSchemaMissing={isExternalStaffSchemaMissing}
            variant="sheet"
          />
        )
      case 'invites':
        return <UserInvitesList invites={invites} variant="sheet" />
      case 'users':
        return <UsersList profiles={profiles} variant="sheet" />
      default:
        return null
    }
  }

  return (
    <>
      <div className="mb-4">
        <GuidedTourLauncher />
      </div>
      <div className="overflow-hidden rounded-[12px] border border-[var(--ph-line)] bg-[var(--ph-surface)]">
        {sections.map((section, index) => {
          const Icon = sectionIcons[section.key]
          const isActive = section.key === selectedSection && sheetOpen

          return (
            <button
              key={section.key}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isActive}
              onClick={(event) => {
                lastTriggerRef.current = event.currentTarget
                setSelectedSection(section.key)
                setSheetOpen(true)
              }}
              className={cn(
                'flex w-full items-center gap-3 px-[15px] py-[14px] text-left transition-colors hover:bg-[var(--ph-bg-soft)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ph-accent)]',
                index < sections.length - 1 && 'border-b border-[var(--ph-line)]',
                isActive && 'bg-[var(--ph-bg-soft)]',
              )}
            >
              <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-[var(--ph-accent-soft)] text-[var(--ph-accent-ink)]">
                <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-tight text-[var(--ph-ink)]">
                  {section.title}
                </span>
                <span className="mt-1 block text-[11.5px] leading-tight text-[var(--ph-ink-4)]">
                  {section.subtitle}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="shrink-0 text-[var(--ph-ink-4)]"
                size={17}
                strokeWidth={1.8}
              />
            </button>
          )
        })}
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
        }}
      >
        <SheetContent
          side="bottom"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const trigger = lastTriggerRef.current
            if (
              trigger
              && shouldRestoreSettingsFocus(trigger.isConnected, trigger.getClientRects().length)
            ) {
              trigger.focus()
            }
          }}
        >
          <SheetHeader className="mb-5 pr-10 text-left">
            <SheetTitle className="text-[16px] font-semibold text-[var(--ph-ink)]">
              {activeSection?.title ?? 'Settings'}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Manage {activeSection?.title ?? 'this settings section'}.
            </SheetDescription>
          </SheetHeader>
          {renderOpenSection()}
        </SheetContent>
      </Sheet>
    </>
  )
}
