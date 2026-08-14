import test from 'node:test'
import assert from 'node:assert/strict'
import { buildV2PaymentBalanceRows } from './v2-balances.ts'

test('separates ordinary and package due and credit', () => {
  const rows = buildV2PaymentBalanceRows({
    patients: [{ id: 'p1', name: 'Smita' }],
    patientBalances: [{ patient_id: 'p1', quote_amount: 6500, net_received: 6000, applied_amount: 5900, due_amount: 600, refundable_credit: 100 }],
    packageBalances: [{ patient_id: 'p1', due_amount: 500, refundable_credit: 0 }],
  })

  assert.deepEqual(rows[0], {
    patientId: 'p1', patientName: 'Smita', ordinaryDue: 100, ordinaryCredit: 100,
    packageDue: 500, packageCredit: 0, totalDue: 600, totalCredit: 100,
    direction: 'due',
  })
})

test('does not let ordinary credit cover package due', () => {
  const [row] = buildV2PaymentBalanceRows({
    patients: [{ id: 'p1', name: 'Nayana' }],
    patientBalances: [{ patient_id: 'p1', quote_amount: 3200, net_received: 4000, applied_amount: 2700, due_amount: 500, refundable_credit: 1300 }],
    packageBalances: [{ patient_id: 'p1', due_amount: 500, refundable_credit: 0 }],
  })
  assert.equal(row.totalDue, 500)
  assert.equal(row.totalCredit, 1300)
})
