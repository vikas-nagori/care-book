export type FeeSource = 'provided' | 'patient_history' | 'appointment_type'

export type FeeResolution =
  | { kind: 'resolved'; fee: number; source: FeeSource }
  | { kind: 'needs_fee'; defaultRate: number | null }

export type FeeInputs = {
  /** Fee the caller passed explicitly, if any. */
  explicitFee: unknown
  /** What this patient was last charged for this same appointment type, if anything. */
  lastPatientFee: number | null | undefined
  /** The appointment type's configured default. */
  sessionRate: number | null | undefined
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Decide the fee a new appointment should carry.
 *
 * A null fee is never acceptable here. The ledger stores coalesce(fee, 0), and migration 039 stamps
 * a zero-value charge 'paid' the moment it exists — so an unpriced booking silently becomes a
 * delivered-and-settled session that `guard_completed_appointment_fee_v2` then makes very hard to
 * reprice.
 *
 * The patient's own last fee for the same type outranks the type default, because rates here are
 * negotiated per patient: only a quarter of home visits are billed at the type's configured rate,
 * and one patient's standing rate is 50% above it. Falling back to the type default would quietly
 * undercharge them on every booking. When neither source exists, the tool asks instead of guessing.
 */
export function resolveAppointmentFee({ explicitFee, lastPatientFee, sessionRate }: FeeInputs): FeeResolution {
  if (typeof explicitFee === 'number' && Number.isFinite(explicitFee) && explicitFee >= 0) {
    return { kind: 'resolved', fee: explicitFee, source: 'provided' }
  }

  const historical = positive(lastPatientFee)
  if (historical !== null) return { kind: 'resolved', fee: historical, source: 'patient_history' }

  const rate = positive(sessionRate)
  if (rate !== null) return { kind: 'resolved', fee: rate, source: 'appointment_type' }

  return {
    kind: 'needs_fee',
    defaultRate: typeof sessionRate === 'number' && Number.isFinite(sessionRate) ? sessionRate : null,
  }
}

export function describeFeeSource(source: FeeSource): string {
  switch (source) {
    case 'provided':
      return 'the fee supplied with this request'
    case 'patient_history':
      return "this patient's most recent fee for the same appointment type"
    case 'appointment_type':
      return "the appointment type's default session rate"
  }
}
