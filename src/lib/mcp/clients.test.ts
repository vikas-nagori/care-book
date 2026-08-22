import assert from 'node:assert/strict'
import test from 'node:test'

import { validateRedirectUris } from './clients.ts'

test('https redirect URIs are accepted', () => {
  assert.deepEqual(validateRedirectUris(['https://pi.example.ts.net/cb']), ['https://pi.example.ts.net/cb'])
})

test('localhost http is accepted', () => {
  assert.deepEqual(validateRedirectUris(['http://127.0.0.1:8090/cb']), ['http://127.0.0.1:8090/cb'])
  assert.deepEqual(validateRedirectUris(['http://localhost:8090/cb']), ['http://localhost:8090/cb'])
})

test('non-localhost http and fragments are rejected', () => {
  assert.throws(() => validateRedirectUris(['http://evil.test/cb']), /redirect_uri/)
  assert.throws(() => validateRedirectUris(['https://ok.test/cb#frag']), /fragment/)
})

test('empty or non-array values are rejected', () => {
  assert.throws(() => validateRedirectUris([]), /redirect_uris/)
  assert.throws(() => validateRedirectUris('https://ok.test/cb'), /redirect_uris/)
})
