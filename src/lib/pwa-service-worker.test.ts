import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

function loadWorker() {
  const listeners = new Map<string, (event: unknown) => void>()
  let skippedWaiting = false
  let claimed = false
  const context = {
    self: {
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      skipWaiting() { skippedWaiting = true },
    },
    clients: { claim: async () => { claimed = true } },
  }
  vm.runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), context)
  return { listeners, skippedWaiting: () => skippedWaiting, claimed: () => claimed }
}

test('the service worker never sits between the app and the network', () => {
  // No fetch handler means no request — page, RSC payload, asset, save or API call — is routed
  // through the worker, so a suspended iOS worker can never delay or lose one.
  const worker = loadWorker()
  assert.equal(worker.listeners.has('fetch'), false)
})

test('the service worker still installs and takes control immediately', async () => {
  const worker = loadWorker()
  worker.listeners.get('install')!({})
  assert.equal(worker.skippedWaiting(), true)
  let pending: Promise<unknown> | undefined
  worker.listeners.get('activate')!({ waitUntil: (promise: Promise<unknown>) => { pending = promise } })
  await pending
  assert.equal(worker.claimed(), true)
})

test('the service worker is still registered by the app shell', () => {
  const registration = readFileSync(new URL('../components/layout/service-worker-registration.tsx', import.meta.url), 'utf8')
  assert.match(registration, /navigator\.serviceWorker\.register\('\/sw\.js'\)/)
})
