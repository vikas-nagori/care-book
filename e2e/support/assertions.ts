import { expect, type ConsoleMessage, type Locator, type Page, type Response } from '@playwright/test'

import type { RouteLandmark, RouteRuntimeCase } from './route-manifest'

const CRASH_TEXT = [
  'Application error',
  'Internal Server Error',
  'This page could not be found',
  'something went wrong',
] as const

// Browser extensions/content blockers can emit this without the application logging an error.
// Keep this deliberately narrow: HTTP failures, React errors, and application messages must fail.
const KNOWN_NON_APP_CONSOLE_ERRORS = [/^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT$/] as const
const LOCAL_VERCEL_OBSERVABILITY_PATHS = ['/_vercel/insights/', '/_vercel/speed-insights/'] as const

function isKnownNonAppConsoleError(
  message: ConsoleMessage,
  observabilityRedirectTargets: ReadonlySet<string>,
): boolean {
  const text = message.text()
  if (KNOWN_NON_APP_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) return true

  // These Vercel-managed scripts are not served by local `next start`. Match both the exact
  // request origin and the narrow failure shape so unrelated application 404s remain failures.
  const sourceUrl = message.location().url
  const isKnownObservabilityRequest = LOCAL_VERCEL_OBSERVABILITY_PATHS.some(
    (path) => sourceUrl.includes(path) || text.includes(path),
  ) || [...observabilityRedirectTargets].some((url) => text.includes(url))

  return isKnownObservabilityRequest
    && (text.includes('404 (Not Found)') || text.includes("MIME type ('text/html') is not executable"))
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
export function attachErrorGuards(page: Page) {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const observabilityRedirectTargets = new Set<string>()

  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
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
    if (!isKnownNonAppConsoleError(message, observabilityRedirectTargets)) consoleErrors.push(message.text())
  })

  return {
    async assertClean() {
      expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
      expect(consoleErrors, `browser console errors:\n${consoleErrors.join('\n')}`).toEqual([])

      for (const text of CRASH_TEXT) {
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
