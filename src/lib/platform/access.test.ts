import assert from 'node:assert/strict'
import test from 'node:test'

import { isPlatformAdminEmail } from './access.ts'

test('isPlatformAdminEmail allows the seeded superadmin email', () => {
  assert.equal(
    isPlatformAdminEmail(' vikasrnagori@gmail.com ', 'vikasrnagori@gmail.com'),
    true
  )
})

test('isPlatformAdminEmail supports comma-separated allowlists', () => {
  assert.equal(
    isPlatformAdminEmail(
      'owner@example.com',
      'vikasrnagori@gmail.com, owner@example.com'
    ),
    true
  )
})

test('isPlatformAdminEmail rejects non-allowlisted users', () => {
  assert.equal(
    isPlatformAdminEmail('clinic-admin@example.com', 'vikasrnagori@gmail.com'),
    false
  )
})
