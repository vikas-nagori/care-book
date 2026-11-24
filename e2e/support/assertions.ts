import { expect, type ConsoleMessage, type Locator, type Page, type Response } from '@playwright/test'

import type { RouteLandmark, RouteRuntimeCase } from './route-manifest'

const CRASH_TEXT = [
  'Application error',
  'Internal Server Error',
  'This page could not be found',
  'something went wrong',
  // The app's own error boundary (src/app/error.tsx).
  'Unable to load this page',
] as const

export type ExpectedConsoleFailure = { url: RegExp; text: RegExp }

const LOCAL_VERCEL_OBSERVABILITY_PATHS = ['/_vercel/insights/', '/_vercel/speed-insights/'] as const

function isKnownNonAppConsoleError(
  message: ConsoleMessage,
  observabilityRedirectTargets: ReadonlySet<string>,
): boolean {
  const text = message.text()

  // These Vercel-managed scripts are not served by local `next start`. Match both the exact
  // request origin and the narrow failure shape so unrelated application 404s remain failures.
  const sourceUrl = message.location().url
  const isKnownObservabilityRequest = LOCAL_VERCEL_OBSERVABILITY_PATHS.some(
    (path) => sourceUrl.includes(path) || text.includes(path),
  ) || [...observabilityRedirectTargets].some((url) => text.includes(url))

  return isKnownObservabilityRequest
    // Next renders the HTML not-found page for document requests but, since 16.3, answers
    // subresource requests (sec-fetch-dest: script) with a plain-text 404 instead.
    && (text.includes('404 (Not Found)')
      || text.includes("MIME type ('text/html') is not executable")
      || text.includes("MIME type ('text/plain') is not executable")
      // WebKit's wording for the same refusal (mobile-ios).
      || (text.includes('Refused to execute') && text.includes('is not a script MIME type'))
      || /the server responded with a status of 404/.test(text))
}

function landmarkLocator(page: Page, landmark: RouteLandmark): Locator {
  const options = { name: landmark.name, exact: true } as const

  if (landmark.kind === 'heading') {
    return page.getByRole('heading', options).filter({ visible: true })
  }

  if (landmark.kind === 'button') {
    return page.getByRole('button', options).filter({ visible: true })
  }

  return page.getByText(landmark.name, { exact: true }).filter({ visible: true })
}

function queryRecord(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams.entries())
}

async function assertExpectedLocation(
  page: Page,
  expected: RouteRuntimeCase['expected'],
): Promise<void> {
  await expect.poll(() => new URL(page.url()).pathname).toBe(expected.pathname)
  expect(queryRecord(new URL(page.url()))).toEqual(expected.query ?? {})
}

/**
 * Attach before navigation and assert after the route landmark is visible. This catches errors
 * emitted during both the document request and client hydration.
 */
export function attachErrorGuards(page: Page, options: {
  expectedHttpErrors?: readonly { pathname: string; status: number }[]
  /**
   * Console errors a spec causes on purpose, matched by the message's source URL (any origin) and
   * text. An aborted request logs `net::ERR_FAILED`, and Supabase is a different origin from the
   * app, which `expectedHttpErrors` cannot express. See expectedFaultConsoleErrors().
   */
  expectedFailures?: readonly ExpectedConsoleFailure[]
  /**
   * CRASH_TEXT entries a spec expects on screen, e.g. 'something went wrong' when it provokes
   * requestErrorMessage()'s fallback copy. Every other crash text is still checked.
   */
  allowCrashText?: readonly string[]
} = {}) {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const observabilityRedirectTargets = new Set<string>()

  // WebKit rejects the old document's in-flight RSC fetches ("… due to access control checks",
  // "Load failed") while a reload or navigation tears it down, and reports them as uncaught. The user never sees that
  // document again, so ignore exactly that error shape right after a main-frame navigation starts.
  // Observed 1–3 ms after the navigation request; the window stays tight so a real failure that
  // merely happens soon after a page load is still reported.
  const UNLOAD_ABORT_WINDOW_MS = 1_000
  let mainFrameNavigationAt = -Infinity
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) mainFrameNavigationAt = Date.now()
  })
  page.on('pageerror', (error) => {
    const abortedByUnload = (/[?&]_rsc=\S* due to access control checks\.$/.test(error.message)
      || error.message === 'Load failed')
      && Date.now() - mainFrameNavigationAt < UNLOAD_ABORT_WINDOW_MS
    if (!abortedByUnload) pageErrors.push(error.stack ?? error.message)
  })
  page.on('response', (response) => {
    let request = response.request()
    while (request) {
      if (LOCAL_VERCEL_OBSERVABILITY_PATHS.some((path) => request.url().includes(path))) {
        observabilityRedirectTargets.add(response.url())
        break
      }
      request = request.redirectedFrom()!
    }
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // Opt-in only: a tested HTTP refusal is expected browser resource noise. Keep
    // errors from every other origin, route and status visible to the guard.
    const expectedHttpError = options.expectedHttpErrors?.some(({ pathname, status }) => {
      try {
        const source = new URL(message.location().url)
        return source.origin === new URL(page.url()).origin && source.pathname === pathname
          && message.text().startsWith(`Failed to load resource: the server responded with a status of ${status} (`)
      } catch { return false }
    })
    if (expectedHttpError) return
    const expectedFailure = options.expectedFailures?.some(({ url, text }) =>
      url.test(message.location().url) && text.test(message.text()))
    if (expectedFailure) return
    // Next's console report of the same WebKit teardown abort (see the pageerror handler above).
    const rscAbortedByUnload = /^Failed to fetch RSC payload for \S+\. Falling back to browser navigation\. TypeError: (?:Load failed|.*access control checks\.)$/.test(message.text())
      && Date.now() - mainFrameNavigationAt < UNLOAD_ABORT_WINDOW_MS
    if (rscAbortedByUnload) return
    if (!isKnownNonAppConsoleError(message, observabilityRedirectTargets)) consoleErrors.push(message.text())
  })

  return {
    async assertClean() {
      expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
      expect(consoleErrors, `browser console errors:\n${consoleErrors.join('\n')}`).toEqual([])

      for (const text of CRASH_TEXT) {
        if (options.allowCrashText?.includes(text)) continue
        await expect(page.getByText(text, { exact: false })).toHaveCount(0)
      }
    },
  }
}

/** Load a declared render route and prove it did not redirect, 404, or crash. */
export async function gotoSuccessfulRoute(page: Page, route: RouteRuntimeCase): Promise<Response> {
  expect(route.expected.kind).toBe('render')
  const guards = attachErrorGuards(page)
  const response = await page.goto(route.requestPath, { waitUntil: 'domcontentloaded' })

  expect(response, `GET ${route.requestPath} did not return a document response`).not.toBeNull()
  expect(response!.ok(), `GET ${route.requestPath} returned ${response!.status()}`).toBe(true)
  expect(
    response!.request().redirectedFrom(),
    `GET ${route.requestPath} unexpectedly redirected to ${page.url()}`,
  ).toBeNull()

  await assertExpectedLocation(page, route.expected)
  await expect(landmarkLocator(page, route.landmark)).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
  return response!
}

/** Load a route whose redirect is the intended access/session behavior. */
export async function gotoExpectedRedirect(page: Page, route: RouteRuntimeCase): Promise<Response> {
  expect(route.expected.kind).toBe('redirect')
  const response = await page.goto(route.requestPath, { waitUntil: 'domcontentloaded' })

  expect(response, `GET ${route.requestPath} did not return a final document response`).not.toBeNull()
  expect(response!.ok(), `redirect target for GET ${route.requestPath} returned ${response!.status()}`).toBe(true)

  await assertExpectedLocation(page, route.expected)
  const requested = new URL(route.requestPath, page.url())
  const final = new URL(page.url())
  expect(
    `${final.pathname}${final.search}`,
    `GET ${route.requestPath} did not leave the requested location`,
  ).not.toBe(`${requested.pathname}${requested.search}`)
  await expect(landmarkLocator(page, route.landmark)).toBeVisible()
  return response!
}

/** Explicitly named access-denial helper so a denial can never be mistaken for route smoke. */
export async function gotoDeniedRoute(page: Page, route: RouteRuntimeCase): Promise<Response> {
  return gotoExpectedRedirect(page, route)
}

/** Load a dynamic App Router route whose intended denial is Next's streamed soft-404 UI. */
export async function gotoNotFoundRoute(page: Page, requestPath: string): Promise<Response> {
  const response = await page.goto(requestPath, { waitUntil: 'domcontentloaded' })

  expect(response, `GET ${requestPath} did not return a document response`).not.toBeNull()
  // These dynamic routes begin streaming their layout before `notFound()` resolves, so Next 16
  // returns the document as 200 and replaces the route body with its not-found boundary.
  expect(response!.status(), `GET ${requestPath} did not return Next's streamed response`).toBe(200)
  expect(
    response!.request().redirectedFrom(),
    `GET ${requestPath} unexpectedly redirected to ${page.url()}`,
  ).toBeNull()

  const requested = new URL(requestPath, page.url())
  const final = new URL(page.url())
  expect(`${final.pathname}${final.search}`).toBe(`${requested.pathname}${requested.search}`)
  await expect(page.getByRole('heading', {
    name: 'This page could not be found.',
    exact: true,
  })).toBeVisible()
  return response!
}

/**
 * Words that legitimately contain a leak token. They are removed before scanning. Keep this list
 * short and add to it only for real copy, never to silence a leak.
 */
export const LEAK_ALLOWED_WORDS = ['annul…', 'nullif…', 'nullable'] as const
const LEAK_ALLOWED_PATTERN = String.raw`\b(?:annul\w*|nullif\w*|nullable)\b`

/**
 * Tokens a NULL or a bad number leaves behind when it is stringified into the UI:
 * `Invalid Date`, `[object Object]`, `Infinity`, `undefined` and `NaN` anywhere (also glued, as in
 * `NaNyears`), and lowercase `null` unless it sits inside a word on both sides (`nullm`, `₹null`
 * and `Ashanull` are leaks; `annulled` is not).
 */
const LEAK_TOKEN_PATTERN = String.raw`Invalid Date|\[object Object\]|Infinity|undefined|NaN|(?<![A-Za-z])null|null(?![a-z])`

export type LeakReport = {
  /** Visible text. */
  words: string[]
  /** aria-label / title / placeholder / alt and input/textarea values. */
  attributes: string[]
  /** `tel:null`-style links and contact links with nothing to call or write to. */
  links: string[]
  /** Text of elements that are not rendered: the hidden desktop/mobile twin of the current layout. */
  hiddenWords: string[]
}

/**
 * A record saved with its optional fields blank must not leak its NULLs onto the screen. Fails on
 * the LEAK_TOKEN_PATTERN tokens in visible text, in accessible/descriptive attributes and form
 * values, in link targets, in empty `tel:` / `mailto:` / `sms:` / `wa.me/` links, and in the text
 * of the hidden twin (the desktop table on a phone and vice versa), reported separately.
 * Pair with attachErrorGuards, which catches the crashes. `scope` limits the scan to one element,
 * e.g. an open dialog.
 */
export async function expectNoLeakedNulls(page: Page, options: { scope?: Locator } = {}): Promise<void> {
  const root = options.scope ?? page.locator('body')
  const leaks = await root.evaluate((element, patterns): LeakReport => {
    const token = () => new RegExp(patterns.token, 'g')
    const allowed = new RegExp(patterns.allowed, 'gi')
    const contexts = (raw: string): string[] => {
      const text = raw.replace(allowed, (word) => ' '.repeat(word.length))
      return [...text.matchAll(token())].map((match) => {
        const start = Math.max(0, (match.index ?? 0) - 30)
        return raw.slice(start, (match.index ?? 0) + match[0].length + 30).replace(/\s+/g, ' ').trim()
      })
    }

    const words = contexts((element as HTMLElement).innerText ?? '')

    const attributes: string[] = []
    const all = [element, ...element.querySelectorAll('*')]
    for (const node of all) {
      for (const name of ['aria-label', 'title', 'placeholder', 'alt']) {
        const value = node.getAttribute(name)
        if (value) for (const hit of contexts(value)) attributes.push(`${node.tagName.toLowerCase()}[${name}]: ${hit}`)
      }
      if ((node instanceof HTMLInputElement && node.type !== 'password') || node instanceof HTMLTextAreaElement) {
        for (const hit of contexts(node.value)) attributes.push(`${node.tagName.toLowerCase()}[value]: ${hit}`)
      }
    }

    const links: string[] = []
    for (const anchor of element.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') ?? ''
      const scheme = href.match(/^(tel|sms|mailto):(.*)$/i)
      const emptyContact = scheme
        ? (scheme[1].toLowerCase() === 'mailto'
          ? !decodeURIComponent(scheme[2].split('?')[0]).trim()
          : scheme[2].split('?')[0].replace(/\D/g, '').length < 3)
        : /^(?:https?:)?\/\/(?:www\.|api\.)?wa\.me\/?(?:[?#].*)?$/i.test(href)
      if (emptyContact || /(^|[:/=])(null|undefined|NaN)($|[/?&#])/.test(href)) links.push(href)
    }

    const hiddenWords: string[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || !node.textContent?.trim()) continue
      if (parent.closest('script, style, noscript, template')) continue
      const rendered = typeof parent.checkVisibility === 'function'
        ? parent.checkVisibility()
        : parent.getClientRects().length > 0
      if (rendered) continue
      hiddenWords.push(...contexts(node.textContent ?? ""))
    }

    return { words, attributes, links, hiddenWords }
  }, { token: LEAK_TOKEN_PATTERN, allowed: LEAK_ALLOWED_PATTERN })

  expect(leaks, `leaked null-ish values on ${page.url()}`).toEqual({
    words: [], attributes: [], links: [], hiddenWords: [],
  })
}
