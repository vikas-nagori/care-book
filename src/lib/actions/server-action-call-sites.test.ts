// Guard: every server action a client component calls must go through callServerAction.
//
// Incident 2026-11-24: a Settings form awaited its server action with no catch; the call
// rejected (a phone running the previous build) and the button sat on "Creating login…"
// forever with no message. callServerAction turns any rejection into the actions' own
// `{ success: false, message }` result, so the caller's failure branch resets the button and
// shows a clear error. This test fails if a new call bypasses it.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const SRC = path.join(ROOT, 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full)
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [full] : []
  })
}

const DIRECTIVE = (kind: 'client' | 'server') => new RegExp(`^\\s*['"]use ${kind}['"]`)
const files = walk(SRC)
const serverActionModules = new Set(
  files.filter((file) => DIRECTIVE('server').test(readFileSync(file, 'utf8'))).map((file) => file.replace(/\.(ts|tsx)$/, '')),
)

function resolveImport(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return path.join(SRC, specifier.slice(2))
  if (specifier.startsWith('.')) return path.resolve(path.dirname(fromFile), specifier)
  return null
}

/** Local names bound to server actions by this file's imports. */
function importedServerActions(file: string, source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const resolved = resolveImport(file, match[2])
    if (!resolved || !serverActionModules.has(resolved.replace(/\.(ts|tsx)$/, ''))) continue
    for (const part of match[1].split(',')) {
      const spec = part.trim()
      if (!spec || spec.startsWith('type ')) continue
      const alias = spec.split(/\s+as\s+/)
      names.push((alias[1] ?? alias[0]).trim())
    }
  }
  return names
}

/** Calls of `name(` that are not the direct body of `callServerAction(() => name(`. */
function unguardedCalls(source: string, name: string): number[] {
  const lines: number[] = []
  for (const match of source.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'g'))) {
    const before = source.slice(Math.max(0, match.index - 40), match.index)
    if (/callServerAction\(\s*\(\)\s*=>\s*$/.test(before)) continue
    // A declaration or a type position, not a call.
    if (/(function|const|let|var)\s+$/.test(before)) continue
    lines.push(source.slice(0, match.index).split('\n').length)
  }
  return lines
}

test('client components call server actions only through callServerAction', () => {
  const offenders: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (!DIRECTIVE('client').test(source)) continue
    for (const name of importedServerActions(file, source)) {
      for (const line of unguardedCalls(source, name)) {
        offenders.push(`${path.relative(ROOT, file)}:${line} ${name}(…)`)
      }
    }
  }
  assert.deepEqual(offenders, [], `Wrap these in callServerAction(() => …) from @/lib/actions/call-server-action:\n${offenders.join('\n')}`)
})

test('the guard actually finds server action modules and client importers', () => {
  // Without this, a broken resolver would make the test above pass vacuously.
  assert.ok(serverActionModules.size >= 10, `found only ${serverActionModules.size} 'use server' modules`)
  const importers = files.filter((file) => {
    const source = readFileSync(file, 'utf8')
    return DIRECTIVE('client').test(source) && importedServerActions(file, source).length > 0
  })
  assert.ok(importers.length >= 20, `found only ${importers.length} client files importing server actions`)
})
