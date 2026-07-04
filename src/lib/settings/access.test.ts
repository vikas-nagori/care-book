import assert from 'node:assert/strict'
import test from 'node:test'

import { getSettingsAccessLevel } from './access.ts'
import type { Profile } from '../supabase/types.ts'

const baseProfile: Profile = {
  id: 'profile-1',
  clinic_id: 'clinic-1',
  email: 'user@example.com',
  role: 'staff',
  full_name: 'Asha Patel',
  mobile_number: '9876543210',
  created_at: '2026-04-19T00:00:00.000Z',
  updated_at: '2026-04-19T00:00:00.000Z',
}

test('getSettingsAccessLevel returns admin for admin users', () => {
  assert.equal(getSettingsAccessLevel({ ...baseProfile, role: 'admin' }), 'admin')
})

test('getSettingsAccessLevel returns profile_only for staff users', () => {
  assert.equal(getSettingsAccessLevel(baseProfile), 'profile_only')
})

test('getSettingsAccessLevel returns unauthenticated when no profile exists', () => {
  assert.equal(getSettingsAccessLevel(null), 'unauthenticated')
})
