'use server'

import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { findClient } from '@/lib/mcp/clients'
import { mcpResourceUrl, parseScopes } from '@/lib/mcp/config'
import { OAuthError, issueAuthorizationCode } from '@/lib/mcp/grants'
import { createClient } from '@/lib/supabase/server'
import type { McpScope } from '@/lib/supabase/types'

export async function approveConsent(formData: FormData) {
  const profile = await getCurrentProfile()
  if (!profile?.clinic_id || profile.status !== 'active') redirect('/login')

  const clientId = String(formData.get('client_id') ?? '')
  const redirectUri = String(formData.get('redirect_uri') ?? '')
  const codeChallenge = String(formData.get('code_challenge') ?? '')
  const state = formData.get('state') ? String(formData.get('state')) : null
  const requested = parseScopes(String(formData.get('requested_scope') ?? ''))
  const approved = [...new Set(formData.getAll('scope').map(String))] as McpScope[]
  const client = await findClient(clientId)

  if (!client || !client.redirect_uris.includes(redirectUri)) throw new OAuthError('invalid_request', 'Invalid client or redirect URI')
  if (!codeChallenge || requested.length === 0) throw new OAuthError('invalid_request', 'Invalid authorization request')
  if (approved.some((scope) => !requested.includes(scope) || (scope === 'write:billing' && profile.role !== 'admin'))) {
    throw new OAuthError('invalid_scope', 'One or more requested scopes are not allowed')
  }
  if (!approved.includes('read')) throw new OAuthError('invalid_scope', 'The read scope is required')

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const code = await issueAuthorizationCode({
    clientId,
    userId: profile.id,
    clinicId: profile.clinic_id,
    scopes: approved,
    codeChallenge,
    redirectUri,
    resource: mcpResourceUrl(),
    supabaseRefreshToken: session?.refresh_token ?? null,
  })

  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  if (state) target.searchParams.set('state', state)
  redirect(target.toString())
}

export async function denyConsent(formData: FormData) {
  const redirectUri = String(formData.get('redirect_uri') ?? '')
  const state = formData.get('state') ? String(formData.get('state')) : null
  const clientId = String(formData.get('client_id') ?? '')
  const client = await findClient(clientId)
  if (!client || !client.redirect_uris.includes(redirectUri)) throw new OAuthError('invalid_request', 'Invalid client or redirect URI')
  const target = new URL(redirectUri)
  target.searchParams.set('error', 'access_denied')
  if (state) target.searchParams.set('state', state)
  redirect(target.toString())
}
