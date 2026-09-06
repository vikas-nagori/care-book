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

// pdfkit encodes standard-14 font text as WinAnsi. A code point above 255 that WinAnsi has no slot
// for (₹ is the one that bit us) is emitted as its raw hex, which a viewer reads as two wrong
// characters — "₹6,000.00" came out as " ¹6,000.00". Guard every literal the PDF puts on the page.
const WIN_ANSI_HIGH_CODE_POINTS = new Set([
  402, 8211, 8212, 8216, 8217, 8218, 8220, 8221, 8222, 8224, 8225, 8226, 8230, 8364, 8240,
  8249, 8250, 710, 8482, 338, 339, 732, 352, 353, 376, 381, 382,
])

function collectStrings(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') found.push(node)
  else if (typeof node === 'number') found.push(String(node))
  else if (Array.isArray(node)) node.forEach((child) => collectStrings(child, found))
  else if (node && typeof node === 'object') {
    const element = node as { type?: unknown; props?: Record<string, unknown> }
    if (typeof element.type === 'function') {
      collectStrings((element.type as (props: unknown) => unknown)(element.props), found)
    }
    if (element.props) collectStrings(element.props.children, found)
  }
  return found
}

describe('PDF text encoding', () => {
  it('emits no character the standard-14 WinAnsi encoding would mangle', () => {
    const unencodable = collectStrings(createPaymentDuePdfElement(statement))
      .flatMap((text) => Array.from(text))
      .filter((character) => {
        const codePoint = character.codePointAt(0)!
        return codePoint > 255 && !WIN_ANSI_HIGH_CODE_POINTS.has(codePoint)
      })

    expect(unencodable).toEqual([])
  })

  it('renders a package-only statement, including a fully prepaid package with nothing due', async () => {
    const buffer = await renderToBuffer(createPaymentDuePdfElement({
      ...statement,
      regular: null,
      packages: [{ ...statement.packages[0], completedPaidPaise: 320000, duePaise: 0 }],
      totalDuePaise: 0,
    }))

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
