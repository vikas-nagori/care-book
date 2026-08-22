import { NextResponse, type NextRequest } from 'next/server'
import { isMcpEnabled, mcpResourceUrl } from '@/lib/mcp/config'
import { OAuthError, redeemAuthorizationCode, refreshGrant, type GrantTokens } from '@/lib/mcp/grants'
import { allowOAuthRequest, clientIpFrom } from '@/lib/mcp/rate-limit'
import { logger } from '@/lib/logger'

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

function tokenResponse(tokens: GrantTokens): NextResponse {
  return NextResponse.json(
    {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scopes.join(' '),
    },
    { headers: NO_STORE }
  )
}

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  if (!allowOAuthRequest('token', clientIpFrom(request.headers))) {
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 429, headers: NO_STORE })
  }
  try {
    const form = await request.formData()
    const grantType = String(form.get('grant_type') ?? '')
    const clientId = String(form.get('client_id') ?? '')
    const resource = String(form.get('resource') ?? mcpResourceUrl())
    if (!clientId) throw new OAuthError('invalid_client', 'client_id is required')

    if (grantType === 'authorization_code') {
      return tokenResponse(await redeemAuthorizationCode({
        code: String(form.get('code') ?? ''),
        clientId,
        redirectUri: String(form.get('redirect_uri') ?? ''),
        resource,
        codeVerifier: String(form.get('code_verifier') ?? ''),
      }))
    }
    if (grantType === 'refresh_token') {
      return tokenResponse(await refreshGrant({ refreshToken: String(form.get('refresh_token') ?? ''), clientId, resource }))
    }
    throw new OAuthError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`)
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json({ error: error.code, error_description: error.message }, { status: error.code === 'invalid_client' ? 401 : 400, headers: NO_STORE })
    }
    logger.error('mcp/oauth/token/unexpected', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })
  }
}
