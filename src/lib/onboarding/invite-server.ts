import 'server-only'

import { headers } from 'next/headers'

const DEFAULT_APP_ORIGIN = 'http://localhost:3000'
const DEFAULT_INVITE_NEXT_PATH = '/auth/complete-invite'

export async function getAppOrigin() {
  const headerStore = await headers()
  const origin = headerStore.get('origin')

  if (origin) {
    return origin
  }

  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host')
  if (!host) {
    return DEFAULT_APP_ORIGIN
  }

  const protocol =
    headerStore.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')

  return `${protocol}://${host}`
}

export async function buildInviteRedirectTo() {
  const origin = await getAppOrigin()
  return `${origin}/auth/callback?next=${encodeURIComponent(DEFAULT_INVITE_NEXT_PATH)}`
}

export function sanitizeNextPath(nextPath: string | null | undefined) {
  if (!nextPath || !nextPath.startsWith('/') || nextPath.startsWith('//')) {
    return DEFAULT_INVITE_NEXT_PATH
  }

  return nextPath
}

export function getInviteErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return 'Add SUPABASE_SERVICE_ROLE_KEY to enable invite management.'
    }

    return error.message
  }

  return 'Unable to manage invites right now.'
}
