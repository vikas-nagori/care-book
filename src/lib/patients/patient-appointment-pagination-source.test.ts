import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const pageSource = readFileSync(join(process.cwd(), 'src/app/patients/[id]/page.tsx'), 'utf8')
const detailSource = readFileSync(join(process.cwd(), 'src/app/patients/[id]/patient-detail.tsx'), 'utf8')

test('patient page fetches only the requested appointment history range', () => {
  assert.match(pageSource, /APPOINTMENTS_PAGE_SIZE\s*=\s*20/)
  assert.match(pageSource, /appointments_page/)
  assert.match(pageSource, /select\('id, date, time, duration_minutes, type, status',\s*\{ count: 'exact' \}\)/)
  assert.match(pageSource, /\.order\('date', \{ ascending: false \}\)/)
  assert.match(pageSource, /\.order\('time', \{ ascending: false \}\)/)
  assert.match(pageSource, /\.order\('id', \{ ascending: false \}\)/)
  assert.match(pageSource, /\.range\(appointmentRangeStart, appointmentRangeEnd\)/)
})

test('patient detail uses URL-backed numbered pagination instead of client-side show-all', () => {
  assert.doesNotMatch(detailSource, /showAllAppts/)
  assert.doesNotMatch(detailSource, /appointments\.slice/)
  assert.match(detailSource, /appointments_page/)
  assert.match(detailSource, /tab=appointments/)
  assert.match(detailSource, /getPaginationItems/)
  assert.match(detailSource, /Previous/)
  assert.match(detailSource, /Next/)
})
