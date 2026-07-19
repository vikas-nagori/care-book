import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('browser timezone synchronization writes the shared cookie and refreshes once on mismatch', () => {
  const source = readFileSync(join(root, 'src/components/layout/timezone-sync.tsx'), 'utf8')

  assert.match(source, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/)
  assert.match(source, /isValidTimeZone\(browserTimeZone\)/)
  assert.match(source, /USER_TIME_ZONE_COOKIE/)
  assert.match(source, /encodeURIComponent\(browserTimeZone\)/)
  assert.match(source, /Path=\//)
  assert.match(source, /Max-Age=31536000/)
  assert.match(source, /SameSite=Lax/)
  assert.match(source, /if \(storedTimeZone === browserTimeZone\) return/)
  assert.match(source, /router\.refresh\(\)/)
})

test('server timezone accessor validates the same cookie with Kolkata fallback', () => {
  const source = readFileSync(join(root, 'src/lib/timezone/server.ts'), 'utf8')

  assert.match(source, /await cookies\(\)/)
  assert.match(source, /USER_TIME_ZONE_COOKIE/)
  assert.match(source, /decodeURIComponent/)
  assert.match(source, /return resolveTimeZone\(value\)/)
})

test('root layout mounts timezone synchronization globally', () => {
  const source = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8')

  assert.match(source, /import \{ TimezoneSync \} from '@\/components\/layout\/timezone-sync'/)
  assert.match(source, /<TimezoneSync \/>/)
})
