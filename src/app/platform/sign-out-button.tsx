'use client'

import { Button } from '@/components/ui/button'
import { useSignOut } from '@/hooks/use-sign-out'
import { callServerAction } from '@/lib/actions/call-server-action'
import { signOutFromPlatform } from './actions'

/** The platform console's Sign out (G-15: a failed request says so instead of the error screen). */
export function PlatformSignOutButton() {
  const { pending, run } = useSignOut(() => callServerAction(() => signOutFromPlatform()), 'Not signed out')

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run()}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
