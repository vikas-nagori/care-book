import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

type FetchEvent = { request: Request; respondWith: (response: Promise<Response | undefined>) => void }
function loadWorker() {
  const listeners = new Map<string, (event: FetchEvent) => void>()
  const context = {
    self: { addEventListener: (type: string, listener: (event: FetchEvent) => void) => listeners.set(type, listener), skipWaiting() {} },
    clients: { claim: async () => {} },
    caches: { match: async () => undefined },
    fetch: async () => new Response('network'),
    URL,
  }
  vm.runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), context)
  return (request: Request) => {
    let intercepted = false
    listeners.get('fetch')!({ request, respondWith: () => { intercepted = true } })
    return intercepted
  }
}

test('the service worker never sits between the app and its saves or API calls', () => {
  const intercepts = loadWorker()
  const origin = 'https://care-book.co'
  assert.equal(intercepts(new Request(`${origin}/api/appointments/bookings`, { method: 'POST', body: '{}' })), false)
  assert.equal(intercepts(new Request(`${origin}/api/telemetry`, { method: 'POST', body: '{}' })), false)
  assert.equal(intercepts(new Request(`${origin}/schedule`, { method: 'POST', body: '{}' })), false)
  assert.equal(intercepts(new Request(`${origin}/api/appointments/bookings/status`)), false)
})

test('the service worker still handles page and asset loads', () => {
  const intercepts = loadWorker()
  assert.equal(intercepts(new Request('https://care-book.co/schedule')), true)
  assert.equal(intercepts(new Request('https://care-book.co/icons/icon-192.png')), true)
})
