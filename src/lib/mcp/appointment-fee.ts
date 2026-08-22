export type FeeResolution =
  | { kind: 'resolved'; fee: number }
  | { kind: 'needs_fee'; defaultRate: number | null }

/**
 * Decide the fee a new appointment should carry.
 *
 * A null fee is never acceptable here. The billing ledger coalesces it to a zero-value charge, and
 * migration 039 stamps a zero-value charge 'paid' the moment it exists — so an unpriced booking
 * silently becomes a delivered-and-settled session, which `guard_completed_appointment_fee_v2` then
 * makes very hard to reprice. When neither the caller nor the appointment type supplies a positive
 * rate, the tool asks instead of writing.
 */
export function resolveAppointmentFee(explicitFee: unknown, sessionRate: number | null | undefined): FeeResolution {
  if (typeof explicitFee === 'number' && Number.isFinite(explicitFee) && explicitFee >= 0) {
    return { kind: 'resolved', fee: explicitFee }
  }
  const rate = typeof sessionRate === 'number' && Number.isFinite(sessionRate) ? sessionRate : null
  if (rate !== null && rate > 0) return { kind: 'resolved', fee: rate }
  return { kind: 'needs_fee', defaultRate: rate }
}
