import { NextResponse, type NextRequest } from 'next/server'
import { isMcpEnabled } from '@/lib/mcp/config'
import { revokeByToken } from '@/lib/mcp/grants'
import { allowOAuthRequest, clientIpFrom } from '@/lib/mcp/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  if (!allowOAuthRequest('revoke', clientIpFrom(request.headers))) {
    return new NextResponse(null, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const form = await request.formData()
    const token = String(form.get('token') ?? '')
    if (token) await revokeByToken(token)
  } catch (error) {
    logger.error('mcp/oauth/revoke/unexpected', error)
  }
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
