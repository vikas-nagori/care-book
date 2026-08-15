export type PackageProgressInput = {
  status: string
  availedSessions: number
  scheduledSessions: number
  totalSessions: number
}

export type PackageProgress = {
  /** Width (%) of the solid segment of the progress bar — sessions already taken. */
  availedPct: number
  /** Width (%) of the faded segment — booked but not yet delivered. Never overflows the bar. */
  scheduledPct: number
  /**
   * The lifecycle a reader should see. A package the ledger marked 'completed' while sessions are
   * still outstanding (a released allocation, a re-opened session) is still an active package to a
   * human, so it reads as active rather than contradicting the counts printed next to it.
   */
  displayStatus: string
}

/**
 * Shared session-progress maths for every surface that draws a package bar (billing overview,
 * package detail, balance detail). Kept in one place so the three never drift apart.
 */
export function getPackageProgress({
  status,
  availedSessions,
  scheduledSessions,
  totalSessions,
}: PackageProgressInput): PackageProgress {
  const availedPct = totalSessions > 0 ? Math.min(100, (availedSessions / totalSessions) * 100) : 0
  const scheduledPct = totalSessions > 0
    ? Math.max(0, Math.min(100 - availedPct, (scheduledSessions / totalSessions) * 100))
    : 0
  const displayStatus = status === 'completed' && availedSessions !== totalSessions ? 'active' : status

  return { availedPct, scheduledPct, displayStatus }
}

export type BalanceDetailPackageCandidate = {
  lifecycle: string
  dueAmount: number
  refundableCredit: number
}

/**
 * Which of a patient's packages belong on the balance-detail drill-down. An active package is always
 * part of the picture; a closed or cancelled one only matters while it still carries money — those
 * are the rows the "package due" and "package credit" tiles are made of. Everything else is history
 * that belongs on the packages tab, not here.
 */
export function isBalanceDetailPackage(pkg: BalanceDetailPackageCandidate): boolean {
  return pkg.lifecycle === 'active' || pkg.dueAmount > 0 || pkg.refundableCredit > 0
}

export const PACKAGE_STATUS_BADGE_CLASS: Record<string, string> = {
  active: 'ok',
  completed: 'info',
  cancelled: 'bad',
}

export const PACKAGE_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
