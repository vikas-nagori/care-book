// Totals for the billing overview tiles, computed from bounded reads.
//
// The overview used to fetch every completed and scheduled appointment the clinic has ever had just
// to add up two months of fees, and every active payment application just to count sessions per
// payment. Both reads grow without bound and PostgREST truncates an un-ranged select at max-rows
// (1000) without an error, so the totals would have silently gone wrong as the clinic grew (one
// clinic was at 903 and 874 rows). The billed figure now comes from the get_billed_month_totals_v1
// aggregate (one row per month × appointment type) and session counts are read only for the
// payments actually on screen.

/** One (month, appointment type) bucket as returned by get_billed_month_totals_v1. */
export type BilledMonthTotalsRow = {
  month: string
  appointment_type: string | null
  /** PostgREST may deliver `numeric` as a string. */
  amount: number | string | null
  session_count: number | string | null
}

/** `YYYY-MM` key of a `YYYY-MM-DD` calendar date — the same key the aggregate groups by. */
export function monthKeyOf(calendarDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) {
    throw new Error(`expected a YYYY-MM-DD calendar date, got ${calendarDate}`)
  }
  return calendarDate.slice(0, 7)
}

/** Total billed (completed session fees) in one month, across every appointment type. */
export function billedTotalForMonth(rows: readonly BilledMonthTotalsRow[], monthKey: string): number {
  let total = 0
  for (const row of rows) {
    if (row.month !== monthKey) continue
    if (row.amount === null || row.amount === '') continue
    const amount = Number(row.amount)
    if (!Number.isFinite(amount)) {
      throw new Error(`billed month totals returned a non-numeric amount for ${row.month}`)
    }
    total += amount
  }
  // Round to paise so float accumulation never shows a stray fraction on a currency tile.
  return Math.round(total * 100) / 100
}

/** Number of active payment applications (linked sessions) per payment id. */
export function countLinkedSessions(rows: readonly { payment_id: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.payment_id] = (counts[row.payment_id] ?? 0) + 1
  return counts
}
