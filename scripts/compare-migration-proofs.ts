import { readFileSync } from 'node:fs'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Proof = {
  ok?: unknown
  requiredChecks?: unknown
  checks?: unknown
}

function normalize(value: Json): Json {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]))
  }
  return value
}

function parseProof(document: string): Json {
  return JSON.parse(document) as Json
}

function proofErrors(proof: Json, source: string): string[] {
  if (!proof || Array.isArray(proof) || typeof proof !== 'object') return [`${source}: document is not an object`]
  const typed = proof as Proof
  const errors: string[] = []
  if (typed.ok !== true) errors.push(`${source}: ok is not true`)
  if (!Array.isArray(typed.requiredChecks) || !typed.requiredChecks.every((check) => typeof check === 'string')) {
    errors.push(`${source}: requiredChecks is invalid`)
    return errors
  }
  if (!Array.isArray(typed.checks)) {
    errors.push(`${source}: checks is invalid`)
    return errors
  }
  const checks = new Map<string, unknown>()
  for (const item of typed.checks) {
    if (item && typeof item === 'object' && !Array.isArray(item) && typeof (item as { check?: unknown }).check === 'string') {
      checks.set((item as { check: string }).check, item)
    }
  }
  for (const required of typed.requiredChecks) {
    const item = checks.get(required as string) as { passed?: unknown } | undefined
    if (!item) errors.push(`${source}: required check missing: ${required}`)
    else if (item.passed !== true) errors.push(`${source}: required check failed: ${required}`)
  }
  return errors
}

export function compareMigrationProofDocuments(localDocument: string, productionDocument: string): { ok: boolean; errors: string[] } {
  let local: Json
  let production: Json
  try {
    local = parseProof(localDocument)
  } catch {
    return { ok: false, errors: ['local: invalid JSON'] }
  }
  try {
    production = parseProof(productionDocument)
  } catch {
    return { ok: false, errors: ['production: invalid JSON'] }
  }

  const errors = [...proofErrors(local, 'local'), ...proofErrors(production, 'production')]
  if (JSON.stringify(normalize(local)) !== JSON.stringify(normalize(production))) {
    errors.push('local and production proof documents differ after normalization')
  }
  return { ok: errors.length === 0, errors }
}

if (process.argv[1]?.endsWith('compare-migration-proofs.ts')) {
  const [localPath, productionPath] = process.argv.slice(2)
  if (!localPath || !productionPath) {
    process.stderr.write('usage: compare-migration-proofs.ts <local-proof.json> <production-proof.json>\n')
    process.exitCode = 2
  } else {
    const result = compareMigrationProofDocuments(readFileSync(localPath, 'utf8'), readFileSync(productionPath, 'utf8'))
    if (!result.ok) {
      process.stderr.write(`${result.errors.join('\n')}\n`)
      process.exitCode = 1
    }
  }
}
