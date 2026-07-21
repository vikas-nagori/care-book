import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ALL_ACCOUNTS,
  AUTHENTICATED_ACCOUNTS,
  PLATFORM,
  PLATFORM_SIGNOUT,
} from './accounts.ts'

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

test('critical clinic write flows run for both admin and staff projects', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const patientsSpec = readFileSync(new URL('../shared/patients.spec.ts', import.meta.url), 'utf8')
  const scheduleSpec = readFileSync(new URL('../shared/schedule-write-flows.spec.ts', import.meta.url), 'utf8')

  for (const projectName of ['admin-desktop', 'admin-mobile', 'staff-desktop', 'staff-mobile']) {
    const project = config.match(new RegExp(`name: '${projectName}',[\\s\\S]*?\\n\\s*},`))?.[0] ?? ''
    assert.match(project, /testMatch:\s*\['shared\/\*\*\/\*\.spec\.ts'/, projectName)
  }
  assert.match(patientsSpec, /creates a representative patient/)
  assert.match(patientsSpec, /edits a factory-owned patient/)
  assert.match(scheduleSpec, /books a shared appointment/)
  assert.match(scheduleSpec, /books a restricted appointment/)
  assert.match(scheduleSpec, /changes appointment status/)
  assert.match(scheduleSpec, /adds a SOAP session note/)
  assert.match(scheduleSpec, /deletes a scheduled appointment/)
})

test('platform sign-out runs only after the platform desktop project completes', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const signoutSpec = readFileSync(new URL('../platform/zz-signout.spec.ts', import.meta.url), 'utf8')
  const env = readFileSync(new URL('../../.env.e2e', import.meta.url), 'utf8')
  const platformProject = config.match(/name: 'platform-desktop',[\s\S]*?\n\s*},/)?.[0] ?? ''
  const signoutProject = config.match(/name: 'platform-signout',[\s\S]*?\n\s*},/)?.[0] ?? ''
  const allowlist = env.match(/^PLATFORM_ADMIN_EMAILS=(.+)$/m)?.[1]?.split(',') ?? []

  assert.match(platformProject, /testIgnore:\s*\['platform\/zz-signout\.spec\.ts'\]/)
  assert.match(signoutProject, /dependencies:\s*\['platform-desktop'\]/)
  assert.match(signoutProject, /testMatch:\s*\['platform\/zz-signout\.spec\.ts'\]/)
  assert.match(signoutProject, /storageState:\s*\{\s*cookies:\s*\[\],\s*origins:\s*\[\]\s*}/)
  assert.notEqual(PLATFORM_SIGNOUT.email, PLATFORM.email)
  assert.ok(ALL_ACCOUNTS.includes(PLATFORM_SIGNOUT))
  assert.ok(!AUTHENTICATED_ACCOUNTS.includes(PLATFORM_SIGNOUT))
  assert.ok(allowlist.includes(PLATFORM.email))
  assert.ok(allowlist.includes(PLATFORM_SIGNOUT.email))
  assert.match(signoutSpec, /signIn\(page,\s*PLATFORM_SIGNOUT\)/)
  assert.doesNotMatch(signoutSpec, /signIn\(page,\s*PLATFORM\)/)
})
