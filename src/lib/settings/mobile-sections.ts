export type MobileSettingsSectionKey =
  | 'account'
  | 'types'
  | 'packages'
  | 'invite'
  | 'staff'
  | 'invites'
  | 'users'

export type MobileSettingsSection = {
  key: MobileSettingsSectionKey
  title: string
  subtitle: string
}

export type MobileSettingsCounts = {
  appointmentTypes: number
  packageTemplates: number
  externalStaff: number
  invites: number
  activeUsers: number
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function getMobileSettingsSections(
  accessLevel: 'admin' | 'profile_only',
  counts: MobileSettingsCounts,
): MobileSettingsSection[] {
  const account: MobileSettingsSection = {
    key: 'account',
    title: 'Your Account',
    subtitle: 'Profile & logout',
  }

  if (accessLevel === 'profile_only') return [account]

  return [
    account,
    {
      key: 'types',
      title: 'Appointment Types',
      subtitle: countLabel(counts.appointmentTypes, 'type'),
    },
    {
      key: 'packages',
      title: 'Package Templates',
      subtitle: countLabel(counts.packageTemplates, 'template'),
    },
    { key: 'invite', title: 'Invite User', subtitle: 'Add staff or admin' },
    {
      key: 'staff',
      title: 'External Staff',
      subtitle: countLabel(counts.externalStaff, 'person', 'people'),
    },
    { key: 'invites', title: 'Invites', subtitle: `${counts.invites} sent` },
    {
      key: 'users',
      title: 'Active Users',
      subtitle: countLabel(counts.activeUsers, 'user'),
    },
  ]
}
