import { EXTERNAL_WORKSPACE_PATH } from '../external/routing.ts'

export function shouldHideAppChrome(pathname: string | null | undefined) {
  return (
    pathname === '/login' ||
    pathname === EXTERNAL_WORKSPACE_PATH ||
    pathname === '/clinic-onboarding' ||
    Boolean(pathname?.startsWith('/auth/')) ||
    Boolean(pathname?.startsWith('/platform/'))
  )
}
