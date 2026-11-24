'use client'

import { Button, type ButtonProps } from '@/components/ui/button'
import { useSignOut } from '@/hooks/use-sign-out'
import { callServerAction } from '@/lib/actions/call-server-action'
import { logoutFromSettings } from './actions'

/** Settings → Your Account → Logout (clinic users and the External Staff account page). */
export function LogoutButton({ className, size }: Pick<ButtonProps, 'className' | 'size'>) {
  const { pending, run } = useSignOut(() => callServerAction(() => logoutFromSettings()), 'Not logged out')

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      disabled={pending}
      onClick={() => void run()}
    >
      {pending ? 'Logging out…' : 'Logout'}
    </Button>
  )
}
