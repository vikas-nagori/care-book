'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import type { ExternalStaff, UserInvite } from '@/lib/supabase/types'
import { createExternalStaff, createUserInvite } from './actions'

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function getExternalStaffStatus(staff: ExternalStaff, pendingInvite?: UserInvite) {
  if (staff.linked_profile_id || staff.status === 'onboarded') return 'onboarded'
  if (pendingInvite) return 'invite pending'
  return 'active'
}

export function ExternalStaffList({
  externalStaff,
  invites,
  isSchemaMissing = false,
}: {
  externalStaff: ExternalStaff[]
  invites: UserInvite[]
  isSchemaMissing?: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busyStaffId, setBusyStaffId] = useState<string | null>(null)
  const [emailsByStaffId, setEmailsByStaffId] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [newStaff, setNewStaff] = useState({
    name: '',
    phone: '',
    email: '',
  })

  const pendingInviteByExternalStaffId = new Map(
    invites
      .filter((invite) => invite.status === 'pending' && invite.external_staff_id)
      .map((invite) => [invite.external_staff_id, invite]),
  )

  async function handleSendInvite(staff: ExternalStaff) {
    const email = normalizeEmail(emailsByStaffId[staff.id] ?? staff.email ?? '')
    if (!email) {
      toast({
        title: 'Email required',
        description: 'Enter an email address before sending the invite.',
        variant: 'destructive',
      })
      return
    }

    setBusyStaffId(staff.id)
    const result = await createUserInvite({
      email,
      role: 'staff',
      fullName: staff.name,
      mobileNumber: staff.phone,
      externalStaffId: staff.id,
    })

    if (!result.success) {
      toast({
        title: 'Invite not sent',
        description: result.message,
        variant: 'destructive',
      })
      setBusyStaffId(null)
      return
    }

    toast({
      title: 'Invite sent',
      description: `${staff.name} can finish onboarding from the email link.`,
    })
    router.refresh()
    setBusyStaffId(null)
  }

  async function handleCreateExternalStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)

    const result = await createExternalStaff(newStaff)
    if (!result.success) {
      toast({
        title: 'External staff not added',
        description: result.message,
        variant: 'destructive',
      })
      setCreating(false)
      return
    }

    toast({
      title: 'External staff added',
      description: `${result.externalStaff.name} is now available for appointment assignment.`,
    })
    setNewStaff({ name: '', phone: '', email: '' })
    router.refresh()
    setCreating(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">External Staff</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isSchemaMissing && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            External Staff setup is pending. Apply migration{' '}
            <span className="font-mono">supabase/migrations/017_external_staff_payment_due.sql</span>{' '}
            to enable creation and appointment assignment.
          </div>
        )}

        <form onSubmit={handleCreateExternalStaff} className="space-y-4 rounded-md border p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="external-staff-name">Name *</Label>
              <Input
                id="external-staff-name"
                value={newStaff.name}
                onChange={(event) => setNewStaff((current) => ({ ...current, name: event.target.value }))}
                disabled={isSchemaMissing}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="external-staff-phone">Phone *</Label>
              <Input
                id="external-staff-phone"
                type="tel"
                value={newStaff.phone}
                onChange={(event) => setNewStaff((current) => ({ ...current, phone: event.target.value }))}
                disabled={isSchemaMissing}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="external-staff-email">Email</Label>
            <Input
              id="external-staff-email"
              type="email"
              value={newStaff.email}
              onChange={(event) => setNewStaff((current) => ({ ...current, email: event.target.value }))}
              disabled={isSchemaMissing}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={creating || isSchemaMissing}>
              {creating ? 'Adding...' : 'Add External Staff'}
            </Button>
          </div>
        </form>

        {externalStaff.length === 0 ? (
          <p className="text-sm text-muted-foreground">No external staff have been added yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-48 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {externalStaff.map((staff) => {
                  const pendingInvite = pendingInviteByExternalStaffId.get(staff.id)
                  const status = getExternalStaffStatus(staff, pendingInvite)
                  const isBusy = busyStaffId === staff.id
                  const canInvite = status === 'active'

                  return (
                    <TableRow key={staff.id}>
                      <TableCell className="font-medium">{staff.name}</TableCell>
                      <TableCell>{staff.phone}</TableCell>
                      <TableCell>
                        {canInvite ? (
                          <Input
                            type="email"
                            value={emailsByStaffId[staff.id] ?? staff.email ?? ''}
                            onChange={(event) => {
                              setEmailsByStaffId((current) => ({
                                ...current,
                                [staff.id]: event.target.value,
                              }))
                            }}
                            placeholder="email@example.com"
                            className="min-w-48"
                          />
                        ) : (
                          staff.email ?? pendingInvite?.email ?? 'Not set'
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status === 'onboarded' ? 'default' : status === 'invite pending' ? 'secondary' : 'outline'}>
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canInvite ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleSendInvite(staff)}
                          >
                            {isBusy ? 'Sending...' : 'Send invite'}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {status === 'onboarded' ? 'Linked to user' : 'Invite sent'}
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
