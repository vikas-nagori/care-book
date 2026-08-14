import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldUnbanOnClinicUnblock, shouldUnbanOnUserUnblock } from './block.ts'

test('shouldUnbanOnClinicUnblock un-bans only active users', () => {
  assert.equal(shouldUnbanOnClinicUnblock('active'), true)
  assert.equal(shouldUnbanOnClinicUnblock('blocked'), false)
  assert.equal(shouldUnbanOnClinicUnblock('deleted'), false)
})

test('shouldUnbanOnUserUnblock un-bans only into an active clinic', () => {
  assert.equal(shouldUnbanOnUserUnblock('active'), true)
  assert.equal(shouldUnbanOnUserUnblock('inactive'), false)
  assert.equal(shouldUnbanOnUserUnblock(null), false)
})
