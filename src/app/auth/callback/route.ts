import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { sanitizeNextPath } from '@/lib/onboarding/invite-server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null
  const code = request.nextUrl.searchParams.get('code')
  const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get('next'))

  const successRedirect = request.nextUrl.clone()
  successRedirect.pathname = nextPath
  successRedirect.search = ''

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })

    if (!error) {
      return NextResponse.redirect(successRedirect)
    }

    logger.error('auth/callback/verifyOtp', error, {
      type,
      nextPath,
    })
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(successRedirect)
    }

    logger.error('auth/callback/exchangeCodeForSession', error, {
      nextPath,
    })
  }

  const isRecoveryFlow = type === 'recovery' || nextPath === '/auth/update-password'
  const errorRedirect = request.nextUrl.clone()
  errorRedirect.pathname = '/login'
  errorRedirect.search = ''
  errorRedirect.searchParams.set(
    'error',
    isRecoveryFlow ? 'reset-link-invalid' : 'invite-link-invalid'
  )

  return NextResponse.redirect(errorRedirect)
}
