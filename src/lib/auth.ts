import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/lib/supabase/types'
import { EXTERNAL_WORKSPACE_PATH } from '@/lib/external/routing'
import { logger } from '@/lib/logger'
import { shouldLogAuthError } from '@/lib/auth-error-classification'
import { evaluateRoleAccess, type ProfileAccessShape } from '@/lib/auth-access'

type CurrentProfileLookup = {
  user: {
    id: string
    email: string | null
  } | null
  profile: (Profile & ProfileAccessShape) | null
  profileError: {
    code?: string
    message?: string
  } | null
}

// One lookup per server render. The root layout and the page both need the caller's profile, and
// each lookup is a GoTrue round trip (getUser) plus a profiles query — so without this every
// navigation paid for them twice, on top of the middleware's own getUser. React's cache() memoizes
// only within a single server-component render; server actions and route handlers run outside one,
// so a mutation followed by a re-render always reads fresh data.
// Next's server runtime always provides React's cache(); outside it (component tests run on the
// app's own React 18) it is absent, and the loader simply runs uncached — correct, just not shared.
const memoizePerRender: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof cache === 'function' ? cache : (fn) => fn
const loadCurrentProfile = memoizePerRender(async function loadCurrentProfile(): Promise<CurrentProfileLookup> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (shouldLogAuthError(authError)) {
    logger.error('auth/getCurrentProfile/getUser', authError)
  }

  if (!user) {
    return { user: null, profile: null, profileError: null }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*, clinic:clinics(status)')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    logger.error('auth/getCurrentProfile/profileLookup', profileError, {
      userId: user.id,
      email: user.email ?? null,
    })
  }

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    profile: (profile as (Profile & ProfileAccessShape) | null) ?? null,
    profileError,
  }
})

export async function getCurrentProfile(): Promise<Profile | null> {
  const { user, profile, profileError } = await loadCurrentProfile()
  if (user && !profile && !profileError) {
    logger.warn(
      'auth/getCurrentProfile/missingProfile',
      'Authenticated user is missing a profile row.',
      { userId: user.id, email: user.email }
    )
  }
  return profile
}

export async function requireAdmin(): Promise<Profile> {
  return requireRole(['admin'])
}

export async function requireRole(roles: UserRole[]): Promise<Profile> {
  const { user, profile, profileError } = await loadCurrentProfile()
  const accessResult = evaluateRoleAccess(profile, roles)

  if (accessResult === 'authorized' && profile) return profile

  if (!user) {
    logger.warn(
      'auth/requireRole/noUser',
      'No authenticated user found while checking a protected route.',
      { allowedRoles: roles }
    )
  } else if (accessResult === 'missing_profile') {
    logger.warn(
      'auth/requireRole/missingProfile',
      'Authenticated user does not have a matching profile row.',
      {
        userId: user.id,
        email: user.email,
        allowedRoles: roles,
        profileLookupFailed: Boolean(profileError),
      }
    )
  } else if (accessResult === 'blocked_profile') {
    logger.warn(
      'auth/requireRole/blockedProfile',
      'Blocked user attempted to access a protected route.',
      {
        userId: user.id,
        email: user.email,
        allowedRoles: roles,
      }
    )
  } else if (accessResult === 'inactive_clinic') {
    logger.warn(
      'auth/requireRole/inactiveClinic',
      'User from an inactive clinic attempted to access a protected route.',
      {
        userId: user.id,
        email: user.email,
        allowedRoles: roles,
        clinicId: profile?.clinic_id ?? null,
      }
    )
  } else {
    logger.warn(
      'auth/requireRole/insufficientRole',
      'Authenticated user lacks the required role for this route.',
      {
        userId: user.id,
        email: user.email,
        allowedRoles: roles,
        actualRole: profile?.role ?? null,
      }
    )
  }

  redirect(profile?.role === 'external_staff' ? EXTERNAL_WORKSPACE_PATH : '/')
}
