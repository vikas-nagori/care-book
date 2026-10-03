import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { shouldLogAuthError } from '@/lib/auth-error-classification'
import { isPlatformAdminEmail } from '@/lib/platform/access'
import { resolveSuperadminRedirect } from '@/lib/platform/routing'
import { buildContentSecurityPolicy, createCspNonce } from '@/lib/security/csp'
import {
  FORCED_PASSWORD_CHANGE_PATH,
  needsForcedPasswordChange,
} from '@/lib/security/forced-password-change'

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname

  // The CSP is built per request because it carries a fresh nonce. Next.js reads the policy
  // back off the *request* headers to stamp that nonce onto its own script tags, so the header
  // has to be set on both the outgoing response and the forwarded request.
  const nonce = createCspNonce()
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    allowUnsafeEval: process.env.NODE_ENV === 'development',
  })

  // Rebuilt on each call rather than snapshotted: Supabase's setAll mutates request.cookies,
  // and those mutations live in the `cookie` request header we forward.
  function nextWithNonce() {
    const forwardedHeaders = new Headers(request.headers)
    forwardedHeaders.set('x-nonce', nonce)
    forwardedHeaders.set('Content-Security-Policy', contentSecurityPolicy)

    const response = NextResponse.next({ request: { headers: forwardedHeaders } })
    response.headers.set('Content-Security-Policy', contentSecurityPolicy)
    return response
  }

  function redirectWithCsp(url: URL) {
    const response = NextResponse.redirect(url)
    response.headers.set('Content-Security-Policy', contentSecurityPolicy)
    return response
  }

  let supabaseResponse = nextWithNonce()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = nextWithNonce()
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (shouldLogAuthError(authError)) logger.error('middleware/getUser', authError, { path })

  const isPublicRoute =
    path.startsWith('/login') ||
    path.startsWith('/clinic-onboarding') ||
    path.startsWith('/auth/')
  const isPaymentDuePdfApi = path.startsWith('/api/billing/payment-due/') && path.endsWith('/pdf')

  if (!user && !isPublicRoute) {
    if (isPaymentDuePdfApi) {
      return NextResponse.json(
        { errorCode: 'UNAUTHORIZED', message: 'You need to sign in again.' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', `${path}${request.nextUrl.search}`)
    return redirectWithCsp(url)
  }

  if (user) {
    // Accounts issued a temporary password must set their own before touching anything else.
    // /auth/* stays reachable (the change page itself, the callback, complete-invite).
    if (needsForcedPasswordChange(user.app_metadata, path)) {
      if (isPaymentDuePdfApi) {
        return NextResponse.json(
          { errorCode: 'FORBIDDEN', message: 'Set your password before generating payment PDFs.' },
          { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      const url = request.nextUrl.clone()
      url.pathname = FORCED_PASSWORD_CHANGE_PATH
      url.search = ''
      return redirectWithCsp(url)
    }

    const isSuperadmin = isPlatformAdminEmail(user.email)

    // Authenticated users shouldn't sit on /login — superadmins land in the
    // platform console, everyone else on the clinic dashboard.
    if (path.startsWith('/login')) {
      const url = request.nextUrl.clone()
      url.pathname = isSuperadmin ? '/platform' : '/'
      return redirectWithCsp(url)
    }

    const redirectTo = resolveSuperadminRedirect({ isSuperadmin, path, isPublicRoute })
    if (redirectTo) {
      const url = request.nextUrl.clone()
      url.pathname = redirectTo
      return redirectWithCsp(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|api/cron|api/mcp|oauth/token|oauth/register|oauth/revoke|\\.well-known).*)'],
}
