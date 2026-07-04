import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/lib/supabase/types'
import { logger } from '@/lib/logger'
import { evaluateRoleAccess } from '@/lib/auth-access'

type CurrentProfileLookup = {
  user: {
    id: string
    email: string | null
  } | null
  profile: Profile | null
  profileError: {
    code?: string
    message?: string
  } | null
}

async function loadCurrentProfile(): Promise<CurrentProfileLookup> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError) {
    logger.error('auth/getCurrentProfile/getUser', authError)
  }

  if (!user) {
    return { user: null, profile: null, profileError: null }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
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
    profile: profile ?? null,
    profileError,
  }
}

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

  redirect('/')
}
