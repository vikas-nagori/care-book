import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const schedulePagePath = join(process.cwd(), 'src/app/schedule/page.tsx')

test('schedule page does not filter out historical appointments', () => {
  const source = readFileSync(schedulePagePath, 'utf8')

  assert.doesNotMatch(source, /\.gte\('date', today\)/)
  assert.doesNotMatch(source, /const today =/)
  assert.match(source, /\.order\('date'\)/)
})
