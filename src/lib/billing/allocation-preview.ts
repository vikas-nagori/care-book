// What a new regular receipt will actually settle, shown before the user saves it.
//
// This deliberately mirrors the ordinary-funding loop in
// `private.reconcile_patient_billing_v2` (migration 031). Two properties of that loop are easy
// to get wrong, and the previous preview helper got both wrong:
//
//   1. It is ONE pass ordered by `appointment.date, appointment.time, appointment.id`. It does
//      not settle completed sessions before scheduled ones — a scheduled session with an earlier
//      date is settled first.
//   2. It draws `least(remaining_payment, remaining_charge)`, so the last session it reaches is
//      covered PARTIALLY rather than skipped.
//
// If this file and that loop ever disagree, the preview lies about what the save will do.

export type OutstandingCharge = {
  appointmentId: string
  date: string
  time: string
  type: string
  /** The session's full fee, for context in the UI. */
  chargeAmount: number
  /** Fee minus money already applied to it — what this receipt can still draw. */
  remainingAmount: number
}

export type AllocationPreviewLine = OutstandingCharge & {
  appliedAmount: number
  /** True when this receipt covers only part of what the session still owes. */
  isPartial: boolean
}

export type AllocationPreview = {
  lines: AllocationPreviewLine[]
  appliedTotal: number
  creditLeft: number
}

/** Money is numeric(10,2) in Postgres; keep JS float drift out of the displayed figures. */
function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function byLedgerOrder(left: OutstandingCharge, right: OutstandingCharge) {
  return (
    left.date.localeCompare(right.date) ||
    left.time.localeCompare(right.time) ||
    left.appointmentId.localeCompare(right.appointmentId)
  )
}

export function buildAllocationPreview({
  charges,
  amount,
}: {
  charges: OutstandingCharge[]
  amount: number
}): AllocationPreview {
  const pool = Number.isFinite(amount) && amount > 0 ? amount : 0
  if (pool === 0) {
    return { lines: [], appliedTotal: 0, creditLeft: 0 }
  }

  let remainingPool = pool
  const lines: AllocationPreviewLine[] = []

  for (const charge of [...charges].sort(byLedgerOrder)) {
    if (remainingPool <= 0) break

    const remainingCharge = Number(charge.remainingAmount)
    if (!Number.isFinite(remainingCharge) || remainingCharge <= 0) continue

    const appliedAmount = round2(Math.min(remainingPool, remainingCharge))
    lines.push({
      ...charge,
      appliedAmount,
      isPartial: appliedAmount < remainingCharge,
    })
    remainingPool = round2(remainingPool - appliedAmount)
  }

  const appliedTotal = round2(lines.reduce((total, line) => total + line.appliedAmount, 0))
  return { lines, appliedTotal, creditLeft: round2(pool - appliedTotal) }
}
