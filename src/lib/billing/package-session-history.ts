export type PackageAllocationRecord = {
  id: string
  appointmentReferenceId: string
  lifecycle: 'scheduled' | 'availed' | 'released'
}

/**
 * The allocation ledger records lifecycle transitions, not sessions: when an appointment moves from
 * scheduled to completed, reconciliation releases the old `scheduled` allocation and inserts a new
 * `availed` one, so one session ends up with several ledger rows. Session history is a per-session
 * view, so collapse to one row per appointment: the current (non-released) allocation if the session
 * still holds one, otherwise the last release, which is how a returned session reads.
 *
 * Rows must arrive in ledger order (oldest `created_at` first) so the last match wins.
 */
export function collapsePackageSessionHistory<T extends PackageAllocationRecord>(rows: T[]): T[] {
  const current = new Map<string, T>()
  for (const row of rows) {
    const kept = current.get(row.appointmentReferenceId)
    if (kept && kept.lifecycle !== 'released' && row.lifecycle === 'released') continue
    current.set(row.appointmentReferenceId, row)
  }
  return rows.filter((row) => current.get(row.appointmentReferenceId) === row)
}
