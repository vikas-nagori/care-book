export type PatientCandidate = {
  id: string
  name: string
  phone?: string | null
  dob?: string | null
}

export type PatientMatch =
  | { kind: 'selected'; patient: PatientCandidate }
  | { kind: 'ambiguous'; candidates: PatientCandidate[] }
  | { kind: 'none' }

export function normalizePatientName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function classifyPatientMatches(name: string, candidates: PatientCandidate[]): PatientMatch {
  const normalized = normalizePatientName(name)
  if (!normalized || candidates.length === 0) return { kind: 'none' }
  const exact = candidates.filter((candidate) => normalizePatientName(candidate.name) === normalized)
  if (exact.length === 1) return { kind: 'selected', patient: exact[0] }
  return { kind: 'ambiguous', candidates: exact.length > 1 ? exact : candidates }
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
