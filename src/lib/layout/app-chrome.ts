export type AppNavVariant = 'clinic' | 'external' | 'none'

/**
 * Which navigation the root layout draws around a page (Sidebar on desktop, BottomNav on phones).
 *
 * Mirrors the middleware's routing (resolveMiddlewareRole): a signed-in user whose profile reads
 * back empty — a blocked account or an inactive clinic, whose own row RLS hides — is confined to
 * the closed External workspace, where every page says the account is unavailable. They get no
 * navigation at all: clinic links would only bounce back, and every External link leads to the
 * same notice. Superadmins are routed by email, not profile, so they keep what they had.
 */
export function resolveAppNavVariant(input: {
  role: string | null
  signedIn: boolean
  isSuperadmin: boolean
}): AppNavVariant {
  if (input.role === 'external_staff') return 'external'
  if (input.role === null && input.signedIn && !input.isSuperadmin) return 'none'
  return 'clinic'
}

export function shouldHideAppChrome(pathname: string | null | undefined) {
  return (
    pathname === '/login' ||
    pathname === '/clinic-onboarding' ||
    Boolean(pathname?.startsWith('/auth/')) ||
    Boolean(pathname?.startsWith('/platform/'))
  )
}
