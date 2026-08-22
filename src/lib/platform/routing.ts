// Pure routing decision for the middleware: given whether the current user is a
// superadmin and the requested path, decide where (if anywhere) to redirect.
// Kept side-effect-free so it can be unit-tested without a request context.

export type SuperadminRouteContext = {
  isSuperadmin: boolean
  path: string
  isPublicRoute: boolean
}

export function isPlatformPath(path: string): boolean {
  return path === '/platform' || path.startsWith('/platform/')
}

// The MCP consent screen is an authorization surface, not part of the clinic app.
// It is still session-gated by the middleware's `!user` branch, so it never needs the
// superadmin bounce — and applying one strands the OAuth flow, because the redirect
// drops the browser on /platform and the MCP client never receives its code.
export function isOAuthConsentPath(path: string): boolean {
  return path === '/oauth/authorize'
}

export function resolveSuperadminRedirect({
  isSuperadmin,
  path,
  isPublicRoute,
}: SuperadminRouteContext): string | null {
  if (isSuperadmin) {
    // Superadmins live entirely inside the /platform console. Keep them out of
    // the clinic app, but don't interfere with public/auth routes.
    if (!isPlatformPath(path) && !isPublicRoute && !isOAuthConsentPath(path)) return '/platform'
    return null
  }

  // Non-superadmins must never reach the platform console.
  if (isPlatformPath(path)) return '/'
  return null
}
