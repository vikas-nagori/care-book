import type { McpOAuthClient, McpScope } from '../supabase/types.ts'
import { parseScopes } from './config.ts'
import { OAuthError } from './errors.ts'

export type AuthorizeRequest = {
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  scopes: McpScope[]
  resource: string
}

export function parseAuthorizeRequest(
  params: URLSearchParams,
  client: McpOAuthClient,
  expectedResource: string
): AuthorizeRequest {
  const redirectUri = params.get('redirect_uri') ?? ''
  if (!client.redirect_uris.includes(redirectUri)) throw new OAuthError('invalid_request', 'Unregistered redirect_uri')
  if (params.get('response_type') !== 'code') throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported')
  if (params.get('code_challenge_method') !== 'S256') throw new OAuthError('invalid_request', 'code_challenge_method must be S256')
  const codeChallenge = params.get('code_challenge') ?? ''
  if (!codeChallenge) throw new OAuthError('invalid_request', 'code_challenge is required')
  const resource = params.get('resource') ?? ''
  if (resource !== expectedResource) throw new OAuthError('invalid_target', 'resource does not match this MCP server')
  const scopes = parseScopes(params.get('scope'))
  if (scopes.length === 0) throw new OAuthError('invalid_scope', 'No supported scope requested')
  return { clientId: client.client_id, redirectUri, state: params.get('state'), codeChallenge, scopes, resource }
}
