// Generic list pagination shared across drill-down pages (billing metrics, patient history, …).
// The windowing logic lives in patients/appointment-pagination.ts and is re-exported here so
// non-patient callers get a domain-neutral name.

export type { PaginationItem } from './patients/appointment-pagination'
export { getPaginationItems } from './patients/appointment-pagination'

/** Parse a 1-based `?page=` query param, falling back to 1 for missing/invalid values. */
export function parsePageParam(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}
