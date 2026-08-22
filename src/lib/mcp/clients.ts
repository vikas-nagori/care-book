import type { McpOAuthClient } from '../supabase/types.ts'
import { createAdminClient } from '../supabase/admin.ts'
import { OAuthError } from './errors.ts'
import { generateClientId } from './tokens.ts'

export function validateRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be a non-empty array')
  }

  return value.map((entry) => {
    if (typeof entry !== 'string') throw new OAuthError('invalid_redirect_uri', 'redirect_uris must contain strings')
    let parsed: URL
    try {
      parsed = new URL(entry)
    } catch {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uri is not a valid URL')
    }
    if (parsed.hash) throw new OAuthError('invalid_redirect_uri', 'redirect_uri must not contain a fragment')
    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uri must use https, or http on loopback')
    }
    return entry
  })
}

export async function registerClient(input: {
  redirectUris: string[]
  clientName?: string
}): Promise<{ client_id: string; client_id_issued_at: number }> {
  const clientId = generateClientId()
  const { error } = await createAdminClient().from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_name: input.clientName ?? null,
    redirect_uris: input.redirectUris,
    token_endpoint_auth_method: 'none',
    client_secret_hash: null,
  })
  if (error) throw new OAuthError('server_error', 'Could not register the client.')
  return { client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) }
}

export async function findClient(clientId: string): Promise<McpOAuthClient | null> {
  const { data } = await createAdminClient().from('mcp_oauth_clients').select('*').eq('client_id', clientId).maybeSingle()
  return (data as McpOAuthClient | null) ?? null
}
