import assert from 'node:assert/strict'
import test from 'node:test'

import { getRestrictedUiAccess } from './restricted-visibility.ts'
import type { Profile } from '../supabase/types.ts'

const baseProfile: Profile = {
  id: 'profile-1',
  email: 'user@example.com',
  role: 'staff',
  full_name: 'Asha Patel',
  mobile_number: '9876543210',
  created_at: '2026-04-19T00:00:00.000Z',
  updated_at: '2026-04-19T00:00:00.000Z',
}

test('getRestrictedUiAccess grants full visibility to admins', () => {
  assert.deepEqual(getRestrictedUiAccess({ ...baseProfile, role: 'admin' }), {
    canViewBilling: true,
    canViewPaymentSignals: true,
    canViewHomeVisits: true,
    canUseHomeVisitFormFields: true,
  })
})

test('getRestrictedUiAccess hides billing and payment while allowing limited home visit visibility for staff', () => {
  assert.deepEqual(getRestrictedUiAccess(baseProfile), {
    canViewBilling: false,
    canViewPaymentSignals: false,
    canViewHomeVisits: true,
    canUseHomeVisitFormFields: true,
  })
})

test('getRestrictedUiAccess removes all access when no profile exists', () => {
  assert.deepEqual(getRestrictedUiAccess(null), {
    canViewBilling: false,
    canViewPaymentSignals: false,
    canViewHomeVisits: false,
    canUseHomeVisitFormFields: false,
  })
})
