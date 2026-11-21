'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { CLIENT_APP_VERSION, isNewerDeployment, shouldRefreshOnResume } from '@/lib/app-version'
import { shouldHideAppChrome } from '@/lib/layout/app-chrome'

/**
 * Phones suspend the installed app in the background. When it comes back after a while, bring the
 * screen up to date in place — the session cookie is reused, so nobody is asked to sign in.
 *
 * - A new deployment is live: reload once, so the app stops running a stale bundle.
 * - Otherwise: refresh the current route's data (router.refresh keeps scroll and client state).
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

    async function resume() {
      if (checking || !shouldRefreshOnResume(hiddenAt, Date.now())) return
      hiddenAt = null
      checking = true
      try {
        const response = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' })
        const body = response.ok ? await response.json().catch(() => null) : null
        if (isNewerDeployment(CLIENT_APP_VERSION, body?.version)) {
          window.location.reload()
          return
        }
      } catch {
        // Offline or a blip: still try to refresh the screen below.
      } finally {
        checking = false
      }
      router.refresh()
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else void resume()
    }
    function onPageShow(event: PageTransitionEvent) {
      // Restored from the back/forward cache: treat it as a resume of unknown length.
      if (event.persisted) {
        hiddenAt = hiddenAt ?? 0
        void resume()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [paused, router])

  return null
}
