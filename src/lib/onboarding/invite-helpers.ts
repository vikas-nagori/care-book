const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
}

export type InviteCompletionInput = {
  fullName: string
  mobileNumber: string
  password: string
  passwordConfirmation: string
}

export type InviteCompletionField =
  | 'fullName'
  | 'mobileNumber'
  | 'password'
  | 'passwordConfirmation'

export function getInviteCompletionFieldErrorTarget(
  errorCode: string
): InviteCompletionField | null {
  switch (errorCode) {
    case 'INVITE_MISSING_NAME':
      return 'fullName'
    case 'INVITE_MISSING_MOBILE':
      return 'mobileNumber'
    case 'INVITE_MISSING_PASSWORD':
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

  return {
    success: true,
    values: {
      email,
      role: input.role,
    },
  }
}

export function validateInviteCompletionInput(
  input: InviteCompletionInput
):
  | ValidationSuccess<{
      fullName: string
      mobileNumber: string
      password: string
    }>
  | ValidationFailure {
  const fullName = input.fullName.trim()
  const mobileNumber = input.mobileNumber.trim()

  if (!fullName) {
    return {
      success: false,
      errorCode: 'INVITE_MISSING_NAME',
      message: 'Enter the user name.',
    }
  }

  if (!mobileNumber) {
    return {
      success: false,
      errorCode: 'INVITE_MISSING_MOBILE',
      message: 'Enter the mobile number.',
    }
  }

  if (!input.password) {
    return {
      success: false,
      errorCode: 'INVITE_MISSING_PASSWORD',
      message: 'Enter a password.',
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
      fullName,
      mobileNumber,
      password: input.password,
    },
  }
}
