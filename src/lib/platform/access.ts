export const DEFAULT_PLATFORM_ADMIN_EMAIL = 'vikasrnagori@gmail.com'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function parsePlatformAdminEmails(allowlist: string | undefined | null): string[] {
  const rawAllowlist = allowlist?.trim() ? allowlist : DEFAULT_PLATFORM_ADMIN_EMAIL
  return rawAllowlist
    .split(',')
    .map((email) => normalizeEmail(email))
    .filter(Boolean)
}

export function isPlatformAdminEmail(
  email: string | null | undefined,
  allowlist = process.env.PLATFORM_ADMIN_EMAILS
): boolean {
  if (!email) return false
  const normalizedEmail = normalizeEmail(email)
  return parsePlatformAdminEmails(allowlist).includes(normalizedEmail)
}
