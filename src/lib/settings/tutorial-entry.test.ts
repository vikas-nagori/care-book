import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../../app/settings/page.tsx', import.meta.url),
  'utf8'
)

test('settings exposes the tutorial to staff and admins', () => {
  assert.match(source, /import \{ TutorialEntryCard \}/)
  assert.equal(source.match(/<TutorialEntryCard\s*\/>/g)?.length, 2)
})
