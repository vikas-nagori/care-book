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

test('schedule view pushes date changes into browser history and renders a separate mobile rail', () => {
  const source = readFileSync(scheduleViewPath, 'utf8')

  assert.match(source, /initialSelectedDate: string/)
  assert.equal(source.match(/router\.push\(/g)?.length, 1)
  assert.match(source, /router\.push\(navigation\.href, navigation\.options\)/)
  assert.doesNotMatch(source, /router\.replace\(/)
  assert.match(source, /getScheduleDateNavigation\(date\)/)
  assert.match(source, /navigateToDateString\(format\(date, 'yyyy-MM-dd'\)\)/)
  assert.match(source, /buildScheduleRailDates\(initialSelectedDate\)/)
  assert.match(source, /data-selected=\{isSel\}/)
  assert.match(source, /aria-label=\{accessibility\.ariaLabel\}/)
  assert.match(source, /aria-current=\{accessibility\.ariaCurrent\}/)
  assert.match(source, /Swipe the dates to change week/)
})

test('schedule view compares Today using Kolkata date keys throughout', () => {
  const source = readFileSync(scheduleViewPath, 'utf8')

  assert.equal(
    source.match(/isScheduleDateToday\(format\(day, 'yyyy-MM-dd'\), todayDate\)/g)?.length,
    2
  )
  assert.doesNotMatch(source, /isSameDay\(day, new Date\(\)\)/)
})

test('schedule view centers only visible rail chips and responds to responsive size changes', () => {
  const source = readFileSync(scheduleViewPath, 'utf8')

  assert.match(source, /useLayoutEffect\(\(\) => \{/)
  assert.match(source, /getClientRects\(\)\.length/)
  assert.match(source, /railWasVisibleRef\.current = false/)
  assert.match(source, /new window\.ResizeObserver/)
  assert.match(source, /observer\.observe\(rail\)/)
  assert.match(source, /return \(\) => observer\.disconnect\(\)/)
  assert.match(source, /lastCenteredDateRef/)
  assert.match(source, /getScheduleRailCenteringBehavior\(\{/)
  assert.match(source, /typeof window !== 'undefined'/)
  assert.match(source, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/)
  assert.match(source, /behavior: centeringBehavior/)
  assert.match(source, /scrollIntoView\(\{[\s\S]*inline: 'center'/)
})
