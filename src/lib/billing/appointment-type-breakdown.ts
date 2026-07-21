// Per-appointment-type subtotals for the "Total billed" drill-down. The billed metric lists every
// completed session (each carries its own fee + denormalized type); this collapses those rows into
// one bucket per appointment type so the drill-down can show a breakdown strip above the flat list.

export type AppointmentTypeBreakdownRow = {
  /** Appointment type name (denormalized on the appointment), or "Untyped" when blank. */
  type: string
  /** Sum of session fees for this type. */
  amount: number
  /** Number of sessions in this type — a session still counts even when its fee is 0. */
  count: number
}

export type BilledSession = {
  type: string | null | undefined
  fee: number | null | undefined
}

const UNTYPED_LABEL = 'Untyped'

/**
 * Group billed sessions into per-type subtotals, sorted by amount descending then type name (stable).
 * Blank/nullish types collapse into a single "Untyped" bucket and non-finite fees count as 0, so the
 * returned rows always sum to the drill-down total. Callers decide whether to render (a "bifurcation"
 * only makes sense with 2+ distinct types).
 */
export function buildAppointmentTypeBreakdown(sessions: BilledSession[]): AppointmentTypeBreakdownRow[] {
  const buckets = new Map<string, AppointmentTypeBreakdownRow>()

  for (const session of sessions) {
    const trimmed = session.type?.trim()
    const type = trimmed ? trimmed : UNTYPED_LABEL
    const fee = Number(session.fee ?? 0)
    const amount = Number.isFinite(fee) ? fee : 0

    const existing = buckets.get(type)
    if (existing) {
      existing.amount += amount
      existing.count += 1
    } else {
      buckets.set(type, { type, amount, count: 1 })
    }
  }

  return Array.from(buckets.values()).sort(
    (left, right) => right.amount - left.amount || left.type.localeCompare(right.type),
  )
}
