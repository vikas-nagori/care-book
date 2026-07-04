const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
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
