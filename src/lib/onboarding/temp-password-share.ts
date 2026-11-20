import type { TempPasswordCredentials } from '../supabase/types'

/**
 * The message an admin sends a new user (usually over WhatsApp): everything they need to sign in
 * the first time, so the admin never has to type the link or email by hand.
 */
export function buildTempPasswordShareText(
  credentials: TempPasswordCredentials,
  origin: string
): string {
  return [
    'Your Care-Book login',
    `Sign in: ${origin.replace(/\/+$/, '')}/login`,
    `Email: ${credentials.email}`,
    `Temporary password: ${credentials.tempPassword}`,
    'You’ll set your own password after signing in.',
  ].join('\n')
}

/** A share sheet cancelled by the user rejects with AbortError — not a failure to report. */
export function isShareCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
