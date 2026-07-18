'use client'

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
import { useToast } from '@/hooks/use-toast'
import type { UserInvite } from '@/lib/supabase/types'
import { resendUserInvite, revokeUserInvite } from './actions'

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

  async function handleResend(inviteId: string) {
    setBusyInviteId(inviteId)
    const result = await resendUserInvite({ inviteId })

    if (!result.success) {
      toast({
        title: 'Invite not resent',
        description: result.message,
        variant: 'destructive',
      })
      setBusyInviteId(null)
      return
    }

    toast({
      title: 'Invite resent',
      description: `A fresh invite email went to ${result.invite.email}.`,
    })
    router.refresh()
    setBusyInviteId(null)
  }

  async function handleRevoke(inviteId: string) {
    setBusyInviteId(inviteId)
    const result = await revokeUserInvite({ inviteId })

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
      description: `${result.invite.email} can no longer complete onboarding from the old invite link.`,
    })
    router.refresh()
    setBusyInviteId(null)
  }

  const emptyState = <p className="text-sm text-muted-foreground">No invites have been sent yet.</p>

  if (variant === 'sheet') {
    if (invites.length === 0) return emptyState

    return (
      <div className="space-y-3">
        {invites.map((invite) => {
          const isBusy = busyInviteId === invite.id
          const dateLabel = invite.status === 'accepted'
            ? `Accepted ${formatTimestamp(invite.accepted_at)}`
            : invite.status === 'pending'
              ? `Sent ${formatTimestamp(invite.created_at)}`
              : `Revoked ${formatTimestamp(invite.revoked_at)}`

          return (
            <section key={invite.id} className="space-y-3 rounded-lg border border-[var(--ph-line)] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-all text-sm font-semibold text-[var(--ph-ink)]">
                  {invite.email}
                </p>
                <Badge className="shrink-0" variant={getInviteBadgeVariant(invite.status)}>
                  {invite.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>{invite.role}</Badge>
                <span className="text-right">{dateLabel}</span>
              </div>
              {invite.status === 'pending' && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={isBusy}
                    onClick={() => handleResend(invite.id)}
                  >
                    {isBusy ? 'Working...' : 'Resend'}
                  </Button>
                  <Button
                    type="button"
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
        {invites.length === 0 ? emptyState : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
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
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell>
                        <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>
                          {invite.role}
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
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => handleResend(invite.id)}
                            >
                              {isBusy ? 'Working...' : 'Resend'}
                            </Button>
                            <Button
                              type="button"
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
