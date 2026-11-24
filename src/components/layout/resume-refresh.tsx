'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { CLIENT_APP_VERSION, isNewerDeployment, shouldRefreshOnResume } from '@/lib/app-version'
import { shouldHideAppChrome } from '@/lib/layout/app-chrome'

/** What a resume should do once it has asked the server which build is live. */
type ResumeAction = 'reload' | 'refresh' | 'wait'

/**
 * A static file outside the middleware: answering at all proves the app's server is reachable,
 * without touching the session. Used only when the version check got no answer.
 */
const REACHABILITY_PROBE = '/manifest.json'

async function decideResumeAction(): Promise<ResumeAction> {
  try {
    const response = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' })
    const body = response.ok ? await response.json().catch(() => null) : null
    return isNewerDeployment(CLIENT_APP_VERSION, body?.version) ? 'reload' : 'refresh'
  } catch {
    // No answer at all. Refresh only if the server can be reached some other way: a failed
    // router.refresh() falls back to a full page load, and with no connection that load ends on
    // the browser's offline error page instead of the screen the user was looking at.
    try {
      await fetch(REACHABILITY_PROBE, { method: 'HEAD', cache: 'no-store', credentials: 'omit' })
      return 'refresh'
    } catch {
      return 'wait'
    }
  }
}

/**
 * Phones suspend the installed app in the background. When it comes back after a while, bring the
 * screen up to date in place — the session cookie is reused, so nobody is asked to sign in.
 *
 * - A new deployment is live: reload once, so the app stops running a stale bundle.
 * - Otherwise: refresh the current route's data (router.refresh keeps scroll and client state).
 * - No connection (the device says it is offline, or neither the version check nor the server
 *   answers): leave the screen exactly as it is and catch up when the connection is back — on the
 *   browser's `online` event or the next time the app is brought to the front.
 *
 * A killed app needs none of this: reopening it is a normal page load.
 */
export function ResumeRefresh() {
  const router = useRouter()
  const pathname = usePathname()
  const paused = shouldHideAppChrome(pathname)

  useEffect(() => {
    if (paused) return
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null
    let checking = false
    // A resume that could not reach the server and still has to catch up.
    let pending = false
    let disposed = false

    async function catchUp() {
      if (checking) return
      if (navigator.onLine === false) {
        pending = true
        return
      }
      checking = true
      pending = false
      try {
        const action = await decideResumeAction()
        if (disposed) return
        if (action === 'reload') window.location.reload()
        else if (action === 'refresh') router.refresh()
        else pending = true
      } finally {
        checking = false
      }
    }

    function resume() {
      if (!pending && !shouldRefreshOnResume(hiddenAt, Date.now())) return
      if (checking) return
      hiddenAt = null
      void catchUp()
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else resume()
    }
    function onPageShow(event: PageTransitionEvent) {
      // Restored from the back/forward cache: treat it as a resume of unknown length.
      if (event.persisted) {
        hiddenAt = hiddenAt ?? 0
        resume()
      }
    }
    function onOnline() {
      if (pending && document.visibilityState === 'visible') void catchUp()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
    }
  }, [paused, router])

  return null
}
