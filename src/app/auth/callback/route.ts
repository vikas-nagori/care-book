import { type EmailOtpType, type Session } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import {
  isPasswordRecoveryCallback,
  passwordRecoveryCookie,
  sessionIdFromAccessToken,
} from '@/lib/auth/password-recovery'
import { logger } from '@/lib/logger'
import { sanitizeNextPath } from '@/lib/onboarding/invite-helpers'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null
  const code = request.nextUrl.searchParams.get('code')
  const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get('next'))
  const isRecoveryFlow = isPasswordRecoveryCallback({ type, nextPath })

  const successRedirect = request.nextUrl.clone()
  successRedirect.pathname = nextPath
  successRedirect.search = ''

  /** The redirect into the app; a reset link also marks its new session for /auth/update-password. */
  function signedIn(session: Session | null) {
    const response = NextResponse.redirect(successRedirect)
    const sessionId = isRecoveryFlow ? sessionIdFromAccessToken(session?.access_token) : null
    if (sessionId) {
      response.cookies.set(passwordRecoveryCookie(sessionId, request.nextUrl.protocol === 'https:'))
    }
    return response
  }

  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })

    if (!error) {
      return signedIn(data.session)
    }

    logger.error('auth/callback/verifyOtp', error, {
      type,
      nextPath,
    })
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return signedIn(data.session)
    }

    logger.error('auth/callback/exchangeCodeForSession', error, {
      nextPath,
    })
  }

  const errorRedirect = request.nextUrl.clone()
  errorRedirect.pathname = '/login'
  errorRedirect.search = ''
  errorRedirect.searchParams.set(
    'error',
    isRecoveryFlow ? 'reset-link-invalid' : 'invite-link-invalid'
  )

  return NextResponse.redirect(errorRedirect)
}
