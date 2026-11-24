// Guard: every mutation surface in src/ has an entry in e2e/support/mutation-manifest.ts naming
// its happy, minimal-input and failure tests (plan F6). Runs in `npm run test:e2e:support`.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { inventorySource } from './mutation-inventory.ts'
import { testBody } from './test-body.ts'
import {
  MUTATION_MANIFEST,
  MUTATION_MANIFEST_ALLOW_TODO,
  MUTATION_MANIFEST_BLOCKS,
  type Coverage,
  type ManifestEntry,
  type MutationEntry,
  type TestRef,
  type UnusedEntry,
} from './mutation-manifest.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')
const inventory = inventorySource(ROOT)
const isUnused = (entry: ManifestEntry): entry is UnusedEntry => 'unused' in entry
const isRef = (coverage: Coverage): coverage is TestRef => 'spec' in coverage
const covered = MUTATION_MANIFEST.filter((entry): entry is MutationEntry => !isUnused(entry))

test('the manifest lists exactly the mutation surfaces found in src/', () => {
  const discovered = new Map(inventory.surfaces.map((surface) => [surface.id, surface]))
  const declared = MUTATION_MANIFEST.map((entry) => entry.id)
  const duplicates = declared.filter((id, index) => declared.indexOf(id) !== index)
  assert.deepEqual(duplicates, [], 'declared more than once')

  const missing = [...discovered.keys()].filter((id) => !declared.includes(id))
  const stale = declared.filter((id) => !discovered.has(id))
  assert.deepEqual(
    { missing, stale },
    { missing: [], stale: [] },
    'Add an entry to e2e/support/mutation-manifest.ts for each missing surface (in the block of the package that owns it), and remove stale ones.',
  )
  const wrongKind = MUTATION_MANIFEST
    .filter((entry) => discovered.get(entry.id)?.kind !== entry.kind)
    .map((entry) => `${entry.id}: declared ${entry.kind}, found ${discovered.get(entry.id)?.kind}`)
  assert.deepEqual(wrongKind, [])
})

test('unreachable surfaces really are unreachable', () => {
  const problems: string[] = []
  for (const entry of MUTATION_MANIFEST.filter(isUnused)) {
    assert.ok(entry.reason.trim(), `${entry.id} needs a reason`)
    if (entry.kind === 'server-action' && !entry.id.includes('@')) {
      const importers = inventory.importersOf(entry.id)
      if (importers.length > 0) problems.push(`${entry.id} is imported by ${importers.join(', ')}`)
    }
    if (entry.id.includes('@') && !entry.noMatch) problems.push(`${entry.id} is still discovered; give a noMatch pattern proving it is dead`)
    if (entry.noMatch) {
      const pattern = new RegExp(entry.noMatch)
      for (const [file, source] of inventory.sources) {
        if (pattern.test(source)) problems.push(`${entry.id}: ${file} matches ${entry.noMatch}`)
      }
    }
  }
  assert.deepEqual(problems, [])
})

test('every named test exists and does what its slot promises', () => {
  const problems: string[] = []
  const sourceOf = new Map<string, string | null>()
  const read = (spec: string) => {
    if (!sourceOf.has(spec)) {
      const file = path.join(ROOT, spec)
      sourceOf.set(spec, /^e2e\/.+\.spec\.ts$/.test(spec) && existsSync(file) ? readFileSync(file, 'utf8') : null)
    }
    return sourceOf.get(spec)!
  }
  for (const entry of covered) {
    for (const slot of ['happy', 'minimal', 'failure'] as const) {
      const coverage = entry[slot]
      if ('exempt' in coverage) {
        if (!coverage.exempt.trim()) problems.push(`${entry.id} ${slot}: empty exemption`)
        continue
      }
      if (!isRef(coverage)) continue
      const source = read(coverage.spec)
      if (source === null) {
        problems.push(`${entry.id} ${slot}: no spec file ${coverage.spec}`)
        continue
      }
      const body = testBody(source, coverage.title)
      if (body === null) {
        problems.push(`${entry.id} ${slot}: no test titled "${coverage.title}" in ${coverage.spec}`)
        continue
      }
      if (slot === 'minimal' && !body.includes('expectNoLeakedNulls(')) {
        problems.push(`${entry.id} minimal: "${coverage.title}" never calls expectNoLeakedNulls(`)
      }
      const injects = /failNextServerAction\(|failNextSupabaseCall\(/.test(body)
        || (entry.kind === 'fetch' && /\.route\(/.test(body))
      if (slot === 'failure' && !injects) {
        problems.push(`${entry.id} failure: "${coverage.title}" injects no fault (failNextServerAction( / failNextSupabaseCall(${entry.kind === 'fetch' ? ' / page.route(' : ''})`)
      }
    }
  }
  assert.deepEqual(problems, [])
})

test('todo entries are allowed only during Phase 1 and only in the owning package block', () => {
  const problems: string[] = []
  for (const [block, entries] of Object.entries(MUTATION_MANIFEST_BLOCKS)) {
    for (const entry of entries) {
      if (isUnused(entry)) {
        if (block !== 'unused') problems.push(`${entry.id}: unused entries belong in the unused block`)
        continue
      }
      for (const slot of ['happy', 'minimal', 'failure'] as const) {
        const coverage = entry[slot]
        if (!('todo' in coverage)) continue
        if (!MUTATION_MANIFEST_ALLOW_TODO) problems.push(`${entry.id} ${slot}: todo is no longer allowed`)
        if (coverage.todo !== block) problems.push(`${entry.id} ${slot}: todo('${coverage.todo}') sits in the ${block} block`)
      }
    }
  }
  assert.deepEqual(problems, [])
})

test('every client form submits through a declared surface', () => {
  const callSites = new Set(covered.map((entry) => entry.id.split('@')[1]))
  const undeclared = inventory.clientFormFiles.filter((file) => !callSites.has(file))
  assert.deepEqual(undeclared, [], 'these client files render a form but no manifest entry names them as its call site')
})

test('the discoverer is not vacuous', () => {
  // A broken regex or resolver would otherwise make every check above pass on an empty list.
  assert.ok(inventory.actionExports.length >= 50, `found only ${inventory.actionExports.length} server action exports`)
  assert.ok(inventory.callServerActionSites >= 40, `found only ${inventory.callServerActionSites} callServerAction call sites`)
  for (const kind of ['server-action', 'form-action', 'supabase', 'fetch'] as const) {
    assert.ok(inventory.surfaces.some((surface) => surface.kind === kind), `no ${kind} surface found`)
  }
  assert.ok(testBody("test('a', () => { one })\ntest('b', () => { two })", 'a')?.includes('one'))
  assert.equal(testBody("test('a', () => { one })\ntest('b', () => { two })", 'a')?.includes('two'), false)
})

test('testBody reads the whole callback, past test.* calls inside it', () => {
  const spec = [
    "test('times out late', async ({ page }) => {",
    '  test.setTimeout(90_000)',
    "  test.skip(isMobile, 'desktop only')",
    "  test.fail(true, 'G-1: known bug')",
    "  await test.step('arrange', async () => { await arrange() })",
    '  const fault = await failNextServerAction(page, \'abort\')',
    '  await expectNoLeakedNulls(page)',
    '})',
    '',
    "test('next', async () => { failNextSupabaseCall(other) })",
  ].join('\n')
  const body = testBody(spec, 'times out late')
  assert.ok(body?.startsWith('async ({ page }) => {'), body ?? 'null')
  assert.ok(body?.includes('failNextServerAction('))
  assert.ok(body?.includes('expectNoLeakedNulls('))
  assert.equal(body?.includes('failNextSupabaseCall('), false, 'the next test leaked into the body')
})

test('testBody ignores braces in strings, templates, regexes and comments', () => {
  const spec = [
    "test('tricky', async ({ page }) => {",
    "  const a = '}' + \"}\" + `}${'{'}`",
    '  const b = /\\}+/',
    '  // }',
    '  /* } */',
    '  await failNextServerAction(page, \'abort\')',
    '})',
    "test('after', () => { expectNoLeakedNulls(page) })",
  ].join('\n')
  const body = testBody(spec, 'tricky')
  assert.ok(body?.includes('failNextServerAction('))
  assert.equal(body?.includes('expectNoLeakedNulls('), false)
})

test('testBody finds tests declared with a modifier, nested in describe, and escaped titles', () => {
  const spec = [
    "test.describe('group', () => {",
    "  test.fail('pinned bug', async () => { pinned() })",
    "  test.skip(\"it's skipped\", async () => { skipped() })",
    '  test.only(`templated`, async () => { templated() })',
    "  test('it\\'s escaped', function () { escaped() })",
    '})',
  ].join('\n')
  assert.ok(testBody(spec, 'pinned bug')?.includes('pinned()'))
  assert.ok(testBody(spec, "it's skipped")?.includes('skipped()'))
  assert.ok(testBody(spec, 'templated')?.includes('templated()'))
  assert.ok(testBody(spec, "it's escaped")?.includes('escaped()'))
  assert.equal(testBody(spec, 'group'), null, 'a describe title is not a test')
  assert.equal(testBody(spec, 'missing'), null)
  // A title that only appears in a string or comment is not a declaration.
  assert.equal(testBody("const t = 'ghost'\n// test('ghost', () => {})", 'ghost'), null)
})
