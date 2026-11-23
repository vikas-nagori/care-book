import assert from 'node:assert/strict'
import test from 'node:test'

import { getAccountSummaryItems } from './account-summary.ts'
import type { Profile } from '../supabase/types.ts'

const baseProfile: Profile = {
  id: 'admin-1',
  clinic_id: 'clinic-1',
  email: 'admin@example.com',
  role: 'admin',
  full_name: 'Asha Patel',
  mobile_number: '9876543210',
  status: 'active',
  deleted_at: null,
  deleted_by: null,
  deletion_reason: null,
  created_at: '2026-04-18T00:00:00.000Z',
  updated_at: '2026-04-18T00:00:00.000Z',
}

test('getAccountSummaryItems returns the expected read-only account fields', () => {
  const result = getAccountSummaryItems(baseProfile)

  assert.deepEqual(result, [
    { label: 'Name', value: 'Asha Patel' },
    { label: 'Mobile', value: '98765 43210' },
    { label: 'Email', value: 'admin@example.com' },
    { label: 'Role', value: 'Admin' },
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
    { label: 'Mobile', value: 'Not added yet' },
    { label: 'Email', value: 'admin@example.com' },
    { label: 'Role', value: 'Admin' },
  ])
})

test('getAccountSummaryItems shows a mobile-only account without an email', () => {
  const items = getAccountSummaryItems({ ...baseProfile, email: null, mobile_number: '9511219264' })
  assert.deepEqual(items.slice(1, 3), [
    { label: 'Mobile', value: '95112 19264' },
    { label: 'Email', value: 'Not added yet' },
  ])
})
