import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const schedulePagePath = join(process.cwd(), 'src/app/schedule/page.tsx')
const scheduleViewPath = join(process.cwd(), 'src/app/schedule/schedule-view.tsx')

test('schedule page normalizes the URL date and queries the rolling date range', () => {
  const source = readFileSync(schedulePagePath, 'utf8')

  assert.match(source, /searchParams: Promise<\{ date\?: string \| string\[\] \}>/)
  assert.match(source, /resolveScheduleDateRange\(date\)/)
  assert.match(source, /\.gte\('date', rangeStart\)/)
  assert.match(source, /\.lte\('date', rangeEnd\)/)
  assert.match(source, /initialSelectedDate=\{selectedDate\}/)
})

test('schedule view backs date changes with the URL and renders a separate mobile rail', () => {
  const source = readFileSync(scheduleViewPath, 'utf8')

  assert.match(source, /initialSelectedDate: string/)
  assert.match(source, /router\.replace\(`\/schedule\?date=\$\{[^}]+\}`,[\s\S]*scroll: false/)
  assert.match(source, /buildScheduleRailDates\(initialSelectedDate\)/)
  assert.match(source, /data-selected=\{isSel\}/)
  assert.match(source, /Swipe the dates to change week/)
  assert.match(source, /scrollIntoView\(\{[\s\S]*inline: 'center'/)
})
