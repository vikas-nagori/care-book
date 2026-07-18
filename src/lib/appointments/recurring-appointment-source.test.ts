import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const formSource = readFileSync(join(process.cwd(), 'src/app/schedule/appointment-form.tsx'), 'utf8')
const actionSource = readFileSync(join(process.cwd(), 'src/app/schedule/actions.ts'), 'utf8')

test('new appointment form submits creation through the server action', () => {
  assert.match(formSource, /import\s*\{\s*createAppointment\s*\}\s*from\s*['"]\.\/actions['"]/)
  assert.match(formSource, /await createAppointment\(/)
  assert.doesNotMatch(formSource, /from\('appointments'\)\.insert\(data\)/)
})

test('new appointment form adds recurrence without removing existing appointment fields', () => {
  for (const label of [
    'Patient *',
    'Date *',
    'Time *',
    'Duration (min)',
    'Type',
    'Assigned Staff',
    'Session Fee (₹)',
    'Notes',
    'New Patient Details',
  ]) {
    assert.match(formSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.match(formSource, /Repeat appointment/)
  assert.match(formSource, /Total sessions/)
  assert.match(formSource, /Book \{recurringDates\.length\} appointments/)
})

test('appointment action bulk inserts generated rows and returns structured conflicts', () => {
  assert.match(actionSource, /buildAppointmentInsertRows/)
  assert.match(actionSource, /conflictingDates/)
  assert.match(actionSource, /\.insert\(appointmentRows\)/)
  assert.match(actionSource, /appointmentIds:/)
})
