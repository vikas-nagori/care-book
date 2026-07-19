import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTourDevice } from './device.ts'

test('mobile viewports always use the mobile tour', () => {
  assert.equal(resolveTourDevice(false, null), 'mobile')
  assert.equal(resolveTourDevice(false, 'desktop'), 'mobile')
  assert.equal(resolveTourDevice(false, 'mobile'), 'mobile')
})

test('desktop viewports default to desktop and honor an explicit preview', () => {
  assert.equal(resolveTourDevice(true, null), 'desktop')
  assert.equal(resolveTourDevice(true, 'desktop'), 'desktop')
  assert.equal(resolveTourDevice(true, 'mobile'), 'mobile')
})
