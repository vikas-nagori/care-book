export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  if (/^\/+\s*https?:/i.test(raw)) return null
  return raw
}
