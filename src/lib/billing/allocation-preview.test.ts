import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAllocationPreview, type OutstandingCharge } from './allocation-preview.ts'

function charge(overrides: Partial<OutstandingCharge> & { appointmentId: string; date: string }): OutstandingCharge {
  return {
    time: '10:00:00',
    type: 'Clinic',
    chargeAmount: 650,
    remainingAmount: 650,
    ...overrides,
  }
}

test('leaves the whole amount as credit when nothing is outstanding', () => {
  const preview = buildAllocationPreview({ charges: [], amount: 1000 })

  assert.deepEqual(preview.lines, [])
  assert.equal(preview.appliedTotal, 0)
  assert.equal(preview.creditLeft, 1000)
})

test('settles whole sessions oldest-first', () => {
  const preview = buildAllocationPreview({
    charges: [
      charge({ appointmentId: 'b', date: '2026-08-05' }),
      charge({ appointmentId: 'a', date: '2026-07-22' }),
    ],
    amount: 1300,
  })

  assert.deepEqual(preview.lines.map((line) => line.appointmentId), ['a', 'b'])
  assert.ok(preview.lines.every((line) => !line.isPartial))
  assert.equal(preview.appliedTotal, 1300)
  assert.equal(preview.creditLeft, 0)
})

test('covers the last session partially, as the ledger does', () => {
  // The v2 reconciler draws least(remaining_payment, remaining_charge) — it does not skip a
  // session it cannot cover in full, which is what the old preview helper did.
  const preview = buildAllocationPreview({
    charges: [
      charge({ appointmentId: 'a', date: '2026-07-22' }),
      charge({ appointmentId: 'b', date: '2026-08-05' }),
    ],
    amount: 850,
  })

  assert.equal(preview.lines.length, 2)
  assert.deepEqual(
    preview.lines.map((line) => [line.appointmentId, line.appliedAmount, line.isPartial]),
    [['a', 650, false], ['b', 200, true]],
  )
  assert.equal(preview.appliedTotal, 850)
  assert.equal(preview.creditLeft, 0)
})

test('orders by date, then time, then id — matching the reconciler', () => {
  const preview = buildAllocationPreview({
    charges: [
      charge({ appointmentId: 'z', date: '2026-08-05', time: '09:00:00' }),
      charge({ appointmentId: 'a', date: '2026-08-05', time: '15:00:00' }),
      charge({ appointmentId: 'b', date: '2026-08-05', time: '09:00:00' }),
    ],
    amount: 5000,
  })

  assert.deepEqual(preview.lines.map((line) => line.appointmentId), ['b', 'z', 'a'])
})

test('leaves the surplus as credit once every session is covered', () => {
  const preview = buildAllocationPreview({
    charges: [charge({ appointmentId: 'a', date: '2026-07-22' })],
    amount: 2000,
  })

  assert.equal(preview.appliedTotal, 650)
  assert.equal(preview.creditLeft, 1350)
})

test('honours a partly-settled session by drawing only its remainder', () => {
  const preview = buildAllocationPreview({
    charges: [charge({ appointmentId: 'a', date: '2026-07-22', chargeAmount: 650, remainingAmount: 150 })],
    amount: 400,
  })

  assert.deepEqual(
    preview.lines.map((line) => [line.appliedAmount, line.chargeAmount, line.isPartial]),
    [[150, 650, false]],
  )
  assert.equal(preview.creditLeft, 250)
})

test('skips fully-settled and zero-value charges', () => {
  const preview = buildAllocationPreview({
    charges: [
      charge({ appointmentId: 'settled', date: '2026-07-01', remainingAmount: 0 }),
      charge({ appointmentId: 'free', date: '2026-07-02', chargeAmount: 0, remainingAmount: 0 }),
      charge({ appointmentId: 'due', date: '2026-07-03' }),
    ],
    amount: 650,
  })

  assert.deepEqual(preview.lines.map((line) => line.appointmentId), ['due'])
})

test('treats a missing or non-positive amount as nothing to allocate', () => {
  for (const amount of [0, -100, Number.NaN]) {
    const preview = buildAllocationPreview({
      charges: [charge({ appointmentId: 'a', date: '2026-07-22' })],
      amount,
    })
    assert.deepEqual(preview.lines, [], `amount ${amount}`)
    assert.equal(preview.creditLeft, 0, `amount ${amount}`)
  }
})

test('keeps paise arithmetic exact', () => {
  const preview = buildAllocationPreview({
    charges: [
      charge({ appointmentId: 'a', date: '2026-07-22', chargeAmount: 0.1, remainingAmount: 0.1 }),
      charge({ appointmentId: 'b', date: '2026-07-23', chargeAmount: 0.2, remainingAmount: 0.2 }),
    ],
    amount: 0.3,
  })

  assert.equal(preview.appliedTotal, 0.3)
  assert.equal(preview.creditLeft, 0)
})
