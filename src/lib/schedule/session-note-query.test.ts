import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const appointmentPageSource = readFileSync(
  join(process.cwd(), 'src/app/schedule/[id]/page.tsx'),
  'utf8',
)

test('session note lookup treats a missing note as an expected result', () => {
  const sessionNoteQuery = appointmentPageSource.match(
    /\.from\('session_notes'\)[\s\S]*?(?=\n\n  (?:\/\/|if \(sessionNoteError))/,
  )?.[0]

  assert.ok(sessionNoteQuery, 'expected the session_notes query chain')
  assert.match(sessionNoteQuery, /\.maybeSingle\(\)/)
  assert.doesNotMatch(sessionNoteQuery, /\.single\(\)/)
})
