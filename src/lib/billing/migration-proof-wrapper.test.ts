import assert from 'node:assert/strict'
import test from 'node:test'

import { compareMigrationProofDocuments } from '../../../scripts/compare-migration-proofs.ts'

function proof(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    manifestVersion: 'carebook-migrations-030-034-v3',
    readOnly: true,
    ok: true,
    requiredChecks: ['schema_pgcrypto_in_extensions_schema'],
    checks: [{ check: 'schema_pgcrypto_in_extensions_schema', passed: true }],
    functions: [{ function: 'private.example()', definitionHash: 'abc123', passed: true }],
    ...overrides,
  })
}

test('normalizes and compares complete migration proof documents, including definition hashes', () => {
  assert.equal(compareMigrationProofDocuments(proof(), proof()).ok, true)
  assert.equal(
    compareMigrationProofDocuments(proof(), proof({ functions: [{ function: 'private.example()', definitionHash: 'changed', passed: true }] })).ok,
    false
  )
})

test('fails closed when a proof is unhealthy or omits a required check', () => {
  assert.equal(compareMigrationProofDocuments(proof({ ok: false }), proof()).ok, false)
  assert.equal(compareMigrationProofDocuments(proof({ checks: [] }), proof()).ok, false)
  assert.equal(compareMigrationProofDocuments(
    JSON.stringify({ manifestVersion: 'carebook-migrations-030-034-v3', readOnly: true, ok: true, requiredChecks: [], checks: [] }),
    JSON.stringify({ manifestVersion: 'carebook-migrations-030-034-v3', readOnly: true, ok: true, requiredChecks: [], checks: [] })
  ).ok, false)
})
