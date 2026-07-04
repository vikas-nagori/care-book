export function shouldHideAppChrome(pathname: string | null | undefined) {
  return (
    pathname === '/login' ||
    pathname === '/clinic-onboarding' ||
    Boolean(pathname?.startsWith('/auth/')) ||
    Boolean(pathname?.startsWith('/platform/'))
  )
}
