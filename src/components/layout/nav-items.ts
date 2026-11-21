import { CalendarDays, CircleUserRound, LayoutDashboard, Receipt, Settings, Users, type LucideIcon } from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean }

const CLINIC_NAV: NavItem[] = [
  { href: '/',         label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/schedule', label: 'Schedule',  icon: CalendarDays },
  { href: '/patients', label: 'Patients',  icon: Users },
  { href: '/billing',  label: 'Billing',   icon: Receipt },
  { href: '/settings', label: 'Settings',  icon: Settings },
]

/** External Staff get the same chrome with their own three destinations. */
export const EXTERNAL_NAV: NavItem[] = [
  { href: '/external',          label: 'Schedule', icon: CalendarDays, exact: true },
  { href: '/external/patients', label: 'Patients', icon: Users },
  { href: '/external/account',  label: 'Account',  icon: CircleUserRound },
]

export function clinicNavItems(canViewBilling: boolean): NavItem[] {
  return canViewBilling ? CLINIC_NAV : CLINIC_NAV.filter((item) => item.href !== '/billing')
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`))
}
