'use client'

import { useRef, useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import type { ServerActionCallFailure } from '@/lib/actions/call-server-action'

/**
 * Pending state and failure message for a Logout / Sign out button (G-15).
 *
 * `signOut` is `() => callServerAction(() => theSignOutAction())`. A successful sign out ends in
 * `redirect('/login')`: callServerAction rethrows that, the router is already navigating, and the
 * button stays in its pending state until the page goes. Any failure (dropped connection, a phone
 * left on the previous build) comes back as a result instead: it is shown as a toast and the
 * button is usable again, where the native form action it replaces fell through to the error screen.
 */
export function useSignOut(
  signOut: () => Promise<void | ServerActionCallFailure>,
  failureTitle: string,
): { pending: boolean; run: () => Promise<void> } {
  const { toast } = useToast()
  // A second tap before React re-renders the disabled button must not send a second request.
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)

  async function run() {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    // A redirect rejects here and is left to the router (see above); only a result returns.
    const result = await signOut()
    inFlight.current = false
    setPending(false)
    if (result && result.success === false) {
      toast({ title: failureTitle, description: result.message, variant: 'destructive' })
    }
  }

  return { pending, run }
}
