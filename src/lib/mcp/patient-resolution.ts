export type PatientCandidate = {
  id: string
  name: string
  phone?: string | null
  dob?: string | null
  matchScore?: number | null
}

export type PatientMatch =
  | { kind: 'selected'; patient: PatientCandidate }
  | { kind: 'ambiguous'; candidates: PatientCandidate[] }
  | { kind: 'none' }

export function normalizePatientName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/**
 * Decide whether a search term identifies one patient beyond doubt.
 *
 * A single record is auto-selected only when it is the *only* thing the search turned up and its
 * name matches exactly. An exact match must never suppress the rest of the candidate set: a clinic
 * with "Aadi" and "Aadi dadi" on the books would otherwise have every "Aadi" booking silently
 * routed to the first record, with no prompt and no way for the caller to notice.
 */
export function classifyPatientMatches(name: string, candidates: PatientCandidate[]): PatientMatch {
  const normalized = normalizePatientName(name)
  if (!normalized || candidates.length === 0) return { kind: 'none' }

  const exact = candidates.filter((candidate) => normalizePatientName(candidate.name) === normalized)
  if (exact.length === 1 && candidates.length === 1) return { kind: 'selected', patient: exact[0] }

  // Exact matches lead the list so the caller sees the likeliest record first, but the near
  // matches travel with them so the choice is made against the full picture.
  const ordered = [...exact, ...candidates.filter((candidate) => !exact.includes(candidate))]
  return { kind: 'ambiguous', candidates: ordered }
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return '••••'
  return `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}

export function publicPatientCandidate(candidate: PatientCandidate) {
  return { name: candidate.name, phone: maskPhone(candidate.phone), dob: candidate.dob ?? null }
}
