import { NextResponse, type NextRequest } from 'next/server'
import { registerClient, validateRedirectUris } from '@/lib/mcp/clients'
import { isMcpEnabled, MCP_SCOPES } from '@/lib/mcp/config'
import { OAuthError } from '@/lib/mcp/errors'
import { allowOAuthRequest, clientIpFrom } from '@/lib/mcp/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  if (!allowOAuthRequest('register', clientIpFrom(request.headers))) {
    return NextResponse.json(
      { error: 'temporarily_unavailable', error_description: 'Too many client registrations. Try again later.' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    )
  }
  try {
    const body = (await request.json()) as Record<string, unknown>
    const redirectUris = validateRedirectUris(body.redirect_uris)
    const clientName = typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : undefined
    const registered = await registerClient({ redirectUris, clientName })
    return NextResponse.json(
      {
        ...registered,
        client_name: clientName ?? null,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: MCP_SCOPES.join(' '),
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json({ error: error.code, error_description: error.message }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    }
    logger.error('mcp/oauth/register/unexpected', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
