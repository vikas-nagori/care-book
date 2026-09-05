import assert from 'node:assert/strict'
import test from 'node:test'
import { sortReminders } from './ordering.ts'

test('orders pending then completed, by time with untimed first, using stable creation/id ties', () => {
  const rows = [
    {id:'c',status:'completed' as const,time:'08:00',created_at:'2026-01-01'},
    {id:'b',status:'pending' as const,time:null,created_at:'2026-01-01'},
    {id:'z',status:'pending' as const,time:'09:00',created_at:'2026-01-01'},
    {id:'a',status:'pending' as const,time:'09:00',created_at:'2026-01-01'},
    {id:'x',status:'pending' as const,time:'09:00',created_at:'2026-01-02'},
  ]
  assert.deepEqual(sortReminders(rows).map(row => row.id), ['b','a','z','x','c'])
  assert.equal(rows[0].id,'c')
})
