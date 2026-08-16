import test from 'node:test'
import assert from 'node:assert/strict'

import { buildPatientSearchFilter, normalizePatientSearchTerm } from './patient-search-filter.ts'

test('normalizes a term by trimming and collapsing inner whitespace', () => {
  assert.equal(normalizePatientSearchTerm('  Jayant   Kabra  '), 'Jayant Kabra')
  assert.equal(normalizePatientSearchTerm('   '), '')
})

test('builds an ilike filter across name and phone', () => {
  assert.equal(
    buildPatientSearchFilter('jayant'),
    'name.ilike."%jayant%",phone.ilike."%jayant%"',
  )
})

test('returns null for an empty term so callers skip the filter', () => {
  assert.equal(buildPatientSearchFilter(''), null)
  assert.equal(buildPatientSearchFilter('   '), null)
})

test('quotes terms containing PostgREST reserved characters', () => {
  // A comma would otherwise be read as the separator between the two or() branches,
  // and a closing paren would terminate the or() group early.
  assert.equal(
    buildPatientSearchFilter('Kabra, A (Sr)'),
    'name.ilike."%Kabra, A (Sr)%",phone.ilike."%Kabra, A (Sr)%"',
  )
})

test('escapes LIKE wildcards so they match literally', () => {
  // Without escaping, a lone '%' matches every patient and '_' matches any character.
  assert.equal(
    buildPatientSearchFilter('50%'),
    String.raw`name.ilike."%50\\%%",phone.ilike."%50\\%%"`,
  )
  assert.equal(
    buildPatientSearchFilter('a_b'),
    String.raw`name.ilike."%a\\_b%",phone.ilike."%a\\_b%"`,
  )
})

test('escapes the PostgREST star wildcard', () => {
  // PostgREST rewrites '*' to '%' inside like/ilike patterns, so an unescaped '*' would
  // match every patient. Backslash-escaping it is safe under either behaviour: if PostgREST
  // rewrites, Postgres receives '\%' (a literal percent); if it does not, Postgres receives
  // '\*' (a literal asterisk). Neither is a wildcard.
  assert.equal(
    buildPatientSearchFilter('*'),
    String.raw`name.ilike."%\\*%",phone.ilike."%\\*%"`,
  )
})

test('escapes double quotes and backslashes so the quoted value cannot be broken out of', () => {
  assert.equal(
    buildPatientSearchFilter('a"b'),
    String.raw`name.ilike."%a\"b%",phone.ilike."%a\"b%"`,
  )
  assert.equal(
    buildPatientSearchFilter('a\\b'),
    String.raw`name.ilike."%a\\\\b%",phone.ilike."%a\\\\b%"`,
  )
})

test('caps very long terms so a pasted blob cannot build an unbounded filter', () => {
  const filter = buildPatientSearchFilter('x'.repeat(500))
  assert.ok(filter)
  assert.ok(filter.length < 400, `filter was ${filter.length} chars`)
})
