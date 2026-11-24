'use client'

import { callServerAction } from '@/lib/actions/call-server-action'
import { accountContactLabel, accountDisplayName } from '@/lib/auth/mobile-number'
import { USER_ROLE_LABELS } from '@/lib/user-role'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TempPasswordDialog } from '@/components/onboarding/temp-password-dialog'
import { useToast } from '@/hooks/use-toast'
import type { TempPasswordCredentials, UserInvite } from '@/lib/supabase/types'
import { issueInviteTempPassword, revokeUserInvite } from './actions'

function getInviteBadgeVariant(status: UserInvite['status']) {
  if (status === 'accepted') return 'default'
  if (status === 'revoked') return 'outline'
  return 'secondary'
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Not yet'

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function UserInvitesList({
  invites,
  variant = 'card',
}: {
  invites: UserInvite[]
  variant?: 'card' | 'sheet'
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<TempPasswordCredentials | null>(null)

  async function handleNewPassword(inviteId: string) {
    setBusyInviteId(inviteId)
    const result = await callServerAction(() => issueInviteTempPassword({ inviteId }))

    if (!result.success) {
      toast({
        title: 'Password not reset',
        description: result.message,
        variant: 'destructive',
      })
      setBusyInviteId(null)
      return
    }

    toast({
      title: 'New temporary password',
      description: `The previous temporary password for ${accountDisplayName(result.invite)} no longer works.`,
    })
    setCredentials(result.credentials)
    router.refresh()
    setBusyInviteId(null)
  }

  async function handleRevoke(inviteId: string) {
    setBusyInviteId(inviteId)
    const result = await callServerAction(() => revokeUserInvite({ inviteId }))

    if (!result.success) {
      toast({
        title: 'Invite not revoked',
        description: result.message,
        variant: 'destructive',
      })
      setBusyInviteId(null)
      return
    }

    toast({
      title: 'Invite revoked',
      description: `${accountDisplayName(result.invite)} can no longer sign in.`,
    })
    router.refresh()
    setBusyInviteId(null)
  }

  const emptyState = <p className="text-sm text-muted-foreground">No invites have been sent yet.</p>
  const dialog = (
    <TempPasswordDialog credentials={credentials} onClose={() => setCredentials(null)} />
  )

  if (variant === 'sheet') {
    if (invites.length === 0) return emptyState

    return (
      <div className="space-y-3">
        {dialog}
        {invites.map((invite) => {
          const isBusy = busyInviteId === invite.id
          const dateLabel = invite.status === 'accepted'
            ? `Accepted ${formatTimestamp(invite.accepted_at)}`
            : invite.status === 'pending'
              ? `Invited ${formatTimestamp(invite.created_at)}`
              : `Revoked ${formatTimestamp(invite.revoked_at)}`

          return (
            <section key={invite.id} className="space-y-3 rounded-lg border border-[var(--ph-line)] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <InviteeLabel invite={invite} />
                <Badge className="shrink-0" variant={getInviteBadgeVariant(invite.status)}>
                  {invite.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>{USER_ROLE_LABELS[invite.role]}</Badge>
                <span className="text-right">{dateLabel}</span>
              </div>
              {invite.status === 'pending' && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    aria-label={`New temporary password for ${accountContactLabel(invite)}`}
                    variant="outline"
                    className="h-11"
                    disabled={isBusy}
                    onClick={() => handleNewPassword(invite.id)}
                  >
                    {isBusy ? 'Working...' : 'New password'}
                  </Button>
                  <Button
                    type="button"
                    aria-label={`Revoke invite to ${accountContactLabel(invite)}`}
                    variant="ghost"
                    className="h-11"
                    disabled={isBusy}
                    onClick={() => handleRevoke(invite.id)}
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invites</CardTitle>
      </CardHeader>
      <CardContent>
        {dialog}
        {invites.length === 0 ? emptyState : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="w-44 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => {
                  const isBusy = busyInviteId === invite.id

                  return (
                    <TableRow key={invite.id}>
                      <TableCell>
                        <InviteeLabel invite={invite} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>
                          {USER_ROLE_LABELS[invite.role]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getInviteBadgeVariant(invite.status)}>{invite.status}</Badge>
                      </TableCell>
                      <TableCell>{formatTimestamp(invite.updated_at)}</TableCell>
                      <TableCell className="text-right">
                        {invite.status === 'pending' ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              aria-label={`New temporary password for ${accountContactLabel(invite)}`}
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => handleNewPassword(invite.id)}
                            >
                              {isBusy ? 'Working...' : 'New password'}
                            </Button>
                            <Button
                              type="button"
                              aria-label={`Revoke invite to ${accountContactLabel(invite)}`}
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => handleRevoke(invite.id)}
                            >
                              Revoke
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {invite.status === 'accepted'
                              ? `Accepted ${formatTimestamp(invite.accepted_at)}`
                              : `Revoked ${formatTimestamp(invite.revoked_at)}`}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Who the invite is for: their name first (admins kept losing track of whose invite was pending
 * when only a number showed), then the login they sign in with. Invites made before names were
 * captured fall back to the login alone.
 */
function InviteeLabel({ invite }: { invite: UserInvite }) {
  const name = invite.full_name?.trim()
  const contact = accountContactLabel(invite)
  return (
    <div className="min-w-0">
      <p className="break-words text-sm font-semibold text-[var(--ph-ink)] [overflow-wrap:anywhere]">{name || contact}</p>
      {name && <p className="break-all text-xs text-muted-foreground">{contact}</p>}
    </div>
  )
}
