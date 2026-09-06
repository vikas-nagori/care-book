import { describe, expect, it } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'

import { createPaymentDuePdfElement, PaymentDuePdf } from './payment-due-pdf'
import type { PaymentDueStatement } from './payment-due-statement'

const statement: PaymentDueStatement = {
  snapshotAt: '2026-09-06T04:30:00.000Z',
  generatedAt: '2026-09-06T04:30:00.000Z',
  clinicName: 'Sample Clinic',
  patientId: 'patient-1',
  patientName: 'Nayana Pai',
  regular: {
    periodLabel: 'August 2026 · completed regular sessions with payment pending',
    rows: [{ id: 'session-1', date: '2026-08-01', time: '09:00:00', type: 'Clinic', feePaise: 80000, paidPaise: 30000, duePaise: 50000 }],
    totalFeePaise: 80000,
    totalPaidPaise: 30000,
    totalDuePaise: 50000,
  },
  packages: [{
    id: 'package-1',
    name: 'Physiotherapy package',
    quoteAmountPaise: 800000,
    paidIntoPackagePaise: 240000,
    totalSessions: 10,
    sessionsLeft: 6,
    completedSessions: [{ id: 'package-session-1', date: '2026-07-20', time: '11:00:00', type: 'Clinic' }],
    completedChargePaise: 320000,
    completedPaidPaise: 240000,
    duePaise: 80000,
  }],
  totalDuePaise: 130000,
  isEmpty: false,
}

describe('PaymentDuePdf', () => {
  it('renders a non-empty text PDF for a combined statement', async () => {
    const buffer = await renderToBuffer(<PaymentDuePdf statement={statement} />)

    expect(buffer.byteLength).toBeGreaterThan(500)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders the classic element tree used by the server route', async () => {
    const buffer = await renderToBuffer(createPaymentDuePdfElement(statement))

    expect(buffer.byteLength).toBeGreaterThan(500)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
