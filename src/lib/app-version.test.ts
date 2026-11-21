import assert from 'node:assert/strict'
import test from 'node:test'
import { isNewerDeployment, RESUME_REFRESH_AFTER_MS, shouldRefreshOnResume } from './app-version.ts'

test('reloads only for a real, different deployment', () => {
  assert.equal(isNewerDeployment('abc123', 'def456'), true)
  assert.equal(isNewerDeployment('abc123', 'abc123'), false)
  assert.equal(isNewerDeployment('dev', 'def456'), false, 'local builds never reload')
  assert.equal(isNewerDeployment('abc123', 'dev'), false)
  for (const bad of [undefined, null, '', 42, {}]) assert.equal(isNewerDeployment('abc123', bad), false)
})

test('refreshes after a minute away, not on every quick app switch', () => {
  const now = 1_000_000
  assert.equal(shouldRefreshOnResume(null, now), false)
  assert.equal(shouldRefreshOnResume(now - 5_000, now), false)
  assert.equal(shouldRefreshOnResume(now - RESUME_REFRESH_AFTER_MS, now), true)
  assert.equal(shouldRefreshOnResume(0, now), true, 'restored from the back/forward cache')
})
