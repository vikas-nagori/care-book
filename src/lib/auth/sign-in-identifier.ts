import { requestErrorMessage } from '../actions/request-error-message.ts'
import { MOBILE_NUMBER_INVALID_MESSAGE, normalizeMobileNumber, toAuthPhone } from './mobile-number.ts'

export type SignInMethod = 'mobile' | 'email'

export type SignInIdentifier =
  | { ok: true; credentials: { phone: string } | { email: string } }
  | { ok: false; message: string }

/** The Supabase Auth identifier for what the person typed, or why it cannot be one. */
export function resolveSignInIdentifier(method: SignInMethod, raw: string): SignInIdentifier {
  if (method === 'email') {
    const email = raw.trim().toLowerCase()
    return email ? { ok: true, credentials: { email } } : { ok: false, message: 'Enter your email.' }
  }

  const national = normalizeMobileNumber(raw)
  if (!national) return { ok: false, message: MOBILE_NUMBER_INVALID_MESSAGE }
  return { ok: true, credentials: { phone: toAuthPhone(national) } }
}

/**
 * One message for an unknown number and a wrong password alike (Auth already answers both with
 * `invalid_credentials`), so the form never reveals which numbers have an account.
 */
export function getSignInErrorMessage(
  method: SignInMethod,
  error: { code?: string; message: string }
): string {
  if (error.code === 'invalid_credentials') {
    return method === 'mobile'
      ? 'Mobile number or password is incorrect.'
      : 'Email or password is incorrect.'
  }
  if (error.code === 'phone_provider_disabled') {
    return 'Mobile sign-in is not switched on yet. Sign in with email instead.'
  }
  if (error.code === 'phone_not_confirmed') {
    return 'This mobile number is not confirmed yet. Ask your clinic admin for a new temporary password.'
  }
  return requestErrorMessage(error, 'Unable to sign in.')
}
