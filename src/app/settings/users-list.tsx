'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Profile } from '@/lib/supabase/types'

export function UsersList({
  profiles,
  variant = 'card',
}: {
  profiles: Profile[]
  variant?: 'card' | 'sheet'
}) {
  const emptyState = (
    <p className="text-sm text-muted-foreground">
      No active users are available yet.
    </p>
  )

  const desktopList = profiles.length === 0 ? emptyState : (
    <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead className="w-28">Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell className="font-medium">
                      {profile.full_name?.trim() || 'Not added yet'}
                    </TableCell>
                    <TableCell>{profile.email}</TableCell>
                    <TableCell>{profile.mobile_number?.trim() || 'Not added yet'}</TableCell>
                    <TableCell>
                      <Badge variant={profile.role === 'admin' ? 'default' : 'secondary'}>
                        {profile.role}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
    </div>
  )

  const mobileList = profiles.length === 0 ? emptyState : (
    <div className="divide-y divide-[var(--ph-line)] rounded-lg border border-[var(--ph-line)]">
      {profiles.map((profile) => (
        <section key={profile.id} className="space-y-2 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm font-semibold text-[var(--ph-ink)]">
              {profile.full_name?.trim() || 'Not added yet'}
            </p>
            <Badge className="shrink-0" variant={profile.role === 'admin' ? 'default' : 'secondary'}>
              {profile.role}
            </Badge>
          </div>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p className="break-all">{profile.email}</p>
            {profile.mobile_number?.trim() && <p>{profile.mobile_number}</p>}
          </div>
        </section>
      ))}
    </div>
  )

  if (variant === 'sheet') return mobileList

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Active Users</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {desktopList}
      </CardContent>
    </Card>
  )
}
