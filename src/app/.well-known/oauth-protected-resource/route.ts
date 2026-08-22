import { NextResponse } from 'next/server'
import { isMcpEnabled } from '@/lib/mcp/config'
import { protectedResourceMetadata } from '@/lib/mcp/metadata'

export async function GET() {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  return NextResponse.json(protectedResourceMetadata(), { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
