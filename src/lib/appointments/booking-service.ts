import { createHash } from 'node:crypto'
import { buildAppointmentInsertRows } from './appointment-creation.ts'
import { MAX_RECURRING_APPOINTMENTS } from './recurrence.ts'
import type { BookingRequest, CreateAppointmentResult, NewPatientInput } from './booking-contract.ts'

export type BookingRow = ReturnType<typeof buildAppointmentInsertRows>[number] & {
  id: string
  clinic_id: string
  created_by: string
}
export type PatientRow = NewPatientInput & { id: string; clinic_id: string }
type DatabaseError = { code?: string; message?: string }
type DatabaseResult<T> = { data: T | null; error: DatabaseError | null }
export type BookingStore = {
  getAppointmentType(id: string): Promise<DatabaseResult<{ is_shared: boolean; session_rate: number }>>
  findAppointments(ids: string[]): Promise<DatabaseResult<BookingRow[]>>
  getPatient(id: string): Promise<DatabaseResult<PatientRow>>
  insertPatient(row: PatientRow): Promise<DatabaseResult<{ id: string }>>
  findConflicts(patientId: string, time: string, dates: string[]): Promise<DatabaseResult<{ id: string; date: string }[]>>
  insertAppointments(rows: BookingRow[]): Promise<DatabaseResult<{ id: string }[]>>
}
export type BookingStage = 'validation' | 'reconciliation' | 'patient' | 'conflict_check' | 'insert' | 'complete'
export type BookingContext = {
  actorId: string
  clinicId: string
  role: 'admin' | 'staff'
  today: string
  store: BookingStore
  log?: (phase: BookingStage, errorCode?: string) => void
}

function deterministicId(scope: string, purpose: string): string {
  const bytes = createHash('sha256').update(`care-book/booking/v1/${scope}/${purpose}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function deriveBookingIds(actorId: string, clinicId: string, correlationId: string) {
  const scope = `${actorId.toLowerCase()}/${clinicId.toLowerCase()}/${correlationId.toLowerCase()}`
  return {
    patientId: deterministicId(scope, 'patient'),
    appointmentIds: Array.from({ length: MAX_RECURRING_APPOINTMENTS }, (_, index) => deterministicId(scope, `appointment/${index}`)),
  }
}
function failed(errorCode: string, message: string, createdPatientId?: string): CreateAppointmentResult {
  return { success: false, errorCode, message, ...(createdPatientId ? { createdPatientId } : {}) }
}
function mismatch(createdPatientId?: string) {
  return failed('BOOKING_INTENT_MISMATCH', 'This booking reference does not match the saved appointment. Check the schedule before starting another booking.', createdPatientId)
}
function unconfirmed(createdPatientId?: string) {
  return failed('BOOKING_UNCONFIRMED', 'We could not confirm whether this appointment saved. Check its status before retrying.', createdPatientId)
}
export function bookingDatabaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof error.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code) ? error.code : undefined
}
function statementRejected(error: DatabaseError) {
  // Only server-side validation, integrity and permission errors prove the statement was rejected.
  // Connection/transaction-resolution/proxy errors can arrive after a commit.
  return typeof error.code === 'string' && /^(?:22|23|42)[0-9A-Z]{3}$/.test(error.code)
}
function matchingPatient(actual: PatientRow, expected: PatientRow): boolean {
  return Object.entries(expected).every(([key, value]) => actual[key as keyof PatientRow] === value)
}
function matchingAppointment(actual: BookingRow, expected: BookingRow): boolean {
  // Status/payment fields can change after creation and are not part of the submitted intent.
  return actual.id === expected.id && actual.clinic_id === expected.clinic_id && actual.created_by === expected.created_by &&
    actual.patient_id === expected.patient_id && actual.date === expected.date && actual.time.slice(0, 5) === expected.time &&
    actual.duration_minutes === expected.duration_minutes && actual.appointment_type_id === expected.appointment_type_id &&
    actual.fee === expected.fee && actual.assigned_to === expected.assigned_to &&
    actual.external_staff_id === expected.external_staff_id && actual.notes === expected.notes
}

/** One attempt owns deterministic primary keys. No upsert/update is ever used during replay. */
export async function executeBooking(request: BookingRequest, mode: 'create' | 'status', context: BookingContext): Promise<CreateAppointmentResult> {
  const { input } = request
  const { store } = context
  const ids = deriveBookingIds(context.actorId, context.clinicId, request.correlationId)
  const patientId = input.newPatient ? ids.patientId : input.patientId
  let createdPatientId: string | undefined
  const log = (phase: BookingStage, error?: unknown) => context.log?.(phase, bookingDatabaseErrorCode(error))
  try {
    if (!patientId) return failed('SCHEDULE_MISSING_PATIENT', 'Select or create a patient.')
    const typeResult = await store.getAppointmentType(input.appointmentTypeId)
    log('validation', typeResult.error)
    if (typeResult.error || !typeResult.data) return failed('APPOINTMENT_CREATE_FAILED', 'Unable to load the appointment type.')
    const appointmentType = typeResult.data
    let rows: BookingRow[]
    try {
      rows = buildAppointmentInsertRows({ ...input, patientId, today: context.today }).map((row, index) => ({
        ...row, id: ids.appointmentIds[index], clinic_id: context.clinicId, created_by: context.actorId,
        fee: context.role === 'staff' ? Number(appointmentType.session_rate) : row.fee,
        assigned_to: appointmentType.is_shared ? null : row.assigned_to,
        external_staff_id: appointmentType.is_shared ? null : row.external_staff_id,
      }))
    } catch {
      return failed('SCHEDULE_INVALID_RECURRENCE', 'The repeat schedule is invalid.')
    }
    const patientRow = input.newPatient ? { ...input.newPatient, id: patientId, clinic_id: context.clinicId } : null
    async function reconcile(): Promise<CreateAppointmentResult | null> {
      const existing = await store.findAppointments(ids.appointmentIds)
      log('reconciliation', existing.error)
      if (existing.error || !existing.data) return unconfirmed(createdPatientId)
      if (existing.data.length === 0) return null
      if (existing.data.length !== rows.length) return mismatch(createdPatientId)
      const saved = new Map(existing.data.map(row => [row.id, row]))
      if (!rows.every(row => saved.has(row.id) && matchingAppointment(saved.get(row.id)!, row))) return mismatch(createdPatientId)
      if (patientRow) {
        const patient = await store.getPatient(patientId!)
        if (patient.error) return unconfirmed(createdPatientId)
        if (!patient.data || !matchingPatient(patient.data, patientRow)) return mismatch()
        createdPatientId = patientId
      }
      return { success: true, appointmentIds: rows.map(row => row.id), ...(createdPatientId ? { createdPatientId } : {}) }
    }
    const existing = await reconcile()
    if (existing) { log('complete'); return existing }
    if (patientRow) {
      const patient = await store.getPatient(patientId)
      log('patient', patient.error)
      if (patient.error) return unconfirmed()
      if (patient.data) {
        if (!matchingPatient(patient.data, patientRow)) return mismatch()
        createdPatientId = patientId
      } else if (mode === 'create') {
        const inserted = await store.insertPatient(patientRow)
        log('patient', inserted.error)
        if (inserted.error?.code === '23505') {
          const concurrent = await store.getPatient(patientId)
          if (concurrent.error || !concurrent.data) return unconfirmed()
          if (!matchingPatient(concurrent.data, patientRow)) return mismatch()
        } else if (inserted.error || !inserted.data) {
          return inserted.error && statementRejected(inserted.error)
            ? failed('PATIENT_CREATE_FAILED', 'Unable to create the patient. Check the details and try again.')
            : unconfirmed()
        }
        createdPatientId = patientId
      }
    }
    if (mode === 'status') return failed('BOOKING_NOT_FOUND', 'This booking has not been confirmed. You can safely retry the same booking.', createdPatientId)
    const conflicts = await store.findConflicts(patientId, input.time, rows.map(row => row.date))
    log('conflict_check', conflicts.error)
    if (conflicts.error || !conflicts.data) return failed('APPOINTMENT_CREATE_FAILED', 'Unable to check the appointment schedule.', createdPatientId)
    // A concurrent replay may already have inserted this attempt; its own rows are reconciled by PK below.
    const ownIds = new Set(ids.appointmentIds)
    const conflictingDates = [...new Set(conflicts.data.filter(row => !ownIds.has(row.id)).map(row => row.date))].sort()
    if (conflictingDates.length) return { success: false, errorCode: 'APPOINTMENT_CONFLICT', message: 'This patient already has an appointment at the selected time on one or more dates.', conflictingDates, ...(createdPatientId ? { createdPatientId } : {}) }
    // One multi-row statement keeps each recurrence atomic. Concurrent retries race only on stable primary keys.
    const inserted = await store.insertAppointments(rows)
    log('insert', inserted.error)
    if (inserted.error?.code === '23505') return await reconcile() ?? unconfirmed(createdPatientId)
    if (inserted.error || !inserted.data || inserted.data.length !== rows.length) {
      return inserted.error && statementRejected(inserted.error)
        ? failed('APPOINTMENT_CREATE_FAILED', 'Unable to create the appointment. Check the details and try again.', createdPatientId)
        : unconfirmed(createdPatientId)
    }
    log('complete')
    return { success: true, appointmentIds: rows.map(row => row.id), ...(createdPatientId ? { createdPatientId } : {}) }
  } catch (error) {
    log('complete', error)
    return unconfirmed(createdPatientId)
  }
}
