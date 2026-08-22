import { NextResponse } from 'next/server'
import { isMcpEnabled } from '@/lib/mcp/config'
import { authorizationServerMetadata } from '@/lib/mcp/metadata'

export async function GET() {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  return NextResponse.json(authorizationServerMetadata(), { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
