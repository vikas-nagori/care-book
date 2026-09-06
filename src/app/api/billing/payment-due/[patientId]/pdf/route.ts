import { renderToBuffer } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { CLINIC_TIME_ZONE } from '@/lib/timezone'
import { buildPaymentDueStatement, getPreviousMonthPeriod, type PaymentDueRegularScope } from '@/lib/billing/payment-due-statement'
import { getPaymentDueStatementSource, PaymentDueStatementSourceError } from '@/lib/billing/payment-due-statement.server'
import { PaymentDuePdf } from '@/lib/billing/payment-due-pdf'

export const runtime = 'nodejs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PERIOD_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function jsonError(status: number, errorCode: string, message: string) {
  return NextResponse.json({ errorCode, message }, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

function sanitizeFilename(patientName: string, generatedAt: Date, regularScope: PaymentDueRegularScope, periodMonth?: string) {
  const safeName = patientName
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'patient'
  const date = generatedAt.toISOString().slice(0, 10)
  const period = regularScope === 'previous_month' ? `-regular-${periodMonth}` : '-all-regular'
  return `payment-summary-${safeName}-${date}${period}.pdf`
}

async function readRequest(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new Error('invalid_request')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_request')
  const input = body as Record<string, unknown>
  const regularScope = input.regularScope
  const periodMonth = input.periodMonth
  if (regularScope !== 'all_due' && regularScope !== 'previous_month') throw new Error('invalid_request')
  if (regularScope === 'previous_month' && (typeof periodMonth !== 'string' || !PERIOD_MONTH_PATTERN.test(periodMonth))) throw new Error('invalid_request')
  if (regularScope === 'all_due' && periodMonth !== undefined) throw new Error('invalid_request')
  return { regularScope: regularScope as PaymentDueRegularScope, periodMonth: periodMonth as string | undefined }
}

export async function POST(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params
  if (!UUID_PATTERN.test(patientId)) return jsonError(400, 'INVALID_REQUEST', 'Invalid payment PDF request.')

  let input: Awaited<ReturnType<typeof readRequest>>
  try {
    input = await readRequest(request)
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid payment PDF request.')
  }

  const generatedAt = new Date()
  if (input.regularScope === 'previous_month') {
    const expected = getPreviousMonthPeriod(generatedAt, CLINIC_TIME_ZONE)
    if (input.periodMonth !== expected.periodMonth) {
      return jsonError(400, 'PERIOD_CHANGED', 'The previous-month period has changed. Refresh and try again.')
    }
  }

  const profile = await getCurrentProfile()
  if (!profile) return jsonError(401, 'UNAUTHORIZED', 'You need to sign in again.')
  if (profile.role !== 'admin') return jsonError(403, 'FORBIDDEN', 'You are not allowed to generate payment PDFs.')

  try {
    const source = await getPaymentDueStatementSource(patientId)
    if (!source) return jsonError(404, 'NOT_FOUND', 'Patient not found.')
    const statement = buildPaymentDueStatement(source, {
      regularScope: input.regularScope,
      periodMonth: input.periodMonth,
      generatedAt,
      timeZone: CLINIC_TIME_ZONE,
    })
    if (statement.isEmpty) return jsonError(422, 'NO_PENDING_PAYMENT', 'No payment pending for the selected regular-session period or completed package sessions.')
    const buffer = await renderToBuffer(createElement(PaymentDuePdf, { statement }) as unknown as ReactElement<DocumentProps>)
    const filename = sanitizeFilename(statement.patientName, generatedAt, input.regularScope, input.periodMonth)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof PaymentDueStatementSourceError) {
      logger.error('billing/paymentDueStatement/sourceInvalid', error, { patientId })
      return jsonError(500, 'STATEMENT_UNAVAILABLE', 'Could not generate the payment PDF. Please try again.')
    }
    logger.error('billing/paymentDueStatement/render', error, { patientId })
    return jsonError(500, 'STATEMENT_UNAVAILABLE', 'Could not generate the payment PDF. Please try again.')
  }
}
