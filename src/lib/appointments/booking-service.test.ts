import assert from 'node:assert/strict'
import test from 'node:test'
import { executeBooking, type BookingStore, type BookingRow, type PatientRow } from './booking-service.ts'
import type { BookingRequest } from './booking-contract.ts'

const actor = { actorId: '33333333-3333-4333-8333-333333333333', clinicId: '44444444-4444-4444-8444-444444444444', role: 'admin' as 'admin' | 'staff', today: '2026-10-17' }
const request = (correlationId = '12345678-1234-4234-8234-123456789012'): BookingRequest => ({ correlationId, input: {
  patientId: '11111111-1111-4111-8111-111111111111', date: '2026-10-17', time: '15:00', durationMinutes: 45,
  appointmentTypeId: '22222222-2222-4222-8222-222222222222', fee: 500, notes: null,
} })

function memoryStore() {
  const appointments = new Map<string, BookingRow>()
  const patients = new Map<string, PatientRow>()
  let writes = 0
  let loseResponse = false
  let insertError: string | null = null
  const store: BookingStore = {
    async getAppointmentType() { return { data: { is_shared: true, session_rate: 700 }, error: null } },
    async findAppointments(ids) { return { data: [...appointments.values()].filter(row => ids.includes(row.id)), error: null } },
    async getPatient(id) { return { data: patients.get(id) ?? null, error: null } },
    async insertPatient(row) {
      writes++
      if (patients.has(row.id)) return { data: null, error: { code: '23505' } }
      patients.set(row.id, { ...row })
      return { data: row, error: null }
    },
    async findConflicts(patientId, time, dates) {
      return { data: [...appointments.values()].filter(row => row.patient_id === patientId && row.time === time && dates.includes(row.date)), error: null }
    },
    async insertAppointments(rows) {
      writes++
      if (insertError) return { data: null, error: { code: insertError, message: 'Sensitive database message' } }
      if (rows.some(row => appointments.has(row.id))) return { data: null, error: { code: '23505' } }
      rows.forEach(row => appointments.set(row.id, { ...row }))
      if (loseResponse) { loseResponse = false; throw new Error('Response lost after commit') }
      return { data: rows.map(({ id }) => ({ id })), error: null }
    },
  }
  return { store, appointments, patients, get writes() { return writes }, loseNextResponse() { loseResponse = true }, failInsert(code: string) { insertError = code } }
}
function inlineRequest() {
  const value = request()
  delete value.input.patientId
  value.input.newPatient = { name: 'Patient', phone: '12345', email: null, dob: null, gender: null, address: null, medical_history: null, notes: null, referral_source: null, referred_by_doctor_id: null, referred_by_patient_id: null, referral_other: null }
  value.input.recurrence = { weekdays: [1, 3, 5], totalSessions: 3 }
  return value
}

test('repeated bookings create distinct rows, replay returns the original IDs without extra writes', async () => {
  const memory = memoryStore()
  const first = await executeBooking(request(), 'create', { ...actor, store: memory.store })
  assert.equal(first.success, true)
  const replay = await executeBooking(request(), 'create', { ...actor, store: memory.store })
  assert.deepEqual(replay, first)
  assert.equal(memory.writes, 1)
  const second = request('12345678-1234-4234-8234-123456789013')
  second.input.time = '16:00'
  assert.equal((await executeBooking(second, 'create', { ...actor, store: memory.store })).success, true)
  assert.equal(memory.appointments.size, 2)
})

test('concurrent same-attempt retries create one inline patient and one atomic recurring series', async () => {
  const memory = memoryStore()
  const value = inlineRequest()
  const results = await Promise.all(Array.from({ length: 5 }, () => executeBooking(value, 'create', { ...actor, store: memory.store })))
  assert.ok(results.every(result => result.success))
  results.forEach(result => assert.deepEqual(result, results[0]))
  assert.equal(memory.patients.size, 1)
  assert.equal(memory.appointments.size, 3)
  assert.deepEqual([...memory.appointments.values()].map(row => row.date), ['2026-10-19', '2026-10-21', '2026-10-23'])
})

test('a lost response after commit is unconfirmed and read-only status recovers the full booking', async () => {
  const memory = memoryStore()
  memory.loseNextResponse()
  const first = await executeBooking(inlineRequest(), 'create', { ...actor, store: memory.store })
  assert.equal(first.success, false)
  if (!first.success) assert.equal(first.errorCode, 'BOOKING_UNCONFIRMED')
  const writes = memory.writes
  const status = await executeBooking(inlineRequest(), 'status', { ...actor, store: memory.store })
  assert.equal(status.success, true)
  assert.equal(memory.writes, writes)
  const replay = await executeBooking(inlineRequest(), 'create', { ...actor, store: memory.store })
  assert.deepEqual(replay, status)
  assert.equal(memory.writes, writes)
})

test('status for an absent booking does not create its patient or appointments', async () => {
  const memory = memoryStore()
  const result = await executeBooking(inlineRequest(), 'status', { ...actor, store: memory.store })
  assert.equal(result.success, false)
  if (!result.success) assert.equal(result.errorCode, 'BOOKING_NOT_FOUND')
  assert.equal(memory.writes, 0)
})

test('changed input and shortened or partially present recurrence are rejected without writes', async () => {
  const memory = memoryStore()
  const original = inlineRequest()
  assert.equal((await executeBooking(original, 'create', { ...actor, store: memory.store })).success, true)
  const changes = [
    { ...original, input: { ...original.input, notes: 'changed' } },
    { ...original, input: { ...original.input, recurrence: { weekdays: [1, 3, 5], totalSessions: 2 } } },
    { ...original, input: { ...original.input, newPatient: { ...original.input.newPatient!, phone: '67890' } } },
  ]
  const writes = memory.writes
  for (const value of changes) {
    const result = await executeBooking(value, 'create', { ...actor, store: memory.store })
    assert.equal(result.success, false)
    if (!result.success) assert.equal(result.errorCode, 'BOOKING_INTENT_MISMATCH')
  }
  memory.appointments.delete([...memory.appointments.keys()][0])
  const partial = await executeBooking(original, 'create', { ...actor, store: memory.store })
  assert.equal(partial.success, false)
  if (!partial.success) assert.equal(partial.errorCode, 'BOOKING_INTENT_MISMATCH')
  assert.equal(memory.writes, writes)
})

test('staff replay respects trigger-derived rate and shared assignment clearing', async () => {
  const memory = memoryStore()
  const value = request()
  value.input.assignedTo = actor.actorId
  const result = await executeBooking(value, 'create', { ...actor, role: 'staff', store: memory.store })
  assert.equal(result.success, true)
  const saved = [...memory.appointments.values()][0]
  assert.equal(saved.fee, 700)
  assert.equal(saved.assigned_to, null)
  assert.deepEqual(await executeBooking(value, 'status', { ...actor, role: 'staff', store: memory.store }), result)
})

test('separate attempts preserve patient-time conflicts and sanitize provider errors', async () => {
  const memory = memoryStore()
  assert.equal((await executeBooking(request(), 'create', { ...actor, store: memory.store })).success, true)
  const conflict = await executeBooking(request('12345678-1234-4234-8234-123456789013'), 'create', { ...actor, store: memory.store })
  assert.equal(conflict.success, false)
  if (!conflict.success) { assert.equal(conflict.errorCode, 'APPOINTMENT_CONFLICT'); assert.deepEqual(conflict.conflictingDates, ['2026-10-17']) }
  memory.failInsert('23503')
  const changed = request('12345678-1234-4234-8234-123456789014')
  changed.input.time = '17:00'
  const failed = await executeBooking(changed, 'create', { ...actor, store: memory.store })
  assert.equal(failed.success, false)
  assert.ok(!JSON.stringify(failed).includes('Sensitive'))
  assert.equal(memory.appointments.size, 1)
})

test('connection loss and unknown transaction outcome codes preserve the unconfirmed attempt', async () => {
  for (const code of ['08006', '08007', '40003', 'PGRST504']) {
    const memory = memoryStore()
    memory.failInsert(code)
    const result = await executeBooking(request(), 'create', { ...actor, store: memory.store })
    assert.equal(result.success, false)
    if (!result.success) assert.equal(result.errorCode, 'BOOKING_UNCONFIRMED', code)
  }
})

test('definitive constraint and authorization rejections are safe to correct', async () => {
  for (const code of ['23503', '23514', '42501', '22003']) {
    const memory = memoryStore()
    memory.failInsert(code)
    const result = await executeBooking(request(), 'create', { ...actor, store: memory.store })
    assert.equal(result.success, false)
    if (!result.success) assert.equal(result.errorCode, 'APPOINTMENT_CREATE_FAILED', code)
  }
})
