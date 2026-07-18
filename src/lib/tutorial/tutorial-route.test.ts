import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

function readSource(relativePath: string) {
  const url = new URL(relativePath, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

test('tutorial route authenticates and filters steps for the current role', () => {
  const source = readSource('../../app/settings/tutorial/page.tsx')

  assert.match(source, /getCurrentProfile\(\)/)
  assert.match(source, /if \(!profile\) redirect\('\/'\)/)
  assert.match(source, /getTutorialSteps\(profile\.role\)/)
  assert.match(source, /<TutorialView steps=\{steps\} \/>/)
})

test('tutorial view exposes accessible mobile step controls', () => {
  const source = readSource('../../app/settings/tutorial/tutorial-view.tsx')

  assert.match(source, /MobilePageHeader/)
  assert.match(source, /aria-label="Tutorial progress"/)
  assert.match(source, /aria-valuenow=\{safeIndex \+ 1\}/)
  assert.match(source, /min-h-\[44px\]/)
  assert.match(source, /Start again/)
  assert.match(source, /Finish/)
  assert.match(source, /steps\.length === 0/)
})
