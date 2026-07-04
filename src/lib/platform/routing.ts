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

export function resolveSuperadminRedirect({
  isSuperadmin,
  path,
  isPublicRoute,
}: SuperadminRouteContext): string | null {
  if (isSuperadmin) {
    // Superadmins live entirely inside the /platform console. Keep them out of
    // the clinic app, but don't interfere with public/auth routes.
    if (!isPlatformPath(path) && !isPublicRoute) return '/platform'
    return null
  }

  // Non-superadmins must never reach the platform console.
  if (isPlatformPath(path)) return '/'
  return null
}
