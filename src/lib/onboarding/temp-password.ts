import { randomInt } from 'node:crypto'

import { INVITE_PASSWORD_MIN_LENGTH, meetsInvitePasswordPolicy } from './invite-helpers.ts'

// Ambiguity-free alphabet: no 0/O/o, 1/I/l/i, so a password read aloud or retyped from a DM
// cannot be mis-transcribed.
const LOWER = 'abcdefghjkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const ALL = LOWER + UPPER + DIGITS

export const TEMP_PASSWORD_LENGTH = 14

/**
 * Generates a one-time temporary password for clinic-owner onboarding. Guarantees at least one
 * lowercase letter, one uppercase letter, and one digit by construction, so the result always
 * satisfies `meetsInvitePasswordPolicy`.
 */
export function generateTempPassword(length: number = TEMP_PASSWORD_LENGTH): string {
  if (length < INVITE_PASSWORD_MIN_LENGTH) {
    throw new Error(`Temp password length must be at least ${INVITE_PASSWORD_MIN_LENGTH}.`)
  }

  const chars = [
    LOWER[randomInt(LOWER.length)],
    UPPER[randomInt(UPPER.length)],
    DIGITS[randomInt(DIGITS.length)],
  ]
  while (chars.length < length) {
    chars.push(ALL[randomInt(ALL.length)])
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  const password = chars.join('')
  if (!meetsInvitePasswordPolicy(password)) {
    throw new Error('Generated temp password failed the password policy.')
  }
  return password
}
