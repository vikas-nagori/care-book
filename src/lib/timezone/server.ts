import 'server-only'

import { cookies } from 'next/headers'
import { resolveTimeZone, USER_TIME_ZONE_COOKIE } from '@/lib/timezone'

export async function getUserTimeZone() {
  const cookieStore = await cookies()
  const encodedValue = cookieStore.get(USER_TIME_ZONE_COOKIE)?.value
  let value = encodedValue

  if (encodedValue) {
    try {
      value = decodeURIComponent(encodedValue)
    } catch {
      value = undefined
    }
  }

  return resolveTimeZone(value)
}
