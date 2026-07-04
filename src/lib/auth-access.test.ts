import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluateRoleAccess } from './auth-access.ts'
import type { Profile } from './supabase/types.ts'

const adminProfile: Profile = {
  id: 'admin-1',
  clinic_id: 'clinic-1',
  email: 'admin@example.com',
  role: 'admin',
  status: 'active',
  created_at: '2026-04-18T00:00:00.000Z',
  updated_at: '2026-04-18T00:00:00.000Z',
}

test('evaluateRoleAccess returns missing_profile when no profile exists for an authenticated user', () => {
  const result = evaluateRoleAccess(null, ['admin'])

  assert.equal(result, 'missing_profile')
})

test('evaluateRoleAccess returns missing_profile when profile has no clinic', () => {
  const result = evaluateRoleAccess({ ...adminProfile, clinic_id: null }, ['admin'])

  assert.equal(result, 'missing_profile')
})

test('evaluateRoleAccess returns insufficient_role when the profile role is not allowed', () => {
  const result = evaluateRoleAccess({ ...adminProfile, role: 'staff' }, ['admin'])

  assert.equal(result, 'insufficient_role')
})

test('evaluateRoleAccess returns authorized when the profile role is allowed', () => {
  const result = evaluateRoleAccess(adminProfile, ['admin'])

  assert.equal(result, 'authorized')
})

test('evaluateRoleAccess authorizes staff when staff is in the allowed roles', () => {
  const staffProfile = { ...adminProfile, role: 'staff' as const }

  assert.equal(evaluateRoleAccess(staffProfile, ['staff']), 'authorized')
  assert.equal(evaluateRoleAccess(staffProfile, ['admin', 'staff']), 'authorized')
})

test('evaluateRoleAccess keeps admins authorized on a mixed allow-list', () => {
  assert.equal(evaluateRoleAccess(adminProfile, ['admin', 'staff']), 'authorized')
})

test('evaluateRoleAccess blocks staff from admin-only access', () => {
  assert.equal(evaluateRoleAccess({ ...adminProfile, role: 'staff' }, ['admin']), 'insufficient_role')
})
