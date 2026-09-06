import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import type {
  PaymentDueAppointmentSource,
  PaymentDueApplicationSource,
  PaymentDuePackageSource,
  PaymentDueStatementSource,
} from './payment-due-statement'

export class PaymentDueStatementSourceError extends Error {
  constructor(message = 'Unable to load the payment statement source.') {
    super(message)
    this.name = 'PaymentDueStatementSourceError'
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PaymentDueStatementSourceError(`Invalid ${label}.`)
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string, nullable = false): string | null {
  if (value == null && nullable) return null
  if (typeof value !== 'string' || value.trim() === '') throw new PaymentDueStatementSourceError(`Invalid ${label}.`)
  return value
}

function application(value: unknown): PaymentDueApplicationSource {
  const row = record(value, 'payment application')
  const status = stringValue(row.status, 'payment application status')
  if (status !== 'active' && status !== 'reversed') throw new PaymentDueStatementSourceError('Invalid payment application status.')
  return { amount: stringValue(row.amount, 'payment application amount')!, status }
}

function appointment(value: unknown): PaymentDueAppointmentSource {
  const row = record(value, 'appointment')
  const status = stringValue(row.status, 'appointment status')
  const chargeStatus = stringValue(row.chargeStatus, 'charge status', true)
  const packageLifecycle = stringValue(row.packageLifecycle, 'package lifecycle', true)
  if (!['scheduled', 'completed', 'cancelled'].includes(status!)) throw new PaymentDueStatementSourceError('Invalid appointment status.')
  if (chargeStatus !== null && !['pending', 'posted', 'voided'].includes(chargeStatus)) throw new PaymentDueStatementSourceError('Invalid charge status.')
  if (packageLifecycle !== null && !['scheduled', 'availed', 'released'].includes(packageLifecycle)) throw new PaymentDueStatementSourceError('Invalid package lifecycle.')
  if (!Array.isArray(row.applications)) throw new PaymentDueStatementSourceError('Invalid payment applications.')
  const applications = row.applications.map(application)
  const chargeId = stringValue(row.chargeId, 'charge id', true)
  const chargeAmount = stringValue(row.chargeAmount, 'charge amount', true)
  if (chargeId && chargeAmount === null) throw new PaymentDueStatementSourceError('Missing amount for a completed charge.')
  return {
    id: stringValue(row.id, 'appointment id')!,
    date: stringValue(row.date, 'appointment date')!,
    time: stringValue(row.time, 'appointment time', true),
    type: stringValue(row.type, 'appointment type', true),
    status: status as PaymentDueAppointmentSource['status'],
    chargeId,
    chargeAmount: chargeAmount ?? '0.00',
    chargeStatus: (chargeStatus ?? 'voided') as PaymentDueAppointmentSource['chargeStatus'],
    packageId: stringValue(row.packageId, 'package id', true),
    packageLifecycle: packageLifecycle as PaymentDueAppointmentSource['packageLifecycle'],
    applications,
  }
}

function packageSource(value: unknown): PaymentDuePackageSource {
  const row = record(value, 'package')
  const totalSessions = Number(row.totalSessions)
  if (!Number.isInteger(totalSessions) || totalSessions < 0) throw new PaymentDueStatementSourceError('Invalid package session count.')
  return {
    id: stringValue(row.id, 'package id')!,
    name: stringValue(row.name, 'package name')!,
    createdAt: stringValue(row.createdAt, 'package creation time')!,
    quoteAmount: stringValue(row.quoteAmount, 'package quote')!,
    netReceived: stringValue(row.netReceived, 'package receipts')!,
    totalSessions,
  }
}

export async function getPaymentDueStatementSource(patientId: string): Promise<PaymentDueStatementSource | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_payment_due_statement_source_v1', { p_patient_id: patientId })
  if (error) {
    logger.error('billing/paymentDueStatement/source', error, { patientId })
    throw new PaymentDueStatementSourceError()
  }
  if (data == null) return null

  try {
    const root = record(data, 'statement source')
    const clinic = record(root.clinic, 'clinic')
    const patient = record(root.patient, 'patient')
    const snapshotAt = stringValue(root.snapshotAt, 'snapshot timestamp')!
    if (!Array.isArray(root.appointments) || !Array.isArray(root.packages)) {
      throw new PaymentDueStatementSourceError('Invalid statement collections.')
    }
    const appointments = root.appointments.map(appointment)
    const packages = root.packages.map(packageSource)
    return {
      snapshotAt,
      clinic: { name: stringValue(clinic.name, 'clinic name')! },
      patient: {
        id: stringValue(patient.id, 'patient id')!,
        name: stringValue(patient.name, 'patient name')!,
      },
      appointments,
      packages,
    }
  } catch (error) {
    if (error instanceof PaymentDueStatementSourceError) throw error
    logger.error('billing/paymentDueStatement/decode', error, { patientId })
    throw new PaymentDueStatementSourceError()
  }
}
