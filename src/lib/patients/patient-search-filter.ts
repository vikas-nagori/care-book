// Patient search runs server-side: the browser holds only one page of patients, so filtering
// the loaded array missed anyone past the page boundary entirely. This builds the PostgREST
// `.or()` filter for that query.
//
// Two escaping layers stack here and the order matters:
//   1. LIKE level  — '%', '_' and '*' are wildcards Postgres/PostgREST would honour, and '\'
//      is the LIKE escape character itself. Escape them so a typed '%' means a literal '%'.
//   2. PostgREST level — the value is wrapped in double quotes so that ',', '.', '(' and ')'
//      in a patient's name cannot terminate the or() group or split its branches. Inside those
//      quotes, '"' and '\' need backslash escapes of their own.

/** Longest term we build a filter from. Anything past this is a paste, not a search. */
const MAX_TERM_LENGTH = 100

export function normalizePatientSearchTerm(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function escapeLikeWildcards(value: string) {
  return value.replace(/[\\%_*]/g, (match) => `\\${match}`)
}

function quoteForPostgrest(value: string) {
  return `"${value.replace(/[\\"]/g, (match) => `\\${match}`)}"`
}

/**
 * Returns the `.or()` filter matching a patient by name or phone, or `null` when the term is
 * empty — callers must skip the filter entirely in that case rather than pass an empty string.
 */
export function buildPatientSearchFilter(term: string): string | null {
  const normalized = normalizePatientSearchTerm(term).slice(0, MAX_TERM_LENGTH)
  if (!normalized) return null

  const pattern = quoteForPostgrest(`%${escapeLikeWildcards(normalized)}%`)
  return `name.ilike.${pattern},phone.ilike.${pattern}`
}
