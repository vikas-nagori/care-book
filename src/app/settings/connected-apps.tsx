'use client'

import { useFormStatus } from 'react-dom'
import { Link2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ConnectedMcpApp } from '@/lib/supabase/types'

function RevokeButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" variant="outline" size="sm" disabled={pending}>{pending ? 'Revoking…' : 'Revoke'}</Button>
}

type Props = { apps: ConnectedMcpApp[]; variant?: 'card' | 'sheet'; revokeAction: (formData: FormData) => Promise<void> }

export function ConnectedApps({ apps, variant = 'card', revokeAction }: Props) {
  const body = apps.length ? (
    <div className="space-y-3">
      {apps.map((app) => (
        <div key={app.id} className="flex items-center gap-3 rounded-lg border p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--ph-accent-soft)] text-[var(--ph-accent-ink)]"><Link2 size={17} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{app.client_name}</p>
            <p className="text-xs text-muted-foreground">{app.scopes.join(', ')} · connected {new Date(app.created_at).toLocaleDateString()}</p>
          </div>
          <form action={revokeAction}>
            <input type="hidden" name="grant_id" value={app.id} />
            <RevokeButton />
          </form>
        </div>
      ))}
    </div>
  ) : <p className="text-sm text-muted-foreground">No connected MCP apps.</p>

  if (variant === 'sheet') return <div className="space-y-3">{body}</div>
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck size={18} />Connected Apps</CardTitle>
        <CardDescription>Review or revoke apps connected to your Care-Book account. Billing access is only granted when explicitly approved.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
