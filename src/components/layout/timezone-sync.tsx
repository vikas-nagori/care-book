'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isValidTimeZone, USER_TIME_ZONE_COOKIE } from '@/lib/timezone'

function readTimeZoneCookie() {
  const prefix = `${USER_TIME_ZONE_COOKIE}=`
  const entry = document.cookie
    .split('; ')
    .find((value) => value.startsWith(prefix))

  if (!entry) return null

  try {
    return decodeURIComponent(entry.slice(prefix.length))
  } catch {
    return null
  }
}

export function TimezoneSync() {
  const router = useRouter()

  useEffect(() => {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!isValidTimeZone(browserTimeZone)) return

    const storedTimeZone = readTimeZoneCookie()
    if (storedTimeZone === browserTimeZone) return

    document.cookie = `${USER_TIME_ZONE_COOKIE}=${encodeURIComponent(browserTimeZone)}; Path=/; Max-Age=31536000; SameSite=Lax`
    router.refresh()
  }, [router])

  return null
}
