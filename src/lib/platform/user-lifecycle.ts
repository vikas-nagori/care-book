export function normalizeUserDeletionReason(reason: string | null | undefined): string | null {
  const normalized = reason?.trim()
  return normalized ? normalized : null
}
