import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { normalizeUserDeletionReason } from './user-lifecycle.ts'

test('soft deletion requires a non-empty audit reason and normalizes whitespace', () => {
  assert.equal(normalizeUserDeletionReason('  left the clinic  '), 'left the clinic')
  assert.equal(normalizeUserDeletionReason('   '), null)
  assert.equal(normalizeUserDeletionReason(undefined), null)
})

test('production source never hard-deletes Supabase auth users', () => {
  const srcRoot = join(import.meta.dirname, '..', '..')
  const sourceFiles: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
        sourceFiles.push(path)
      }
    }
  }
  visit(srcRoot)

  const forbiddenCall = ['delete', 'User'].join('')
  for (const path of sourceFiles) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), new RegExp(`\\b${forbiddenCall}\\s*\\(`), path)
  }
})

test('operational profile selectors explicitly exclude blocked and deleted users', () => {
  const srcRoot = join(import.meta.dirname, '..', '..')
  for (const relativePath of [
    'lib/dashboard/appointment-options.ts',
    'app/schedule/page.tsx',
    'app/schedule/new/page.tsx',
    'app/schedule/[id]/page.tsx',
    'app/settings/page.tsx',
  ]) {
    const source = readFileSync(join(srcRoot, relativePath), 'utf8')
    assert.match(source, /from\('profiles'\)[\s\S]{0,180}\.eq\('status', 'active'\)/, relativePath)
  }
})
