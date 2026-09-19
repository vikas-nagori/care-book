import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchAllRows } from './fetch-all.ts'

/** Stands in for a PostgREST query: hands back the requested slice of a fixed row set. */
function pagedSource(rows: number[], calls: Array<[number, number]> = []) {
  return async (from: number, to: number) => {
    calls.push([from, to])
    return { data: rows.slice(from, to + 1), error: null }
  }
}

test('returns every row when the result fits in one chunk', async () => {
  const calls: Array<[number, number]> = []
  const result = await fetchAllRows(pagedSource([1, 2, 3], calls), { chunkSize: 10 })

  assert.deepEqual(result.data, [1, 2, 3])
  assert.equal(result.error, null)
  assert.equal(calls.length, 1)
})

test('keeps fetching past the chunk size until a short chunk ends it', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => i)
  const calls: Array<[number, number]> = []

  const result = await fetchAllRows(pagedSource(rows, calls), { chunkSize: 10 })

  assert.deepEqual(result.data, rows)
  assert.deepEqual(calls, [[0, 9], [10, 19], [20, 29]])
})

test('stops after a chunk that exactly empties the table', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => i)
  const calls: Array<[number, number]> = []

  const result = await fetchAllRows(pagedSource(rows, calls), { chunkSize: 10 })

  assert.equal(result.data.length, 20)
  assert.deepEqual(calls, [[0, 9], [10, 19], [20, 29]])
})

test('returns no rows for an empty table', async () => {
  const result = await fetchAllRows(pagedSource([]), { chunkSize: 10 })

  assert.deepEqual(result.data, [])
})

test('surfaces a query error instead of the partial rows it already had', async () => {
  const error = { message: 'boom' }
  let call = 0
  const result = await fetchAllRows(
    async () => {
      call += 1
      if (call === 1) return { data: [1, 2], error: null }
      return { data: null, error }
    },
    { chunkSize: 2 },
  )

  assert.equal(result.error, error)
  assert.deepEqual(result.data, [])
})

test('throws rather than silently truncating when the hard cap is passed', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => i)

  await assert.rejects(
    () => fetchAllRows(pagedSource(rows), { chunkSize: 10, hardCap: 25 }),
    /hard cap/i,
  )
})

test('does not throw when the row count lands exactly on the hard cap', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => i)

  const result = await fetchAllRows(pagedSource(rows), { chunkSize: 10, hardCap: 20 })

  assert.equal(result.data.length, 20)
})
