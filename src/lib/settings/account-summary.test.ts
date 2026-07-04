import assert from 'node:assert/strict'
import test from 'node:test'

import { getAccountSummaryItems } from './account-summary.ts'
import type { Profile } from '../supabase/types.ts'

const baseProfile: Profile = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'admin',
  full_name: 'Asha Patel',
  mobile_number: '9876543210',
  created_at: '2026-04-18T00:00:00.000Z',
  updated_at: '2026-04-18T00:00:00.000Z',
}

test('getAccountSummaryItems returns the expected read-only account fields', () => {
  const result = getAccountSummaryItems(baseProfile)

  assert.deepEqual(result, [
    { label: 'Name', value: 'Asha Patel' },
    { label: 'Email', value: 'admin@example.com' },
    { label: 'Mobile', value: '9876543210' },
    { label: 'Role', value: 'admin' },
  ])
})

test('getAccountSummaryItems falls back when optional profile details are missing', () => {
  const result = getAccountSummaryItems({
    ...baseProfile,
    full_name: '   ',
    mobile_number: null,
  })

  assert.deepEqual(result, [
    { label: 'Name', value: 'Not added yet' },
    { label: 'Email', value: 'admin@example.com' },
    { label: 'Mobile', value: 'Not added yet' },
    { label: 'Role', value: 'admin' },
  ])
})
