// Browser console lines the app does not cause, recognised by exact wording so that real errors
// stay visible to attachErrorGuards (assertions.ts). Pure functions, unit-tested in
// console-noise.test.ts.

/** The app origin every project runs against (playwright.config.ts `baseURL`). */
export const APP_ORIGIN = 'http://localhost:3000'

/**
 * Vercel Analytics / Speed Insights scripts. Vercel serves them in production; the local
 * `next start` does not, so the browser's request for them either 404s (as plain text) or, when
 * the middleware does not let the path through for this session, is redirected to a page.
 */
export const LOCAL_VERCEL_OBSERVABILITY_PATHS = ['/_vercel/insights/', '/_vercel/speed-insights/'] as const

/**
 * Where src/middleware.ts redirects a GET it will not serve: `/login?next=…` when signed out,
 * `/auth/change-password` while `must_change_password` is armed, `/external` for External Staff
 * (and any account whose profile read is empty: blocked, clinicless), `/platform` for the
 * platform super-admin. An analytics `<script>` that lands on one of them gets HTML back and the
 * browser refuses to run it. No other script the app loads passes through the middleware
 * (`/_next/static` is excluded from its matcher), so a landing page refused *as a script* can
 * only be that analytics request.
 */
export const ROLE_LANDING_PATHS = ['/login', '/auth/change-password', '/external', '/platform'] as const

/**
 * The URL of a script the browser refused to execute because of its MIME type, from the exact
 * console wording of Chromium or WebKit; null for any other message.
 */
export function refusedScript(text: string): { url: string; mimeType: string | null } | null {
  // Chromium: Refused to execute script from 'URL' because its MIME type ('text/html') is not
  // executable, and strict MIME type checking is enabled.
  const chromium = /^Refused to execute script from '([^']+)' because its MIME type \('([^']*)'\) is not executable(?:, and strict MIME type checking is enabled)?\.$/.exec(text)
  if (chromium) return { url: chromium[1], mimeType: chromium[2] }
  // WebKit (LoadableClassicScript), when the response carries `X-Content-Type-Options: nosniff`,
  // as every app response does (next.config.mjs). The MIME type is not named.
  const nosniff = /^Refused to execute (\S+) as script because "X-Content-Type-Options: nosniff" was given and its Content-Type is not a script MIME type\.$/.exec(text)
  if (nosniff) return { url: nosniff[1], mimeType: null }
  // WebKit without nosniff: Refused to execute URL as script because text/html is not a script MIME type.
  const webkit = /^Refused to execute (\S+) as script because "?([^"\s]+)"? is not a script MIME type\.$/.exec(text)
  if (webkit) return { url: webkit[1], mimeType: webkit[2] }
  return null
}

function isObservabilityPath(pathname: string): boolean {
  return LOCAL_VERCEL_OBSERVABILITY_PATHS.some((path) => pathname.startsWith(path))
}

/**
 * True only for the browser refusing to run a script that is the locally-missing Vercel
 * analytics: the refused URL is on the app origin and is either one of the `/_vercel/` script
 * paths, an observed redirect target of one, or a role landing page with any query (see
 * ROLE_LANDING_PATHS; covers `/login?next=/_vercel/…`). The page served as the "script" must be
 * HTML or plain text where the browser names it (WebKit's nosniff wording does not). Works without the redirect chain, which Playwright hides while a catch-all
 * `page.route()` is active and which can arrive after the console message.
 */
export function isObservabilityScriptRefusal(
  text: string,
  observedRedirectTargets: ReadonlySet<string> = new Set(),
): boolean {
  const refused = refusedScript(text)
  if (!refused) return false
  if (refused.mimeType !== null && !/^text\/(?:html|plain)\b/.test(refused.mimeType)) return false
  let url: URL
  try {
    url = new URL(refused.url)
  } catch {
    return false
  }
  if (url.origin !== APP_ORIGIN) return false
  if (isObservabilityPath(url.pathname)) return true
  if (observedRedirectTargets.has(url.href)) return true
  return (ROLE_LANDING_PATHS as readonly string[]).includes(url.pathname)
}

/**
 * The narrower legacy shape: a 404 or MIME refusal whose source URL or text names a `/_vercel/`
 * script path or an observed redirect target of one.
 */
export function isObservabilityLoadFailure(
  text: string,
  sourceUrl: string,
  observedRedirectTargets: ReadonlySet<string> = new Set(),
): boolean {
  const namesObservability = LOCAL_VERCEL_OBSERVABILITY_PATHS.some(
    (path) => sourceUrl.includes(path) || text.includes(path),
  ) || [...observedRedirectTargets].some((url) => text.includes(url))

  return namesObservability
    // Next renders the HTML not-found page for document requests but, since 16.3, answers
    // subresource requests (sec-fetch-dest: script) with a plain-text 404 instead.
    && (text.includes('404 (Not Found)')
      || text.includes("MIME type ('text/html') is not executable")
      || text.includes("MIME type ('text/plain') is not executable")
      // WebKit's wording for the same refusal (mobile-ios).
      || (text.includes('Refused to execute') && text.includes('is not a script MIME type'))
      || /the server responded with a status of 404/.test(text))
}

/** Either shape of the locally-missing Vercel analytics scripts. */
export function isKnownNonAppConsoleError(
  text: string,
  sourceUrl: string,
  observedRedirectTargets: ReadonlySet<string> = new Set(),
): boolean {
  return isObservabilityScriptRefusal(text, observedRedirectTargets)
    || isObservabilityLoadFailure(text, sourceUrl, observedRedirectTargets)
}
