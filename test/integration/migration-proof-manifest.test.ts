import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { buildDatabase, dropDatabase, postgresAvailable } from './db.ts'

const root = join(import.meta.dirname, '..', '..')
const proofSql = join(root, 'scripts/verify-migrations-030-034.sql')
const wrapper = join(root, 'scripts/compare-migration-proofs.ts')

// The proof reads a fully migrated schema, not just any reachable Postgres. Without an explicit
// target it builds the standard throwaway database from schema.sql + every migration, so a bare
// Postgres (CI, via the PG* env vars) proves the same invariants as a local Supabase stack.
// Set MIGRATION_PROOF_DATABASE_URL to point the proof at an already-migrated database instead —
// a local Supabase (postgresql://postgres:postgres@127.0.0.1:54322/postgres) or production.
const databaseUrl = process.env.MIGRATION_PROOF_DATABASE_URL
const DB = 'carebook_it_migration_proof'
const buildsOwnDatabase = !databaseUrl
const hasPostgres = buildsOwnDatabase ? postgresAvailable() : true
const skip = hasPostgres ? false : 'no local Postgres reachable'

before(() => {
  if (buildsOwnDatabase && hasPostgres) buildDatabase(DB)
})

after(() => {
  if (buildsOwnDatabase && hasPostgres) dropDatabase(DB)
})

function runProof(): string {
  const target = databaseUrl ? [databaseUrl] : ['-d', DB]
  return execFileSync('psql', [...target, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', proofSql], {
    encoding: 'utf8',
  }).trim()
}

test('migration proof is one deterministic sanitized read-only document and wrapper fails closed', { skip }, () => {
  const first = runProof()
  const second = runProof()
  assert.equal(second, first)
  assert.equal(first.split('\n').length, 1)

  const proof = JSON.parse(first) as { ok: boolean; requiredChecks: string[]; checks: Array<{ check: string; passed: boolean }> }
  assert.equal(proof.ok, true)
  assert.ok(proof.requiredChecks.length > 0)
  assert.deepEqual(new Set(proof.requiredChecks).size, proof.requiredChecks.length)
  assert.ok(proof.requiredChecks.every((required) => proof.checks.some((check) => check.check === required && check.passed)))
  assert.doesNotMatch(first, /"(?:id|name|notes|reason)"\s*:/i)

  const directory = mkdtempSync(join(tmpdir(), 'care-book-proof-'))
  try {
    const local = join(directory, 'local.json')
    const drifted = join(directory, 'drifted.json')
    writeFileSync(local, first)
    writeFileSync(drifted, JSON.stringify({ ...proof, ok: false }))
    assert.throws(() => execFileSync('node', ['--experimental-strip-types', wrapper, local, drifted], { encoding: 'utf8' }))
    assert.equal(readFileSync(local, 'utf8'), first)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
