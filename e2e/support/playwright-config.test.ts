import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Playwright owns the E2E server by default instead of reusing an arbitrary port 3000 process', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const reuseSetting = config.match(/reuseExistingServer:\s*([^,\n]+)/)?.[1]?.trim()

  assert.equal(reuseSetting, 'false')
})

test('platform uses one worker so global sign-out cannot revoke parallel smoke sessions', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const platformProject = config.match(/name: 'platform-desktop',[\s\S]*?\n\s*},/)?.[0] ?? ''

  assert.match(platformProject, /fullyParallel:\s*false/)
  assert.match(platformProject, /workers:\s*1/)
})
