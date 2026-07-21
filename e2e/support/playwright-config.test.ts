import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Playwright owns the E2E server by default instead of reusing an arbitrary port 3000 process', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const reuseSetting = config.match(/reuseExistingServer:\s*([^,\n]+)/)?.[1]?.trim()

  assert.equal(reuseSetting, 'false')
})

test('the full local Supabase matrix uses one worker to avoid exhausting GoTrue database connections', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const workersSetting = config.match(/workers:\s*([^,\n]+)/)?.[1]?.trim()

  assert.equal(workersSetting, '1')
})

test('platform sign-out runs only after the platform desktop project completes', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const signoutSpec = readFileSync(new URL('../platform/zz-signout.spec.ts', import.meta.url), 'utf8')
  const platformProject = config.match(/name: 'platform-desktop',[\s\S]*?\n\s*},/)?.[0] ?? ''
  const signoutProject = config.match(/name: 'platform-signout',[\s\S]*?\n\s*},/)?.[0] ?? ''

  assert.match(platformProject, /testIgnore:\s*\['platform\/zz-signout\.spec\.ts'\]/)
  assert.match(signoutProject, /dependencies:\s*\['platform-desktop'\]/)
  assert.match(signoutProject, /testMatch:\s*\['platform\/zz-signout\.spec\.ts'\]/)
  assert.match(signoutProject, /storageState:\s*\{\s*cookies:\s*\[\],\s*origins:\s*\[\]\s*}/)
  assert.match(signoutSpec, /signIn\(page,\s*PLATFORM\)/)
})
