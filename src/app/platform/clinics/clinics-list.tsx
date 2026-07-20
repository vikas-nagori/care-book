'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import type { PlatformClinicSummary } from '@/lib/supabase/types'
import { blockClinic, unblockClinic } from './actions'

type ClinicsListProps = {
  clinics: PlatformClinicSummary[]
}

export function ClinicsList({ clinics }: ClinicsListProps) {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function toggle(clinic: PlatformClinicSummary) {
    const isBlocked = clinic.status === 'inactive'
    setBusyId(clinic.id)
    const result = isBlocked
      ? await unblockClinic({ clinicId: clinic.id })
      : await blockClinic({ clinicId: clinic.id })
    setBusyId(null)

    toast({
      title: result.success
        ? isBlocked
          ? 'Clinic unblocked'
          : 'Clinic blocked'
        : 'Action failed',
      description: result.success
        ? isBlocked
          ? 'Its users can sign in again.'
          : 'All of its users have been signed out and blocked.'
        : result.message,
      variant: result.success ? 'default' : 'destructive',
    })
  }

  if (clinics.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">No clinics yet.</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {clinics.map((clinic) => {
        const isBusy = busyId === clinic.id
        const isBlocked = clinic.status === 'inactive'

        return (
          <Card key={clinic.id}>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-lg">{clinic.name}</CardTitle>
                <Badge variant={isBlocked ? 'destructive' : 'secondary'}>
                  {isBlocked ? 'blocked' : 'active'}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {clinic.user_count} {clinic.user_count === 1 ? 'user' : 'users'} ·{' '}
                {clinic.patient_count} {clinic.patient_count === 1 ? 'patient' : 'patients'}
                {clinic.phone ? ` · ${clinic.phone}` : ''}
              </div>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant={isBlocked ? 'default' : 'destructive'}
                onClick={() => toggle(clinic)}
                disabled={isBusy}
                aria-label={`${isBlocked ? 'Unblock' : 'Block'} clinic ${clinic.name}`}
              >
                {isBusy ? <Loader2 className="mr-1 animate-spin" size={14} /> : null}
                {isBlocked ? 'Unblock clinic' : 'Block clinic'}
              </Button>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
