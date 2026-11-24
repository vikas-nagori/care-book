// Helpers for the installed phone app, the primary client (plan section 1.1). They simulate what a
// phone does to the app (background it, resume it, ship a new build, share sheets, small screens)
// and check what a thumb can actually reach.

import { expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'

/** Tag for the subset that also runs on the `mobile-ios` (WebKit, iPhone 14) project. */
export const IOS_TAG = '@ios'

/** Pixel 5, the viewport of the `*-mobile` Chromium projects. */
export const PHONE_VIEWPORT = { width: 393, height: 851 } as const
/** iPhone SE (1st gen) class: the smallest phone layout the app must still fit. */
export const SMALL_PHONE_VIEWPORT = { width: 320, height: 568 } as const

/** True for every phone project: `admin-mobile`, `staff-mobile`, `external-mobile`, `public-mobile`, `mobile-ios`. */
export function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.endsWith('-mobile') || testInfo.project.name === 'mobile-ios'
}

/** The signed-in role a project runs as. `mobile-ios` signs in as the clinic admin. */
export function projectRole(testInfo: TestInfo): 'admin' | 'staff' | 'external' | 'platform' | 'public' {
  const name = testInfo.project.name
  if (name === 'mobile-ios' || name.startsWith('admin-')) return 'admin'
  if (name.startsWith('staff-')) return 'staff'
  if (name.startsWith('external-')) return 'external'
  if (name.startsWith('platform-')) return 'platform'
  return 'public'
}

const clockInstalled = new WeakSet<Page>()

/**
 * Put the app in the background for `minutes`, then bring it back, the way a phone does: the page
 * goes `hidden`, time passes, it becomes `visible` again and `visibilitychange` fires. The page
 * clock is installed on first use (or pass `clockAlreadyInstalled` when the spec installed it
 * before navigating). `persisted` instead replays a back/forward-cache restore: `pageshow` with
 * `persisted: true`, which the app treats as a resume of unknown length.
 */
export async function backgroundApp(
  page: Page,
  input: { minutes: number; persisted?: boolean; clockAlreadyInstalled?: boolean },
): Promise<void> {
  if (!input.clockAlreadyInstalled && !clockInstalled.has(page)) {
    await page.clock.install()
  }
  clockInstalled.add(page)

  const setVisibility = (state: 'hidden' | 'visible') => page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)

  await setVisibility('hidden')
  await page.clock.fastForward(Math.round(input.minutes * 60_000))
  if (input.persisted) {
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    return
  }
  await setVisibility('visible')
}

/**
 * Answer `GET /api/version` with `version`, so a resume sees a newer (or the same) deployment.
 * The e2e build's own version is `E2E_APP_VERSION` (VERCEL_GIT_COMMIT_SHA in .env.e2e); anything
 * else counts as newer. Returns how many version checks were answered. Pass `status` to make the
 * check fail instead.
 */
export async function serveAppVersion(
  page: Page,
  version: string | { status: number },
): Promise<{ count(): number; dispose(): Promise<void> }> {
  let count = 0
  const matcher = (url: URL) => url.pathname === '/api/version'
  const handler = async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    count += 1
    if (typeof version === 'string') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify({ version }),
      })
    } else {
      await route.fulfill({ status: version.status, contentType: 'text/plain', body: 'version check failed' })
    }
  }
  await page.route(matcher, handler)
  return {
    count: () => count,
    dispose: () => page.unroute(matcher, handler).catch(() => {}),
  }
}

/** The version the e2e build reports from `/api/version` and inlines into the client. */
export const E2E_APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'

/**
 * The element is fully inside the visual viewport and is what a tap at its centre would hit, so
 * the bottom navigation, a sticky header or the on-screen keyboard is not covering it.
 *
 * A disabled control (`disabled`, inside a disabled `<fieldset>`, or `aria-disabled="true"`) is
 * still checked: shadcn's `disabled:pointer-events-none` takes it out of hit-testing, so for the
 * hit test only its `pointer-events` is set to `auto` and restored straight after. An enabled
 * control with `pointer-events: none` cannot be tapped and is reported as such.
 */
export async function expectInViewport(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await locator.scrollIntoViewIfNeeded()
  await expect.poll(async () => locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const viewport = window.visualViewport
    const left = viewport?.offsetLeft ?? 0
    const top = viewport?.offsetTop ?? 0
    const width = viewport?.width ?? window.innerWidth
    const height = viewport?.height ?? window.innerHeight
    const problems: string[] = []
    if (box.width === 0 || box.height === 0) problems.push('has no size')
    if (box.left < left - 0.5 || box.top < top - 0.5
      || box.right > left + width + 0.5 || box.bottom > top + height + 0.5) {
      problems.push(`box ${JSON.stringify(box)} is outside the visual viewport ${width}x${height}+${left}+${top}`)
    }

    const html = element as HTMLElement
    const disabled = element.matches(':disabled') || element.closest('[aria-disabled="true"]') !== null
    const ignoresPointer = getComputedStyle(element).pointerEvents === 'none'
    if (ignoresPointer && !disabled) problems.push('has pointer-events: none, so a tap goes through it')
    // Make a disabled control hit-testable for this one probe; the inline style is put back as it was.
    const previous = { value: html.style.getPropertyValue('pointer-events'), priority: html.style.getPropertyPriority('pointer-events') }
    if (ignoresPointer && disabled) html.style.setProperty('pointer-events', 'auto', 'important')
    let hit: Element | null
    try {
      hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    } finally {
      if (ignoresPointer && disabled) {
        if (previous.value) html.style.setProperty('pointer-events', previous.value, previous.priority)
        else html.style.removeProperty('pointer-events')
      }
    }
    if (!ignoresPointer || disabled) {
      if (!hit || (hit !== element && !element.contains(hit))) {
        const coveredBy = hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''} "${(hit.textContent ?? '').trim().slice(0, 40)}"` : 'nothing'
        problems.push(`its centre is covered by ${coveredBy}`)
      }
    }
    return problems
  }), { message: 'element is not fully reachable on screen' }).toEqual([])
}

/** The page never scrolls sideways (the document is no wider than the screen). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(size.scrollWidth, `document is ${size.scrollWidth}px wide on a ${size.clientWidth}px screen`)
    .toBeLessThanOrEqual(size.clientWidth)
}

/**
 * Two activations of the control within one task, before React can re-render it as pending. This
 * is the double tap that slips through when the disabled state is only set after a commit.
 * Uses `HTMLElement.click()`, so it fires `click` (and submits a form) but not pointer/touch events.
 */
export async function tapTwice(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await locator.evaluate((element) => {
    (element as HTMLElement).click()
    ;(element as HTMLElement).click()
  })
}

export type ShareCall = {
  title?: string
  text?: string
  url?: string
  files: { name: string; type: string; size: number }[]
}

/**
 * Replace the native share sheet. Call before `page.goto` (it is an init script). Every
 * `navigator.share` call is recorded; `reject: true` makes it reject with `AbortError`, which is
 * what the browser does when the user dismisses the sheet. `canShareFiles: false` makes
 * `navigator.canShare({ files })` say no.
 */
export async function stubShare(
  page: Page,
  options: { reject?: boolean; canShareFiles?: boolean } = {},
): Promise<{ calls(): Promise<ShareCall[]> }> {
  await page.addInitScript((config) => {
    const calls: unknown[] = []
    Object.defineProperty(window, '__e2eShareCalls', { configurable: true, value: calls })
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data?: { files?: File[] }) => (data?.files?.length ? config.canShareFiles : true),
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { title?: string; text?: string; url?: string; files?: File[] } = {}) => {
        calls.push({
          title: data.title,
          text: data.text,
          url: data.url,
          files: (data.files ?? []).map((file) => ({ name: file.name, type: file.type, size: file.size })),
        })
        if (config.reject) throw new DOMException('Share canceled', 'AbortError')
      },
    })
  }, { reject: options.reject ?? false, canShareFiles: options.canShareFiles ?? true })
  return {
    calls: () => page.evaluate(() => (window as unknown as { __e2eShareCalls?: ShareCall[] }).__e2eShareCalls ?? []),
  }
}
