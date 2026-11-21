import { NextResponse } from 'next/server'
import { SERVER_APP_VERSION } from '@/lib/app-version'

// Read at request time: the installed app compares this to the version it was built with.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ version: SERVER_APP_VERSION }, { headers: { 'Cache-Control': 'no-store' } })
}
