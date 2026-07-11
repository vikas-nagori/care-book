import type { CreatePackageTemplateInput, PackageTemplate } from '../supabase/types'

type ValidationFailure = {
  success: false
  errorCode: string
  message: string
}

type ValidationSuccess = {
  success: true
  values: {
    name: string
    minSessions: number
    perSessionAmount: number
  }
}

// Validate an admin-entered package template (name, minimum sessions, rate).
export function validatePackageTemplateInput(
  input: CreatePackageTemplateInput,
): ValidationSuccess | ValidationFailure {
  const name = input.name.trim()
  if (!name) {
    return {
      success: false,
      errorCode: 'PACKAGE_TEMPLATE_NAME_REQUIRED',
      message: 'Enter a template name.',
    }
  }

  if (!Number.isInteger(input.minSessions) || input.minSessions <= 0) {
    return {
      success: false,
      errorCode: 'PACKAGE_TEMPLATE_INVALID_SESSIONS',
      message: 'Minimum sessions must be a whole number greater than zero.',
    }
  }

  if (!Number.isFinite(input.perSessionAmount) || input.perSessionAmount < 0) {
    return {
      success: false,
      errorCode: 'PACKAGE_TEMPLATE_INVALID_AMOUNT',
      message: 'Per-session charge cannot be negative.',
    }
  }

  return {
    success: true,
    values: {
      name,
      minSessions: input.minSessions,
      perSessionAmount: input.perSessionAmount,
    },
  }
}

export type PackageTemplateFormValues = {
  name: string
  sessions: string
  perSessionAmount: string
}

// Map a selected template to the billing-entry package fields. The template's
// minimum session count becomes the default (editable) session count.
export function applyPackageTemplate(template: PackageTemplate): PackageTemplateFormValues {
  return {
    name: template.name,
    sessions: String(template.min_sessions),
    perSessionAmount: String(template.per_session_amount),
  }
}
