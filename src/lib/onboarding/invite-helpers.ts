import type { UserRole } from '../supabase/types'
import { isUserRole } from '../user-role.ts'
import { MOBILE_NUMBER_INVALID_MESSAGE, normalizeMobileNumber } from '../auth/mobile-number.ts'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const DEFAULT_INVITE_NEXT_PATH = '/auth/complete-invite'

type ValidationFailure = {
  success: false
  errorCode: string
  message: string
}

type ValidationSuccess<T> = {
  success: true
  values: T
}

export type InviteInput = {
  /** Optional since mobile-number sign-in; an empty string means "no email". */
  email?: string | null
  role: UserRole
  fullName: string
  mobileNumber: string
}

/** A validated invite: the 10-digit mobile number is the login, email is optional. */
export type ValidatedInvite = {
  email: string | null
  role: UserRole
  fullName: string
  mobileNumber: string
}

export type InviteCollisionInput = {
  currentClinicId: string
  existingInvite: { clinic_id: string; status: 'pending' | 'accepted' | 'revoked' } | null
  existingProfile: { id: string; email: string | null; status: 'active' | 'blocked' | 'deleted' } | null
}

export type InviteCollisionResult =
  | 'none'
  | 'reuse_revoked_invite'
  | 'already_pending'
  | 'already_active'
  | 'conflict'

export type InviteCompletionInput = {
  password: string
  passwordConfirmation: string
}

export type InviteCompletionField = 'password' | 'passwordConfirmation'

// Invite completion is the account-creation path for every staff and admin user, and the only
// other strength gate is the Supabase project's `minimum_password_length` (6 in the checked-in
// local config, with `password_requirements` unset). Enforce the policy here so it holds on
// both the client and the server regardless of what the project is configured with.
export const INVITE_PASSWORD_MIN_LENGTH = 8
// Derived from the constant so the number users are shown cannot drift from the one enforced.
export const INVITE_PASSWORD_POLICY_MESSAGE =
  `Use at least ${INVITE_PASSWORD_MIN_LENGTH} characters with an uppercase letter, a lowercase letter, and a number.`

export function meetsInvitePasswordPolicy(password: string): boolean {
  return (
    password.length >= INVITE_PASSWORD_MIN_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  )
}

export function getInviteCompletionFieldErrorTarget(
  errorCode: string
): InviteCompletionField | null {
  switch (errorCode) {
    case 'INVITE_MISSING_PASSWORD':
    case 'INVITE_PASSWORD_TOO_WEAK':
      return 'password'
    case 'INVITE_PASSWORD_MISMATCH':
      return 'passwordConfirmation'
    default:
      return null
  }
}

export type PasswordChangeField = 'currentPassword' | InviteCompletionField

export function getPasswordChangeFieldErrorTarget(
  errorCode: string
): PasswordChangeField | null {
  switch (errorCode) {
    case 'PASSWORD_CURRENT_REQUIRED':
    case 'PASSWORD_CURRENT_INVALID':
      return 'currentPassword'
    default:
      return getInviteCompletionFieldErrorTarget(errorCode)
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * The users list hides anyone whose invite is still pending: provisioning a login writes their
 * profile immediately, so without this they would show up both as a user and as an invite.
 *
 * Email is optional since mobile-number sign-in, so it can't be the join key on its own. Match on
 * the invite's `auth_user_id` (set whenever a login was provisioned) and fall back to email only
 * for legacy invites that never got one.
 */
export function excludePendingInviteeProfiles<P extends { id: string; email: string | null }>(
  profiles: readonly P[],
  invites: ReadonlyArray<{ status: string; email: string | null; auth_user_id: string | null }>,
): P[] {
  const pendingInvites = invites.filter((invite) => invite.status === 'pending')
  const pendingUserIds = new Set(
    pendingInvites.flatMap((invite) => (invite.auth_user_id ? [invite.auth_user_id] : [])),
  )
  const pendingEmails = new Set(
    pendingInvites.flatMap((invite) => (invite.email?.trim() ? [normalizeEmail(invite.email)] : [])),
  )

  return profiles.filter((profile) => {
    if (pendingUserIds.has(profile.id)) return false
    return !(profile.email?.trim() && pendingEmails.has(normalizeEmail(profile.email)))
  })
}

export function normalizeSiteOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null

  try {
    const url = new URL(origin.trim().replace(/\/+$/, ''))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

export function getInviteCollisionResult({
  currentClinicId,
  existingInvite,
  existingProfile,
}: InviteCollisionInput): InviteCollisionResult {
  // A soft-deleted identity is immutable by design, so it can never be re-invited.
  if (existingProfile?.status === 'deleted') return 'conflict'
  // A profile row on its own proves nothing: `on_auth_user_created` writes one the moment an
  // invited user's auth identity is created, long before they accept. The invite is what says
  // whether they ever completed sign-up, so it decides — and only an email with no invite at
  // all can be judged active from the profile alone.
  if (!existingInvite) return existingProfile ? 'already_active' : 'none'
  if (existingInvite.clinic_id !== currentClinicId) return 'conflict'
  if (existingInvite.status === 'pending') return 'already_pending'
  if (existingInvite.status === 'accepted') return 'already_active'
  return 'reuse_revoked_invite'
}

export function validateInviteInput(
  input: InviteInput
): ValidationSuccess<ValidatedInvite> | ValidationFailure {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null

  if (email !== null && !EMAIL_PATTERN.test(email)) {
    return {
      success: false,
      errorCode: 'INVITE_INVALID_EMAIL',
      message: 'Enter a valid email address.',
    }
  }

  if (!isUserRole(input.role)) {
    return {
      success: false,
      errorCode: 'INVITE_INVALID_ROLE',
      message: 'Choose a valid role.',
    }
  }

  const fullName = input.fullName.trim()
  if (!fullName) {
    return {
      success: false,
      errorCode: 'INVITE_MISSING_NAME',
      message: 'Enter the user name.',
    }
  }

  if (!input.mobileNumber?.trim()) {
    return {
      success: false,
      errorCode: 'INVITE_MISSING_MOBILE',
      message: 'Enter the mobile number.',
    }
  }

  // The mobile number is the login, so it must be one Auth can match at sign-in.
  const mobileNumber = normalizeMobileNumber(input.mobileNumber)
  if (!mobileNumber) {
    return {
      success: false,
      errorCode: 'INVITE_INVALID_MOBILE',
      message: MOBILE_NUMBER_INVALID_MESSAGE,
    }
  }

  return {
    success: true,
    values: {
      email,
      role: input.role,
      fullName,
      mobileNumber,
    },
  }
}

export function validateInviteCompletionInput(
  input: InviteCompletionInput
): ValidationSuccess<{ password: string }> | ValidationFailure {
  if (!input.password) {
    return {
      success: false,
      errorCode: 'INVITE_MISSING_PASSWORD',
      message: 'Enter a password.',
    }
  }

  if (!meetsInvitePasswordPolicy(input.password)) {
    return {
      success: false,
      errorCode: 'INVITE_PASSWORD_TOO_WEAK',
      message: INVITE_PASSWORD_POLICY_MESSAGE,
    }
  }

  if (input.password !== input.passwordConfirmation) {
    return {
      success: false,
      errorCode: 'INVITE_PASSWORD_MISMATCH',
      message: 'Passwords do not match.',
    }
  }

  return {
    success: true,
    values: {
      password: input.password,
    },
  }
}
