import assert from 'node:assert/strict'
import test from 'node:test'
import { collectLogPages } from './log-pages.ts'
const iso = (n: number) => new Date(n).toISOString()
test('overlapping boundary pages are deduplicated without dropping same-time records', async () => {
  const pages = [
    [{ id: 'a', timestamp: 90 }, { id: 'b', timestamp: 80 }],
    [{ id: 'b', timestamp: 80 }, { id: 'c', timestamp: 70 }],
    [{ id: 'c', timestamp: 70 }],
  ]
  const cursors: string[] = []
  const result = await collectLogPages(async until => { cursors.push(until); return pages.shift()! }, iso(0), iso(100), 2)
  assert.deepEqual(result.map(row => row.id), ['a', 'b', 'c'])
  assert.deepEqual(cursors, [iso(100), iso(80), iso(70)])
})
test('a repeated first page fails instead of inflating incident counts', async () => {
  await assert.rejects(collectLogPages(async () => [{ id: 'a', timestamp: 90 }, { id: 'b', timestamp: 80 }], iso(0), iso(100), 2), /non-paginated/)
})
test('a saturated timestamp boundary or page budget cannot masquerade as complete', async () => {
  await assert.rejects(collectLogPages(async () => [{ id: 'a', timestamp: 90 }, { id: 'b', timestamp: 90 }], iso(0), iso(100), 2), /stalled/)
  await assert.rejects(collectLogPages(async () => [{ id: 'a', timestamp: 90 }], iso(0), iso(100), 1, 1), /incomplete/)
})
