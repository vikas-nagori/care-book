import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { isPlatformAdminEmail } from '@/lib/platform/access'
import { resolveSuperadminRedirect } from '@/lib/platform/routing'

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  let supabaseResponse = NextResponse.next({ request })

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
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) logger.error('middleware/getUser', authError, { path })

  const isPublicRoute =
    path.startsWith('/login') ||
    path.startsWith('/clinic-onboarding') ||
    path.startsWith('/auth/')

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user) {
    const isSuperadmin = isPlatformAdminEmail(user.email)

    // Authenticated users shouldn't sit on /login — superadmins land in the
    // platform console, everyone else on the clinic dashboard.
    if (path.startsWith('/login')) {
      const url = request.nextUrl.clone()
      url.pathname = isSuperadmin ? '/platform' : '/'
      return NextResponse.redirect(url)
    }

    const redirectTo = resolveSuperadminRedirect({ isSuperadmin, path, isPublicRoute })
    if (redirectTo) {
      const url = request.nextUrl.clone()
      url.pathname = redirectTo
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|api/cron).*)'],
}
