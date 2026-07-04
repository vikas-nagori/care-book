export function shouldHideAppChrome(pathname: string | null | undefined) {
  return pathname === '/login' || pathname === '/auth/complete-invite'
}
