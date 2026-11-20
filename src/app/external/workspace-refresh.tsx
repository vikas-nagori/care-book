'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function RefreshWorkspace() {
  const router = useRouter()

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState !== 'visible') return
      router.refresh()
    }
    function refreshRestoredPage(event: PageTransitionEvent) {
      if (event.persisted) refreshWhenVisible()
    }

    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('pageshow', refreshRestoredPage)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('pageshow', refreshRestoredPage)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [router])

  return null
}
