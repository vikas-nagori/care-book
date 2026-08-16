import { format, getDay, parseISO } from 'date-fns'
import { AppointmentForm } from '../pages/appointment-form'
import { SessionNoteForm, type SessionNoteFormData } from '../pages/session-note-form'
import { STAFF, STAFF2 } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

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
  const assigneeLabel = `${assignee.full_name || assignee.email} · ${assignee.role}`
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
  const guards = attachErrorGuards(page)
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
  const first: SessionNoteFormData = {
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
