import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const globalsSource = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return globalsSource.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

test('stat tiles contain responsive values without allowing grid overflow', () => {
  assert.match(rule('.ph-stat'), /min-width:\s*0/)
  assert.match(rule('.ph-stat'), /overflow:\s*hidden/)
  assert.match(rule('.ph-stat-value'), /font-size:\s*clamp\(18px,\s*5\.2vw,\s*26px\)/)
  assert.match(rule('.ph-stat-value'), /white-space:\s*nowrap/)
  assert.match(rule('.ph-stat-value'), /overflow:\s*hidden/)
  assert.match(rule('.ph-stat-value'), /line-height:\s*1\.1/)
})

test('money amounts stay on one line', () => {
  assert.match(rule('.ph-money'), /white-space:\s*nowrap/)
})
