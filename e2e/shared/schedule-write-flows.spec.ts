import { format, getDay, parseISO } from 'date-fns'
import type { Page } from '@playwright/test'
import { AppointmentDetail } from '../pages/appointment-detail'
import { AppointmentForm } from '../pages/appointment-form'
import { SessionNoteForm, type SessionNoteFormData } from '../pages/session-note-form'
import { STAFF, STAFF2 } from '../support/accounts'
import { attachErrorGuards as attachAppErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function attachErrorGuards(page: Page, expectedConflict = false) {
  return attachAppErrorGuards(page, { expectedHttpErrors: [
    // Rapid matrix runs share a user across devices and can reach the intentional stage budget.
    { pathname: '/api/telemetry', status: 429 },
    ...(expectedConflict ? [{ pathname: '/api/appointments/bookings', status: 409 }] : []),
  ] })
}

test('books a shared appointment through the real appointment form', async ({ page, factory }, testInfo) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(70)
  const notes = factory.uniqueName('shared-booking')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  const feeInput = page.getByLabel('Session Fee (₹)', { exact: true })
  if (testInfo.project.name.startsWith('staff-')) {
    await expect(feeInput).toHaveCount(0)
  } else {
    await expect(feeInput).toBeVisible()
  }
  await form.fill({
    patientName: patient.name as string,
    date,
    time: '08:15',
    durationMinutes: '50',
    notes,
  })
  await form.submitAndExpectBooked()

  await page.goto(`/schedule?date=${date}`)
  await expect(page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true })).toBeVisible()
  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    date,
    time: '08:15:00',
    duration_minutes: 50,
    appointment_type_id: sharedType.id,
    type_is_shared: true,
    status: 'scheduled',
    fee: Number(sharedType.session_rate),
    // The seeded appointment types carry session_rate 0, so this booking is a zero-value
    // session — settled on creation since there is nothing to collect (migration 039).
    payment_status: 'paid',
    assigned_to: null,
  })
  await guards.assertClean()
})

test('books a restricted appointment assigned to role-appropriate internal staff', async ({ page, factory }, testInfo) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const privateType = await factory.findAppointmentType(false)
  const isStaffProject = testInfo.project.name.startsWith('staff-')
  const assigneeAccount = isStaffProject ? STAFF : STAFF2
  const assignee = await factory.findProfileByEmail(assigneeAccount.email)
  const date = clinicDate(75)
  const notes = factory.uniqueName('private-booking')
  // Options read "<name> (<role>)"; the role tag's spacing differs between browsers.
  const escaped = (assignee.full_name || assignee.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const assigneeLabel = new RegExp(`^${escaped}\\s*\\(${assignee.role === 'admin' ? 'Admin' : 'Staff'}\\)$`)
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({
    patientName: patient.name as string,
    date,
    time: '13:20',
    durationMinutes: '60',
    notes,
    appointmentTypeName: privateType.name,
    assignedStaffLabel: assigneeLabel,
  })
  await form.submitAndExpectBooked()

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    date,
    time: '13:20:00',
    appointment_type_id: privateType.id,
    type_is_shared: false,
    assigned_to: assignee.id,
    fee: Number(privateType.session_rate),
    // The seeded appointment types carry session_rate 0, so this booking is a zero-value
    // session — settled on creation since there is nothing to collect (migration 039).
    payment_status: 'paid',
  })

  await page.goto(`/schedule/${rows[0].id}`)
  await expect(page).toHaveURL(`/schedule/${rows[0].id}`)
  await expect(page.getByText(assignee.full_name || assignee.email, { exact: true })).toBeVisible()
  await guards.assertClean()
})

test('reports a deterministic recurring conflict and creates none of the requested series', async ({ page, factory }) => {
  const guards = attachErrorGuards(page, true)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const firstDate = clinicDate(84)
  const conflictDate = clinicDate(91)
  const time = '16:35'
  const requestedNotes = factory.uniqueName('recurring-request')
  const conflict = await factory.createAppointment({
    patientId: patient.id,
    appointmentTypeId: sharedType.id,
    date: conflictDate,
    time,
    notes: factory.uniqueName('existing-conflict'),
  })
  factory.watchUiAppointments({ patientId: patient.id, notes: requestedNotes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({
    patientName: patient.name as string,
    date: firstDate,
    time,
    durationMinutes: '45',
    notes: requestedNotes,
  })
  await form.enableWeeklyRepeat(WEEKDAY_LABELS[getDay(parseISO(firstDate))], 3)
  await form.submitAndExpectConflict(format(parseISO(conflictDate), 'dd MMM yyyy'))

  expect(await factory.findAppointments({ patientId: patient.id, notes: requestedNotes })).toEqual([])
  const occupiedSlot = await factory.findAppointments({ patientId: patient.id, date: conflictDate, time })
  expect(occupiedSlot.map((row) => row.id)).toContain(conflict.id)
  await guards.assertClean()
})

test('books a backdated appointment as completed, warning before it is saved', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(-11)
  const notes = factory.uniqueName('backdated-booking')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({
    patientName: patient.name as string,
    date,
    time: '07:45',
    durationMinutes: '45',
    notes,
  })

  // The form says what will happen before the click, so "completed" is never a surprise.
  await expect(page.getByTestId('backdated-status-hint'))
    .toHaveText('This date has already passed — the session will be saved as completed.')
  await form.submitAndExpectBooked()

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ date, time: '07:45:00', status: 'completed' })
  await guards.assertClean()
})

test('books a future appointment as scheduled with no backdating warning', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(96)
  const notes = factory.uniqueName('future-booking')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({
    patientName: patient.name as string,
    date,
    time: '07:55',
    durationMinutes: '45',
    notes,
  })

  await expect(page.getByTestId('backdated-status-hint')).toHaveCount(0)
  await form.submitAndExpectBooked()

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ date, status: 'scheduled' })
  await guards.assertClean()
})

test('changes appointment status from scheduled to completed and persists it', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(62),
    time: '10:25',
  })

  await page.goto(`/schedule/${appointment.id}`)
  await page.getByRole('combobox').filter({ hasText: 'Scheduled' }).click()
  await page.getByRole('option', { name: 'Completed', exact: true }).click()
  await expect(page.getByText('Status updated', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox').filter({ hasText: 'Completed' })).toBeVisible()

  await expect.poll(async () => {
    const rows = await factory.findAppointments({ patientId: patient.id, notes: appointment.notes as string })
    return rows[0]?.status
  }).toBe('completed')
  await guards.assertClean()
})

test('adds a SOAP session note, reopens it, and persists edited content', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(-45),
    time: '14:10',
    status: 'completed',
  })
  factory.watchUiSessionNote(appointment.id)
  const first: Required<SessionNoteFormData> = {
    subjective: factory.uniqueName('subjective-first'),
    objective: factory.uniqueName('objective-first'),
    assessment: factory.uniqueName('assessment-first'),
    plan: factory.uniqueName('plan-first'),
    exercises: factory.uniqueName('exercises-first'),
  }

  await page.goto(`/schedule/${appointment.id}`)
  await page.getByRole('button', { name: 'Add Notes', exact: true }).click()
  const form = new SessionNoteForm(page)
  await form.fill(first)
  await form.save('Notes saved')
  await expect(page.getByText(first.subjective, { exact: true })).toBeVisible()

  const edited = {
    ...first,
    subjective: factory.uniqueName('subjective-edited'),
    assessment: factory.uniqueName('assessment-edited'),
    plan: factory.uniqueName('plan-edited'),
  }
  await page.getByRole('button', { name: 'Edit Notes', exact: true }).click()
  await form.fill(edited)
  await form.save('Notes updated')
  await expect(page.getByText(edited.subjective, { exact: true })).toBeVisible()
  await expect(page.getByText(edited.assessment, { exact: true })).toBeVisible()
  await expect(page.getByText(edited.plan, { exact: true })).toBeVisible()

  const persisted = await factory.findSessionNoteByAppointmentId(appointment.id)
  expect(persisted).toMatchObject({
    subjective: edited.subjective,
    objective: edited.objective,
    assessment: edited.assessment,
    plan: edited.plan,
    exercises_prescribed: edited.exercises,
  })
  await guards.assertClean()
})

test('deletes a scheduled appointment through confirmation and redirects away', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(65),
    time: '17:40',
  })

  await page.goto(`/schedule/${appointment.id}`)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Delete appointment?' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page).toHaveURL(/\/schedule$/)

  expect(await factory.findAppointments({
    patientId: patient.id,
    notes: appointment.notes as string,
  })).toEqual([])
  await guards.assertClean()
})

test('creates a patient inline while booking and records the typed age', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('inline-aged-patient')
  factory.watchUiPatient(name)
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(71)

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: name, date, time: '08:20', newPatient: { phone: `9${Date.now().toString().slice(-9)}`, age: '42' } })
  await expect(page.getByLabel(/date of birth/i)).toHaveCount(0)
  await form.submitAndExpectBooked()

  await expect.poll(async () => (await factory.findPatientByName(name))?.age_years).toBe(42)
  const patient = await factory.findPatientByName(name)
  expect(patient).toMatchObject({ dob: null, age_years: 42, age_recorded_on: clinicDate() })
  expect(await factory.findAppointments({ patientId: patient!.id, date })).toHaveLength(1)

  await page.goto(`/patients/${patient!.id}`)
  await expect(page.getByTestId('patient-age')).toHaveText('Age 42 years')
  await guards.assertClean()
})

test('refuses an inline patient age that is not whole years from 0 to 120', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('inline-bad-age')
  factory.watchUiPatient(name)
  const sharedType = await factory.findAppointmentType(true)

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: name, date: clinicDate(72), time: '08:25', newPatient: { phone: `9${Date.now().toString().slice(-9)}`, age: '130' } })
  await page.getByRole('button', { name: 'Book Appointment', exact: true }).click()
  const notifications = page.getByRole('region', { name: 'Notifications (F8)' })
  await expect(notifications.getByText('Check the age', { exact: true })).toBeVisible()
  await expect(notifications).toContainText('Age must be a whole number between 0 and 120.')
  await expect(page).toHaveURL(/\/schedule\/new/)
  expect(await factory.findPatientByName(name)).toBeNull()
  await guards.assertClean()
})

// --- S-6 -------------------------------------------------------------------------------------

test('creates an inline patient with every optional field and a new referring doctor while booking', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('inline-full-patient')
  const doctorName = factory.uniqueName('inline-doctor')
  factory.watchUiPatient(name)
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(73)
  const details = {
    phone: factory.uniqueMobile(),
    email: factory.uniqueEmail('inline-patient'),
    age: '37',
    gender: 'Female' as const,
    address: factory.uniqueName('address'),
    medicalHistory: factory.uniqueName('history'),
    notes: factory.uniqueName('patient-notes'),
  }

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({
    patientName: name, date, time: '08:30',
    newPatient: { ...details, newReferringDoctor: { name: doctorName, specialty: 'Orthopaedics', address: factory.uniqueName('clinic-street') } },
  })
  await form.submitAndExpectBooked()
  await expect(page.getByText('Patient added and appointment booked', { exact: true })).toBeVisible()

  await expect.poll(async () => (await factory.findPatientByName(name))?.name).toBe(name)
  const doctors = await factory.findDoctors({ name: doctorName })
  expect(doctors).toHaveLength(1)
  expect(doctors[0]).toMatchObject({ name: doctorName, specialty: 'Orthopaedics' })
  const patient = await factory.findPatientByName(name)
  expect(patient).toMatchObject({
    phone: details.phone,
    email: details.email,
    age_years: 37,
    gender: 'female',
    address: details.address,
    medical_history: details.medicalHistory,
    notes: details.notes,
    referral_source: 'doctor',
    referred_by_doctor_id: doctors[0].id,
  })
  expect(await factory.findAppointments({ patientId: patient!.id, date })).toHaveLength(1)

  await page.goto(`/patients/${patient!.id}`)
  const main = page.getByRole('main')
  for (const text of [details.email, details.address, details.medicalHistory, details.notes]) {
    await expect(main.getByText(text, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  }
  await expect(main.getByText(new RegExp(doctorName)).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByTestId('patient-age')).toHaveText('Age 37 years')
  await guards.assertClean()
})

// --- S-7 -------------------------------------------------------------------------------------

test('books a weekly series of three and reports how many were booked', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const firstDate = clinicDate(92)
  const notes = factory.uniqueName('weekly-series')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: patient.name as string, date: firstDate, time: '07:35', notes })
  await form.enableWeeklyRepeat(WEEKDAY_LABELS[getDay(parseISO(firstDate))], 3)
  await expect(page.getByTestId('backdated-status-hint')).toHaveCount(0)
  await form.submitAndExpectBooked(3)
  await expect(page.getByText('3 appointments booked', { exact: true })).toBeVisible()

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows.map((row) => row.date)).toEqual([firstDate, clinicDate(99), clinicDate(106)])
  expect(rows.every((row) => row.status === 'scheduled' && row.time === '07:35:00')).toBe(true)
  await guards.assertClean()
})

test('a weekly series that starts in the past warns first and saves past sessions as completed', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const firstDate = clinicDate(-8)
  const notes = factory.uniqueName('backdated-series')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: patient.name as string, date: firstDate, time: '07:40', notes })
  await form.enableWeeklyRepeat(WEEKDAY_LABELS[getDay(parseISO(firstDate))], 3)
  await expect(page.getByTestId('backdated-status-hint'))
    .toHaveText('2 of these dates have already passed — those sessions will be saved as completed.')
  await form.submitAndExpectBooked(3)

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows.map((row) => [row.date, row.status])).toEqual([
    [firstDate, 'completed'],
    [clinicDate(-1), 'completed'],
    [clinicDate(6), 'scheduled'],
  ])
  await guards.assertClean()
})

// --- S-19 ------------------------------------------------------------------------------------

test('cancels a scheduled appointment, reopens a completed one, and offers Delete only while scheduled', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const scheduled = await factory.createAppointment({ patientId: patient.id, date: clinicDate(69), time: '10:35' })
  const completed = await factory.createAppointment({ patientId: patient.id, date: clinicDate(-4), time: '10:45', status: 'completed' })
  const detail = new AppointmentDetail(page)
  const statusOf = async (id: string) => (await factory.findAppointments({ patientId: patient.id })).find((row) => row.id === id)?.status

  await detail.goto(scheduled.id)
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  await detail.setStatus('Scheduled', 'Cancelled')
  await expect.poll(() => statusOf(scheduled.id)).toBe('cancelled')
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)

  await detail.goto(completed.id)
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
  await detail.setStatus('Completed', 'Scheduled')
  await expect.poll(() => statusOf(completed.id)).toBe('scheduled')
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  await guards.assertClean()
})

test('a delete confirmed after another session completed the appointment is refused and keeps it', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(69), time: '10:55' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const confirm = await detail.openDelete()

  // Someone else marks it completed while this tab still shows "Scheduled".
  await factory.updateAppointment(appointment.id, { status: 'completed' })
  await confirm.click()
  // includeHidden: the open alertdialog marks the toast region aria-hidden.
  const notifications = page.getByRole('region', { name: 'Notifications (F8)', includeHidden: true })
  await expect(notifications).toContainText('Only scheduled appointments can be deleted.')
  await expect(confirm).toBeEnabled()
  await expect(page).toHaveURL(`/schedule/${appointment.id}`)
  expect((await factory.findAppointments({ patientId: patient.id }))[0]).toMatchObject({ id: appointment.id, status: 'completed' })
  await guards.assertClean()
})

// --- S-26 (decision D4b) ---------------------------------------------------------------------

test('C-2: a cancelled slot can be booked again for the same patient, date and time', async ({ page, factory }) => {
  const guards = attachErrorGuards(page, true)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(74)
  const cancelled = await factory.createAppointment({ patientId: patient.id, appointmentTypeId: sharedType.id, date, time: '13:05' })
  const detail = new AppointmentDetail(page)
  await detail.goto(cancelled.id)
  await detail.setStatus('Scheduled', 'Cancelled')
  const notes = factory.uniqueName('rebooked-slot')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: patient.name as string, date, time: '13:05', notes })
  await form.submitAndExpectBooked()

  const rows = await factory.findAppointments({ patientId: patient.id, date, time: '13:05' })
  expect(rows.map((row) => row.status).sort()).toEqual(['cancelled', 'scheduled'])
  expect(rows.find((row) => row.id === cancelled.id)?.status).toBe('cancelled')
  await page.goto(`/schedule?date=${date}`)
  await expect(page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true })).toHaveCount(2)
  await guards.assertClean()
})
