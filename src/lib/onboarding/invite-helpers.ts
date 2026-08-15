const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const DEFAULT_INVITE_NEXT_PATH = '/auth/complete-invite'

type InviteRole = 'admin' | 'staff'

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
  email: string
  role: InviteRole
  fullName: string
  mobileNumber: string
}

export type InviteCollisionInput = {
  currentClinicId: string
  existingInvite: { clinic_id: string; status: 'pending' | 'accepted' | 'revoked' } | null
  existingProfile: { id: string; email: string } | null
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
export const INVITE_PASSWORD_MIN_LENGTH = 12
export const INVITE_PASSWORD_POLICY_MESSAGE =
  'Use at least 12 characters with an uppercase letter, a lowercase letter, and a number.'

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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
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

export function buildInviteRedirectUrl(origin: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(DEFAULT_INVITE_NEXT_PATH)}`
}

export function getInviteCollisionResult({
  currentClinicId,
  existingInvite,
  existingProfile,
}: InviteCollisionInput): InviteCollisionResult {
  if (existingProfile) return 'already_active'
  if (!existingInvite) return 'none'
  if (existingInvite.clinic_id !== currentClinicId) return 'conflict'
  if (existingInvite.status === 'pending') return 'already_pending'
  if (existingInvite.status === 'accepted') return 'already_active'
  return 'reuse_revoked_invite'
}

export function validateInviteInput(
  input: InviteInput
): ValidationSuccess<InviteInput> | ValidationFailure {
  const email = normalizeEmail(input.email)

  if (!EMAIL_PATTERN.test(email)) {
    return {
      success: false,
      errorCode: 'INVITE_INVALID_EMAIL',
      message: 'Enter a valid email address.',
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

  const mobileNumber = input.mobileNumber.trim()
  if (!mobileNumber) {
    return {
      success: false,
      errorCode: 'INVITE_MISSING_MOBILE',
      message: 'Enter the mobile number.',
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
