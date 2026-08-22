'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SCOPE_DESCRIPTIONS } from '@/lib/mcp/config'
import type { AuthorizeRequest } from '@/lib/mcp/authorize-request'
import { approveConsent, denyConsent } from './actions'

function SubmitButton({ children, variant }: { children: React.ReactNode; variant?: 'default' | 'outline' }) {
  const { pending } = useFormStatus()
  return <Button type="submit" variant={variant} disabled={pending}>{pending ? 'Working…' : children}</Button>
}

export function ConsentForm({ request, clientName, profile, clinicName }: {
  request: AuthorizeRequest
  clientName: string
  profile: { email: string; full_name: string | null; role: string }
  clinicName: string
}) {
  const scopeLabels = request.scopes
  // Any application may register itself and pick its own display name, so the name alone proves
  // nothing. Showing the destination host lets the person approving see where their data is going.
  let redirectHost = request.redirectUri
  try {
    redirectHost = new URL(request.redirectUri).host
  } catch {
    // Fall back to the raw value; it was already checked against the client's registered list.
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>{clientName} wants to connect to your Care-Book account</CardTitle>
        <CardDescription>Review the access this connection will receive.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">{profile.full_name || profile.email}</p>
          <p className="text-muted-foreground">{profile.email} · {profile.role} · {clinicName}</p>
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="font-medium">Check this is an app you trust</p>
          <p className="mt-1 text-muted-foreground">
            &ldquo;{clientName}&rdquo; is a name the application chose for itself. Approving sends
            patient data to <span className="font-medium text-foreground">{redirectHost}</span>. If
            you did not just start this connection yourself, choose Deny.
          </p>
        </div>
        <form action={approveConsent} className="space-y-5">
          <input type="hidden" name="client_id" value={request.clientId} />
          <input type="hidden" name="redirect_uri" value={request.redirectUri} />
          <input type="hidden" name="code_challenge" value={request.codeChallenge} />
          <input type="hidden" name="state" value={request.state ?? ''} />
          <input type="hidden" name="requested_scope" value={request.scopes.join(' ')} />
          <div className="space-y-3">
            {scopeLabels.map((scope) => {
              if (scope === 'write:billing' && profile.role !== 'admin') return null
              return (
                <label key={scope} className="flex gap-3 rounded-md border p-3 text-sm">
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    defaultChecked={scope !== 'write:billing'}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span><span className="font-medium">{scope}</span><br /><span className="text-muted-foreground">{SCOPE_DESCRIPTIONS[scope]}</span></span>
                </label>
              )
            })}
          </div>
          <div className="flex gap-3">
            <SubmitButton>Approve</SubmitButton>
          </div>
        </form>
        <form action={denyConsent}>
          <input type="hidden" name="client_id" value={request.clientId} />
          <input type="hidden" name="redirect_uri" value={request.redirectUri} />
          <input type="hidden" name="state" value={request.state ?? ''} />
          <SubmitButton variant="outline">Deny</SubmitButton>
        </form>
      </CardContent>
    </Card>
  )
}
