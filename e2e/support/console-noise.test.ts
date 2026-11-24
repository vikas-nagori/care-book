import assert from 'node:assert/strict'
import test from 'node:test'

import { isKnownNonAppConsoleError, isObservabilityScriptRefusal, refusedScript } from './console-noise.ts'

const chromium = (url: string, mime = 'text/html') =>
  `Refused to execute script from '${url}' because its MIME type ('${mime}') is not executable, and strict MIME type checking is enabled.`
const webkit = (url: string, mime = 'text/html') =>
  `Refused to execute ${url} as script because ${mime} is not a script MIME type.`
const webkitNosniff = (url: string) =>
  `Refused to execute ${url} as script because "X-Content-Type-Options: nosniff" was given and its Content-Type is not a script MIME type.`

test('reads the refused URL from both browsers\' wording and nothing else', () => {
  assert.deepEqual(refusedScript(chromium('http://localhost:3000/external')), { url: 'http://localhost:3000/external', mimeType: 'text/html' })
  assert.deepEqual(refusedScript(webkit('http://localhost:3000/login?next=%2F_vercel%2Finsights%2Fscript.js')), {
    url: 'http://localhost:3000/login?next=%2F_vercel%2Finsights%2Fscript.js', mimeType: 'text/html',
  })
  assert.deepEqual(refusedScript(webkitNosniff('http://localhost:3000/platform')), { url: 'http://localhost:3000/platform', mimeType: null })
  assert.equal(refusedScript('TypeError: Failed to fetch'), null)
  assert.equal(refusedScript(`Uncaught ${chromium('http://localhost:3000/external')}`), null)
})

test('a role landing page refused as a script is the analytics redirect, for every role', () => {
  for (const landing of ['/external', '/platform', '/auth/change-password', '/login?next=%2F_vercel%2Fspeed-insights%2Fscript.js']) {
    for (const wording of [chromium, webkit, webkitNosniff]) {
      assert.equal(isObservabilityScriptRefusal(wording(`http://localhost:3000${landing}`)), true, `${landing} (${wording.name})`)
    }
  }
  // The script path itself, answered with Next's plain-text 404.
  assert.equal(isObservabilityScriptRefusal(chromium('http://localhost:3000/_vercel/insights/script.js', 'text/plain')), true)
  // An observed redirect target that is not a landing page.
  assert.equal(isObservabilityScriptRefusal(chromium('http://localhost:3000/somewhere'), new Set(['http://localhost:3000/somewhere'])), true)
})

test('real script failures stay errors', () => {
  // An app chunk or any other app path refused as a script.
  assert.equal(isObservabilityScriptRefusal(chromium('http://localhost:3000/_next/static/chunks/app.js')), false)
  assert.equal(isObservabilityScriptRefusal(chromium('http://localhost:3000/')), false)
  assert.equal(isObservabilityScriptRefusal(chromium('http://localhost:3000/patients')), false)
  assert.equal(isObservabilityScriptRefusal(webkitNosniff('http://localhost:3000/_next/static/chunks/app.js')), false)
  assert.equal(isObservabilityScriptRefusal(chromium('http://localhost:3000/externals')), false)
  // Another origin, or a MIME type that is not a page.
  assert.equal(isObservabilityScriptRefusal(chromium('http://127.0.0.1:54321/external')), false)
  assert.equal(isObservabilityScriptRefusal(chromium('http://localhost:3000/external', 'application/json')), false)
  // Different wording that merely mentions a landing page.
  assert.equal(isKnownNonAppConsoleError('Failed to load resource: the server responded with a status of 500 (Internal Server Error)', 'http://localhost:3000/external'), false)
  assert.equal(isKnownNonAppConsoleError('Error: something on /external broke', 'http://localhost:3000/external'), false)
})

test('the legacy 404 shape for the /_vercel/ script path is still recognised', () => {
  assert.equal(isKnownNonAppConsoleError(
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
    'http://localhost:3000/_vercel/insights/script.js',
  ), true)
  assert.equal(isKnownNonAppConsoleError(
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
    'http://localhost:3000/api/patients',
  ), false)
})
