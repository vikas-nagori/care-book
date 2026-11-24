export const DEFAULT_DURATION_MINUTES = 45
/** Same bounds the booking API enforces (booking-contract.ts). */
export const MAX_DURATION_MINUTES = 1440

export type DurationInput = { ok: true; minutes: number } | { ok: false; message: string }

/**
 * The Duration (min) field as typed. Blank means the default length; anything else must be a
 * whole number of minutes in range. A 0 is refused rather than silently becoming the default (G-17c).
 */
export function parseDurationInput(raw: string | null | undefined): DurationInput {
  const text = (raw ?? '').trim()
  if (text === '') return { ok: true, minutes: DEFAULT_DURATION_MINUTES }
  const minutes = Number(text)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_DURATION_MINUTES) {
    return { ok: false, message: `Duration must be a whole number of minutes from 1 to ${MAX_DURATION_MINUTES}.` }
  }
  return { ok: true, minutes }
}
