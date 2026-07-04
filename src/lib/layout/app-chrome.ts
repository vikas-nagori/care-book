export function shouldHideAppChrome(pathname: string | null | undefined) {
  return pathname === '/login' || Boolean(pathname?.startsWith('/auth/'))
}
