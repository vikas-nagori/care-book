import type { Profile } from '../supabase/types'

export type RestrictedUiAccess = {
  canViewBilling: boolean
  canViewPaymentSignals: boolean
  canViewHomeVisits: boolean
  canUseHomeVisitFormFields: boolean
}

const unauthenticatedAccess: RestrictedUiAccess = {
  canViewBilling: false,
  canViewPaymentSignals: false,
  canViewHomeVisits: false,
  canUseHomeVisitFormFields: false,
}

const adminAccess: RestrictedUiAccess = {
  canViewBilling: true,
  canViewPaymentSignals: true,
  canViewHomeVisits: true,
  canUseHomeVisitFormFields: true,
}

const staffAccess: RestrictedUiAccess = {
  canViewBilling: false,
  canViewPaymentSignals: false,
  canViewHomeVisits: true,
  canUseHomeVisitFormFields: true,
}

export function getRestrictedUiAccess(
  profile: Pick<Profile, 'role'> | null
): RestrictedUiAccess {
  if (!profile) return unauthenticatedAccess
  if (profile.role === 'admin') return adminAccess
  return staffAccess
}
