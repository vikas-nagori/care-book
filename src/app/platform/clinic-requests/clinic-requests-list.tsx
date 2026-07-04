'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import type { ClinicOnboardingRequest } from '@/lib/supabase/types'
import {
  approveClinicOnboardingRequest,
  rejectClinicOnboardingRequest,
} from './actions'

type ClinicRequestsListProps = {
  requests: ClinicOnboardingRequest[]
}

export function ClinicRequestsList({ requests }: ClinicRequestsListProps) {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({})

  async function approve(requestId: string) {
    setBusyId(requestId)
    const result = await approveClinicOnboardingRequest({ requestId })
    setBusyId(null)

    toast({
      title: result.success ? 'Clinic approved' : 'Approval failed',
      description: result.success
        ? 'The clinic was created and the owner invite was sent.'
        : result.message,
      variant: result.success ? 'default' : 'destructive',
    })
  }

  async function reject(requestId: string) {
    setBusyId(requestId)
    const result = await rejectClinicOnboardingRequest({
      requestId,
      rejectionReason: rejectionReasons[requestId] ?? null,
    })
    setBusyId(null)

    toast({
      title: result.success ? 'Request rejected' : 'Rejection failed',
      description: result.success
        ? 'The request was rejected without creating a clinic.'
        : result.message,
      variant: result.success ? 'default' : 'destructive',
    })
  }

  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No clinic onboarding requests yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {requests.map((request) => {
        const isBusy = busyId === request.id
        const isPending = request.status === 'pending'

        return (
          <Card key={request.id}>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-lg">{request.clinic_name}</CardTitle>
                <Badge variant={request.status === 'pending' ? 'default' : 'secondary'}>
                  {request.status}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {request.owner_full_name} · {request.owner_email} · {request.owner_mobile_number}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {(request.clinic_phone || request.clinic_address) && (
                <div className="text-sm text-muted-foreground">
                  {[request.clinic_phone, request.clinic_address].filter(Boolean).join(' · ')}
                </div>
              )}
              {isPending ? (
                <div className="space-y-3">
                  <Textarea
                    value={rejectionReasons[request.id] ?? ''}
                    onChange={(event) =>
                      setRejectionReasons((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))
                    }
                    placeholder="Optional rejection reason"
                    rows={2}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => approve(request.id)} disabled={isBusy}>
                      {isBusy ? <Loader2 className="animate-spin" size={14} /> : null}
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => reject(request.id)}
                      disabled={isBusy}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {request.status === 'approved'
                    ? 'Approved and converted into a clinic.'
                    : request.rejection_reason || 'Rejected.'}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
