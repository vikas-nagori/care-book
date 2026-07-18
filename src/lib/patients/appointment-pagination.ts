export type PaginationItem = number | 'ellipsis'

export function parseAppointmentPage(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export function getPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  const safeTotal = Math.max(1, Math.floor(totalPages))
  const safeCurrent = Math.min(safeTotal, Math.max(1, Math.floor(currentPage)))

  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1)
  }

  if (safeCurrent <= 3) return [1, 2, 3, 'ellipsis', safeTotal]
  if (safeCurrent >= safeTotal - 2) {
    return [1, 'ellipsis', safeTotal - 2, safeTotal - 1, safeTotal]
  }

  return [1, 'ellipsis', safeCurrent - 1, safeCurrent, safeCurrent + 1, 'ellipsis', safeTotal]
}
