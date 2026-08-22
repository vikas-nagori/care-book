/**
 * Trigram similarity, in TypeScript.
 *
 * Patient lookup used a bare `ilike '%term%'`, so a shortened name or a typo found nothing at all.
 * This is the same Dice-coefficient-over-character-trigrams idea Postgres `pg_trgm` implements,
 * done in the app instead: the candidate list is already scoped by RLS to one clinic, and clinics
 * hold tens of patients, so scoring them here costs nothing and needs no extension, no index, and
 * no schema change. Revisit if a single clinic ever reaches the low thousands of patients.
 */

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/** Pad the way pg_trgm does, so word starts and ends carry weight. */
function trigrams(value: string): Set<string> {
  const padded = `  ${normalize(value)} `
  const found = new Set<string>()
  for (let index = 0; index < padded.length - 2; index += 1) {
    found.add(padded.slice(index, index + 3))
  }
  return found
}

/** Dice coefficient of the two trigram sets: 0 for nothing in common, 1 for identical. */
export function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left)
  const b = trigrams(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared += 1
  return (2 * shared) / (a.size + b.size)
}

export const FUZZY_MATCH_THRESHOLD = 0.3

export type ScoredName<T> = { item: T; score: number }

/**
 * Rank candidates against a search term, keeping only plausible ones.
 *
 * Scoring is tiered so the tool layer can tell "certain" from "probable": an exact name scores 1,
 * a containment match 0.9, and anything else its raw trigram similarity. Ties break on name so the
 * order is stable between calls.
 */
export function rankByName<T>(term: string, candidates: T[], nameOf: (item: T) => string): ScoredName<T>[] {
  const needle = normalize(term)
  if (!needle) return []

  return candidates
    .map((item) => {
      const name = normalize(nameOf(item))
      if (name === needle) return { item, score: 1 }
      if (name.includes(needle)) return { item, score: 0.9 }
      return { item, score: trigramSimilarity(name, needle) }
    })
    .filter((scored) => scored.score >= FUZZY_MATCH_THRESHOLD)
    .sort((left, right) => right.score - left.score || nameOf(left.item).localeCompare(nameOf(right.item)))
}
