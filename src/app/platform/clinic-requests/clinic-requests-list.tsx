'use client'

import { callServerAction } from '@/lib/actions/call-server-action'
import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { TempPasswordDialog } from '@/components/onboarding/temp-password-dialog'
import type { ClinicOnboardingRequest, OwnerCredentials } from '@/lib/supabase/types'
import {
  approveClinicOnboardingRequest,
  rejectClinicOnboardingRequest,
} from './actions'

type ClinicRequestsListProps = {
  requests: ClinicOnboardingRequest[]
}

export function ClinicRequestsList({ requests }: ClinicRequestsListProps) {
  const { toast } = useToast()
  // One entry per request with a call in flight: finishing (or starting) work on one request must
  // never unlock another that is still running (G-5). The ref also stops a double click from
  // sending the same request twice before React re-renders the disabled button.
  const inFlight = useRef(new Set<string>())
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({})
  const [ownerCredentials, setOwnerCredentials] = useState<OwnerCredentials | null>(null)

  function setBusy(requestId: string, busy: boolean) {
    if (busy) inFlight.current.add(requestId)
    else inFlight.current.delete(requestId)
    setBusyIds(new Set(inFlight.current))
  }

  async function approve(requestId: string) {
    if (inFlight.current.has(requestId)) return
    setBusy(requestId, true)
    const result = await callServerAction(() => approveClinicOnboardingRequest({ requestId }))
    setBusy(requestId, false)

    toast({
      title: result.success ? 'Clinic approved' : 'Approval failed',
      description: result.success
        ? 'The clinic was created. Share the temporary password with the owner directly.'
        : result.message,
      variant: result.success ? 'default' : 'destructive',
    })

    if (result.success && result.ownerCredentials) {
      setOwnerCredentials(result.ownerCredentials)
    }
  }

  async function reject(requestId: string) {
    if (inFlight.current.has(requestId)) return
    setBusy(requestId, true)
    const result = await callServerAction(() => rejectClinicOnboardingRequest({
      requestId,
      rejectionReason: rejectionReasons[requestId] ?? null,
    }))
    setBusy(requestId, false)

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
      <TempPasswordDialog
        credentials={ownerCredentials}
        onClose={() => setOwnerCredentials(null)}
      />
      {requests.map((request) => {
        const isBusy = busyIds.has(request.id)
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
                    aria-label={`Rejection reason for ${request.clinic_name}`}
                    rows={2}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => approve(request.id)}
                      disabled={isBusy}
                      aria-label={`Approve ${request.clinic_name}`}
                    >
                      {isBusy ? <Loader2 className="animate-spin" size={14} /> : null}
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => reject(request.id)}
                      disabled={isBusy}
                      aria-label={`Reject ${request.clinic_name}`}
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
