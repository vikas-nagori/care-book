import { getCurrentProfile } from '@/lib/auth'
import { findClient } from '@/lib/mcp/clients'
import { isMcpEnabled, mcpResourceUrl } from '@/lib/mcp/config'
import { parseAuthorizeRequest } from '@/lib/mcp/authorize-request'
import { OAuthError } from '@/lib/mcp/errors'
import { createClient } from '@/lib/supabase/server'
import { ConsentForm } from './consent-form'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function errorPanel(message: string) {
  return <main className="flex min-h-dvh items-center justify-center p-4"><div className="w-full max-w-xl rounded-xl border p-6"><h1 className="text-xl font-semibold">Unable to connect Care-Book</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p></div></main>
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  if (!isMcpEnabled()) return errorPanel('MCP connections are not enabled.')
  const profile = await getCurrentProfile()
  if (!profile?.clinic_id) return errorPanel('Your Care-Book account is not connected to an active clinic.')

  const raw = await searchParams
  const clientId = first(raw.client_id)
  const client = await findClient(clientId)
  if (!client) return errorPanel('The requesting application is not registered.')

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) params.set(key, first(value))

  let request
  try {
    request = parseAuthorizeRequest(params, client, mcpResourceUrl())
  } catch (error) {
    return errorPanel(error instanceof OAuthError ? error.message : 'The authorization request is invalid.')
  }

  const supabase = await createClient()
  const { data: clinic } = await supabase.from('clinics').select('name').eq('id', profile.clinic_id).maybeSingle()
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/20 p-4">
      <ConsentForm request={request} clientName={client.client_name ?? 'An MCP application'} profile={profile} clinicName={clinic?.name ?? 'your clinic'} />
    </main>
  )
}
