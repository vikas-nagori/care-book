import 'server-only'

import {
  buildInviteRedirectUrl,
  DEFAULT_INVITE_NEXT_PATH,
  normalizeSiteOrigin,
} from './invite-helpers'

const DEFAULT_APP_ORIGIN = 'http://localhost:3000'

export function getAppOrigin() {
  return normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_APP_ORIGIN
}

export function buildInviteRedirectTo() {
  return buildInviteRedirectUrl(getAppOrigin())
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

    return 'Unable to manage invites right now.'
  }

  return 'Unable to manage invites right now.'
}
