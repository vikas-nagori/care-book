import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// auth.ts runs only inside Next's server runtime (it needs cookies and React's server cache), so the
// guarantee is asserted on its source: every profile lookup goes through one request-memoized
// loader. Without it the root layout and the page each paid a GoTrue getUser round trip plus a
// profiles query on every navigation.
const source = readFileSync(join(process.cwd(), 'src/lib/auth.ts'), 'utf8')

test('the profile lookup is memoized per server render', () => {
  assert.match(source, /import \{ cache \} from 'react'/)
  assert.match(source, /typeof cache === 'function' \? cache :/)
  assert.match(source, /const loadCurrentProfile = memoizePerRender\(async function loadCurrentProfile\(\)/)
})

test('every public auth helper reads the profile through the memoized loader', () => {
  assert.equal((source.match(/supabase\.auth\.getUser\(\)/g) ?? []).length, 1)
  assert.equal((source.match(/\.from\('profiles'\)/g) ?? []).length, 1)
  for (const helper of ['getCurrentProfile', 'requireRole']) {
    const body = source.slice(source.indexOf(`export async function ${helper}`))
    assert.match(body.slice(0, body.indexOf('\n}\n')), /await loadCurrentProfile\(\)/, `${helper} bypasses the cached loader`)
  }
})
