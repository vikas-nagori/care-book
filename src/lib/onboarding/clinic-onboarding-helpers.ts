const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE_NUMBER_PATTERN = /^\d{10}$/
export const ONBOARDING_THROTTLE_WINDOW_MINUTES = 30
export const ONBOARDING_MAX_PENDING_PER_FINGERPRINT = 3

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeKeyPart(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

type ValidationFailure = {
  success: false
  errorCode: string
  message: string
}

type ValidationSuccess<T> = {
  success: true
  values: T
}

export type ClinicOnboardingInput = {
  clinicName: string
  ownerFullName: string
  ownerEmail: string
  ownerMobileNumber: string
  clinicPhone?: string | null
  clinicAddress?: string | null
}

export function buildClinicOnboardingFingerprint({
  clinicName,
  ownerEmail,
  ownerMobileNumber,
  requestIp,
}: {
  clinicName: string
  ownerEmail: string
  ownerMobileNumber: string
  requestIp: string | null
}): string {
  return hashString(
    [
      normalizeKeyPart(clinicName),
      normalizeKeyPart(ownerEmail),
      normalizeKeyPart(ownerMobileNumber),
      normalizeKeyPart(requestIp),
    ].join('|')
  )
}

export function getOnboardingThrottleWindowStart(now = new Date(), windowMinutes = ONBOARDING_THROTTLE_WINDOW_MINUTES) {
  return new Date(now.getTime() - windowMinutes * 60 * 1000).toISOString()
}

export function validateClinicOnboardingInput(
  input: ClinicOnboardingInput
):
  | ValidationSuccess<{
      clinicName: string
      ownerFullName: string
      ownerEmail: string
      ownerMobileNumber: string
      clinicPhone: string | null
      clinicAddress: string | null
    }>
  | ValidationFailure {
  const clinicName = input.clinicName.trim()
  const ownerFullName = input.ownerFullName.trim()
  const ownerEmail = normalizeEmail(input.ownerEmail)
  const ownerMobileNumber = input.ownerMobileNumber.trim()
  const clinicPhone = input.clinicPhone?.trim() || null
  const clinicAddress = input.clinicAddress?.trim() || null

  if (!clinicName) {
    return {
      success: false,
      errorCode: 'CLINIC_ONBOARDING_MISSING_CLINIC',
      message: 'Enter the clinic name.',
    }
  }

  if (!ownerFullName) {
    return {
      success: false,
      errorCode: 'CLINIC_ONBOARDING_MISSING_OWNER',
      message: 'Enter the owner name.',
    }
  }

  if (!EMAIL_PATTERN.test(ownerEmail)) {
    return {
      success: false,
      errorCode: 'CLINIC_ONBOARDING_INVALID_EMAIL',
      message: 'Enter a valid owner email address.',
    }
  }

  if (!ownerMobileNumber) {
    return {
      success: false,
      errorCode: 'CLINIC_ONBOARDING_MISSING_MOBILE',
      message: 'Enter the owner mobile number.',
    }
  }

  if (!MOBILE_NUMBER_PATTERN.test(ownerMobileNumber)) {
    return {
      success: false,
      errorCode: 'CLINIC_ONBOARDING_INVALID_MOBILE',
      message: 'Enter a 10 digit owner mobile number.',
    }
  }

  return {
    success: true,
    values: {
      clinicName,
      ownerFullName,
      ownerEmail,
      ownerMobileNumber,
      clinicPhone,
      clinicAddress,
    },
  }
}
