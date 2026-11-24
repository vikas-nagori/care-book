// Fault injection for server actions and direct Supabase calls.
//
// Both 2026-11-24 incidents were a button that stayed stuck or a screen that broke when a request
// failed, and no e2e test ever failed a request on purpose. These helpers make one request fail
// (or hang) in a controlled way so a spec can prove the control recovers.
//
// Facts this relies on (checked in node_modules/next/dist for Next 16.3.4):
// - A server action is a `POST` to the *current page URL* with a `next-action` request header
//   (client/components/router-reducer/reducers/server-action-reducer.js, fetchServerAction).
// - An action the server does not recognise (the client runs an older build) is answered with
//   `404`, `content-type: text/plain`, body `Server action not found.` and
//   `x-nextjs-action-not-found: 1` (server/app-render/action-handler.js,
//   handleUnrecognizedFetchAction). The client throws UnrecognizedActionError for it, which
//   callServerAction maps to STALE_DEPLOYMENT_MESSAGE and a reload 1.5 s later.
// - Any other non-RSC reply (e.g. a plain 500) makes the client throw, which callServerAction maps
//   to ACTION_UNREACHABLE_MESSAGE.
//
// Usage rules (plan section 3): specs that use these set `test.use({ serviceWorkers: 'block' })`
// so requests reach Playwright's router rather than the service worker, and always assert
// `fault.hit()` so a fault that never fired cannot pass.

import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test'

import {
  ACTION_UNREACHABLE_MESSAGE,
  STALE_DEPLOYMENT_MESSAGE,
} from '../../src/lib/actions/run-server-action.ts'
import { NETWORK_ERROR_MESSAGE } from '../../src/lib/actions/request-error-message.ts'

// The user-facing copy, imported (never copied) so a wording change cannot leave specs behind.
export { ACTION_UNREACHABLE_MESSAGE, NETWORK_ERROR_MESSAGE, STALE_DEPLOYMENT_MESSAGE }

/** Body/message of every injected Supabase 4xx/5xx, so a spec can recognise it on screen. */
export const INJECTED_SUPABASE_ERROR_MESSAGE = 'E2E injected Supabase failure'

/** How long callServerAction waits before reloading on a stale deployment (call-server-action.ts). */
export const STALE_RELOAD_DELAY_MS = 1_500

export type ActionFault = 'abort' | 'lost-response' | 'http-500' | 'stale-deployment'
export type SupabaseFault = 'abort' | 'http-500' | 'http-400'

/** A Supabase path below the project origin, e.g. `rest/v1/patients` or `auth/v1/token`. */
export type SupabaseResource = `rest/v1/${string}` | `auth/v1/${string}`

export type FaultHandle = {
  /** True once at least one matching request was intercepted. */
  hit(): boolean
  /** How many matching requests were faulted. */
  hits(): number
  /** Stops intercepting. Safe to call more than once. */
  dispose(): Promise<void>
}

export type HoldHandle = {
  /** True once the first matching request is being held. */
  hit(): boolean
  /** Every matching request seen since the hold was installed, held or not. */
  count(): number
  /** Resolves once the first matching request is being held. */
  whenHeld(): Promise<void>
  /** Lets the held request continue to the server and stops intercepting. */
  release(): Promise<void>
  /** Fails the held request as a dropped connection instead of releasing it. */
  abort(): Promise<void>
  dispose(): Promise<void>
}

export type RequestFilter = (request: Request) => boolean

export function isServerActionRequest(request: Request): boolean {
  return request.method() === 'POST' && request.headers()['next-action'] !== undefined
}

function supabaseOrigin(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set (playwright.config.ts loads .env.e2e)')
  return new URL(url).origin
}

/** Matches one Supabase resource exactly: `rest/v1/patients` matches `/rest/v1/patients?…` only. */
export function isSupabaseRequest(
  request: Request,
  input: { resource: SupabaseResource; method?: string },
): boolean {
  const url = new URL(request.url())
  if (url.origin !== supabaseOrigin()) return false
  // CORS preflights are not the call itself; leave them to the browser.
  if (request.method() === 'OPTIONS') return false
  if (input.method && request.method() !== input.method.toUpperCase()) return false
  const path = `/${input.resource.replace(/^\/+/, '').replace(/\/+$/, '')}`
  return url.pathname === path || url.pathname.startsWith(`${path}/`)
}

const ANY_URL = () => true

/**
 * Register one catch-all route and count matches ourselves. `page.route(…, { times: 1 })` with a
 * catch-all would be consumed by the first unrelated request, so it cannot be used here.
 */
async function interceptMatching(
  page: Page,
  matches: RequestFilter,
  times: number,
  onMatch: (route: Route, index: number) => Promise<void>,
): Promise<FaultHandle> {
  let count = 0
  let disposed = false
  const handler = async (route: Route) => {
    if (disposed || count >= times || !matches(route.request())) {
      await route.fallback()
      return
    }
    count += 1
    await onMatch(route, count)
  }
  await page.route(ANY_URL, handler)
  return {
    hit: () => count > 0,
    hits: () => count,
    async dispose() {
      if (disposed) return
      disposed = true
      await page.unroute(ANY_URL, handler).catch(() => {})
    },
  }
}

async function applyActionFault(route: Route, mode: ActionFault): Promise<void> {
  switch (mode) {
    case 'abort':
      await route.abort('failed')
      return
    case 'http-500':
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' })
      return
    case 'lost-response':
      // The server runs the action and commits; only the reply is lost on the way back.
      await route.fetch()
      await route.abort('failed')
      return
    case 'stale-deployment':
      await route.fulfill({
        status: 404,
        headers: { 'x-nextjs-action-not-found': '1', 'content-type': 'text/plain' },
        body: 'Server action not found.',
      })
      return
  }
}

/**
 * Fail the next server action the page sends (or the next `times` of them).
 *
 * - `abort`: the connection drops before the server sees the request. Nothing is saved.
 * - `http-500`: the server answers a plain 500. Nothing is saved.
 * - `lost-response`: the request reaches the server and commits; the reply is lost.
 * - `stale-deployment`: the server does not know the action (the phone runs an older build).
 *   The app shows STALE_DEPLOYMENT_MESSAGE and reloads after STALE_RELOAD_DELAY_MS, so await the
 *   reload (`page.waitForEvent('load')`) before asserting on the fresh page.
 */
export async function failNextServerAction(
  page: Page,
  mode: ActionFault,
  options: { times?: number; filter?: RequestFilter } = {},
): Promise<FaultHandle> {
  const filter = options.filter ?? (() => true)
  return interceptMatching(
    page,
    (request) => isServerActionRequest(request) && filter(request),
    options.times ?? 1,
    (route) => applyActionFault(route, mode),
  )
}

async function holdMatching(page: Page, matches: RequestFilter): Promise<HoldHandle> {
  let seen = 0
  let held: Route | null = null
  let settled = false
  let disposed = false
  let onHeld!: () => void
  const heldPromise = new Promise<void>((resolve) => { onHeld = resolve })
  const handler = async (route: Route) => {
    if (disposed || !matches(route.request())) {
      await route.fallback()
      return
    }
    seen += 1
    if (held === null) {
      held = route
      onHeld()
      return
    }
    // Every later match (a second tap, Enter) goes through; count() is what the spec asserts on.
    await route.fallback()
  }
  await page.route(ANY_URL, handler)
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await page.unroute(ANY_URL, handler).catch(() => {})
  }
  const finish = async (how: (route: Route) => Promise<void>) => {
    if (held === null) {
      await dispose()
      throw new Error('holdNext…: no matching request was ever held (await whenHeld() first)')
    }
    if (!settled) {
      settled = true
      await how(held as Route)
    }
    await dispose()
  }
  return {
    hit: () => held !== null,
    count: () => seen,
    whenHeld: () => heldPromise,
    release: () => finish((route) => route.fallback()),
    abort: () => finish((route) => route.abort('failed')),
    dispose,
  }
}

/** Hold the next server action in flight until `release()`, to observe the pending state. */
export async function holdNextServerAction(
  page: Page,
  options: { filter?: RequestFilter } = {},
): Promise<HoldHandle> {
  const filter = options.filter ?? (() => true)
  return holdMatching(page, (request) => isServerActionRequest(request) && filter(request))
}

function supabaseErrorBody(status: number) {
  // One body that both PostgREST (`message`) and GoTrue (`msg`, `error_description`) clients read.
  return JSON.stringify({
    code: status === 400 ? '22023' : 'E2E500',
    message: INJECTED_SUPABASE_ERROR_MESSAGE,
    msg: INJECTED_SUPABASE_ERROR_MESSAGE,
    error: 'e2e_injected_failure',
    error_description: INJECTED_SUPABASE_ERROR_MESSAGE,
    details: null,
    hint: null,
  })
}

/**
 * Fail the next browser → Supabase call to one resource (the app's direct client writes and reads).
 * `abort` is a dropped connection; `http-400` / `http-500` are error replies carrying
 * INJECTED_SUPABASE_ERROR_MESSAGE. Pass `method` (e.g. 'POST' for an insert, 'PATCH' for an
 * update) so a read of the same table on the same screen is not the one that fails.
 */
export async function failNextSupabaseCall(
  page: Page,
  input: { resource: SupabaseResource; method?: string; mode: SupabaseFault; times?: number },
): Promise<FaultHandle> {
  return interceptMatching(
    page,
    (request) => isSupabaseRequest(request, input),
    input.times ?? 1,
    async (route) => {
      if (input.mode === 'abort') {
        await route.abort('failed')
        return
      }
      const status = input.mode === 'http-400' ? 400 : 500
      const origin = route.request().headers()['origin'] ?? '*'
      await route.fulfill({
        status,
        contentType: 'application/json',
        // Cross-origin: without these the browser hides the reply and reports a network error.
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-expose-headers': '*',
        },
        body: supabaseErrorBody(status),
      })
    },
  )
}

/** Hold the next browser → Supabase call to one resource until `release()`. */
export async function holdNextSupabaseCall(
  page: Page,
  input: { resource: SupabaseResource; method?: string },
): Promise<HoldHandle> {
  return holdMatching(page, (request) => isSupabaseRequest(request, input))
}

/**
 * Console noise an injected fault legitimately produces, for attachErrorGuards'
 * `expectedFailures`. Chromium logs `Failed to load resource: net::ERR_FAILED` / `… status of
 * 500`; WebKit logs its own wording for the same events.
 */
export function expectedFaultConsoleErrors(
  target: 'server-action' | SupabaseResource,
): { url: RegExp; text: RegExp }[] {
  const text = /Failed to load resource|net::ERR_FAILED|status of (?:400|404|500)|network connection was lost|cancelled|Load failed/i
  if (target === 'server-action') {
    return [{ url: /^http:\/\/localhost:3000\//, text }]
  }
  const origin = supabaseOrigin().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const path = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [{ url: new RegExp(`^${origin}/${path}(?:[/?]|$)`), text }]
}

/** Toasts (Radix `status`), inline `role=alert` messages and the toast region. */
function messageSurfaces(page: Page): Locator {
  return page.getByRole('alert')
    .or(page.getByRole('status'))
    .or(page.getByRole('region', { name: /^Notifications/ }).locator('li'))
}

export async function expectFailureMessage(page: Page, message: string | RegExp): Promise<void> {
  await expect(
    messageSurfaces(page).filter({ hasText: message }).filter({ visible: true }).first(),
    `the failure message ${String(message)} was not shown in a toast or alert`,
  ).toBeVisible()
}

/**
 * After a fault: the message is on screen, the control is back to idle (visible, enabled, idle
 * label), nothing is left in its pending state, and the fault actually fired.
 *
 * `button` must keep matching across both labels, e.g.
 * `dialog.getByRole('button', { name: /^(Save Settings|Saving…)$/ })` or a `type=submit` locator.
 * `pendingName` defaults to any button whose name ends in an ellipsis.
 */
export async function expectButtonRecovers(
  button: Locator,
  input: {
    idleName: string | RegExp
    message: string | RegExp
    fault: { hit(): boolean }
    pendingName?: string | RegExp
  },
): Promise<void> {
  const page = button.page()
  expect(input.fault.hit(), 'the injected fault never fired; the spec did not exercise a failure').toBe(true)
  await expectFailureMessage(page, input.message)
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName(input.idleName)
  const pending = typeof input.pendingName === 'string'
    ? page.getByRole('button', { name: input.pendingName, exact: true })
    : page.getByRole('button', { name: input.pendingName ?? /(?:…|\.\.\.)$/ })
  await expect(pending.filter({ visible: true })).toHaveCount(0)
}
