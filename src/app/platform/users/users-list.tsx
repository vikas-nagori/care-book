'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import type { PlatformUserSummary } from '@/lib/supabase/types'
import { blockUser, sendPasswordReset, unblockUser } from './actions'

type UsersListProps = {
  users: PlatformUserSummary[]
  superadminIds: string[]
}

export function UsersList({ users, superadminIds }: UsersListProps) {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resetBusyId, setResetBusyId] = useState<string | null>(null)
  const superadmins = new Set(superadminIds)

  async function sendReset(user: PlatformUserSummary) {
    setResetBusyId(user.id)
    const result = await sendPasswordReset({ userId: user.id })
    setResetBusyId(null)

    toast({
      title: result.success ? 'Reset link sent' : 'Could not send reset link',
      description: result.success
        ? `A password reset link was emailed to ${user.email}.`
        : result.message,
      variant: result.success ? 'default' : 'destructive',
    })
  }

  async function toggle(user: PlatformUserSummary) {
    const isBlocked = user.status === 'blocked'
    setBusyId(user.id)
    const result = isBlocked
      ? await unblockUser({ userId: user.id })
      : await blockUser({ userId: user.id })
    setBusyId(null)

    toast({
      title: result.success ? (isBlocked ? 'User unblocked' : 'User blocked') : 'Action failed',
      description: result.success
        ? isBlocked
          ? 'They can sign in again.'
          : 'They have been signed out and can no longer log in.'
        : result.message,
      variant: result.success ? 'default' : 'destructive',
    })
  }

  if (users.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">No users yet.</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {users.map((user) => {
        const isBusy = busyId === user.id
        const isBlocked = user.status === 'blocked'
        const isSuperadmin = superadmins.has(user.id)
        const clinicInactive = user.clinic_status === 'inactive'

        return (
          <Card key={user.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{user.full_name || user.email}</span>
                  <Badge variant="outline">{user.role}</Badge>
                  {isSuperadmin ? <Badge variant="secondary">superadmin</Badge> : null}
                  {isBlocked ? <Badge variant="destructive">blocked</Badge> : null}
                  {clinicInactive ? <Badge variant="destructive">clinic blocked</Badge> : null}
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  {user.email} · {user.clinic_name ?? 'No clinic'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => sendReset(user)}
                  disabled={resetBusyId === user.id}
                  aria-label={`Send reset for ${user.email}`}
                >
                  {resetBusyId === user.id ? <Loader2 className="mr-1 animate-spin" size={14} /> : null}
                  Send reset
                </Button>
                {isSuperadmin ? (
                  <span className="text-sm text-muted-foreground">Protected</span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant={isBlocked ? 'default' : 'destructive'}
                    onClick={() => toggle(user)}
                    disabled={isBusy}
                    aria-label={`${isBlocked ? 'Unblock' : 'Block'} user ${user.email}`}
                  >
                    {isBusy ? <Loader2 className="mr-1 animate-spin" size={14} /> : null}
                    {isBlocked ? 'Unblock' : 'Block'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
