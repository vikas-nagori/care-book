import type { Profile } from '../supabase/types'

type AccountSummaryItem = {
  label: 'Name' | 'Email' | 'Mobile' | 'Role'
  value: string
}

function getDisplayValue(value: string | null | undefined) {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : 'Not added yet'
}

export function getAccountSummaryItems(profile: Profile): AccountSummaryItem[] {
  return [
    { label: 'Name', value: getDisplayValue(profile.full_name) },
    { label: 'Email', value: profile.email },
    { label: 'Mobile', value: getDisplayValue(profile.mobile_number) },
    { label: 'Role', value: profile.role },
  ]
}
