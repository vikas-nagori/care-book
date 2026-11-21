import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const schedulePagePath = join(process.cwd(), 'src/app/schedule/page.tsx')
const scheduleViewPath = join(process.cwd(), 'src/app/schedule/schedule-view.tsx')
// The date chips, rail and week grid are shared with the External Staff calendar.
const calendarPartsPath = join(process.cwd(), 'src/components/schedule/calendar-parts.tsx')

test('schedule page resolves the browser timezone and queries the rolling date range', () => {
  const source = readFileSync(schedulePagePath, 'utf8')

  assert.match(source, /searchParams: Promise<\{ date\?: string \| string\[\] \}>/)
  assert.match(source, /const userTimeZone = await getUserTimeZone\(\)/)
  assert.match(source, /resolveScheduleDateRange\(date, now, userTimeZone\)/)
  assert.match(source, /\.gte\('date', rangeStart\)/)
  assert.match(source, /\.lte\('date', rangeEnd\)/)
  assert.match(source, /initialSelectedDate=\{selectedDate\}/)
  assert.match(source, /todayDate=\{todayDate\}/)
})

test('schedule view pushes date changes into browser history and renders a separate mobile rail', () => {
  const source = readFileSync(scheduleViewPath, 'utf8')

  assert.match(source, /initialSelectedDate: string/)
  // Date changes go through the shared calendar-date hook: a pushState inside the loaded weeks
  // (instant on a phone), a router.push beyond them — both real history entries, never replace.
  assert.match(source, /useCalendarDate\(\{/)
  assert.match(source, /getScheduleDateNavigation\(date\)\.href/)
  assert.doesNotMatch(source, /router\.replace\(/)
  const hook = readFileSync(join(process.cwd(), 'src/components/schedule/use-calendar-date.ts'), 'utf8')
  assert.match(hook, /window\.history\.pushState\(/)
  assert.match(hook, /router\.push\(hrefFor\(date\)/)
  assert.doesNotMatch(hook, /replaceState|router\.replace/)
  assert.match(source, /navigateToDateString\(format\(date, 'yyyy-MM-dd'\)\)/)
  assert.match(source, /buildScheduleRailDates\(initialSelectedDate\)/)
  assert.match(source, /<MobileDateRail[\s\S]*dates=\{mobileRailDates\}/)
  const parts = readFileSync(calendarPartsPath, 'utf8')
  assert.match(parts, /data-selected=\{selected\}/)
  assert.match(parts, /aria-label=\{accessibility\.ariaLabel\}/)
  assert.match(parts, /aria-current=\{accessibility\.ariaCurrent\}/)
  assert.match(parts, /Swipe the dates to change week/)
})

test('schedule view compares Today using the server-derived user date throughout', () => {
  const source = readFileSync(scheduleViewPath, 'utf8')
  const parts = readFileSync(calendarPartsPath, 'utf8')

  // "Is this today?" is decided in two shared places — the date chip (desktop strip and mobile
  // rail) and the week grid — and both must read the server-derived date, not the browser clock.
  const todayComparisons = parts.match(/isScheduleDateToday\((?:[^()]|\([^()]*\))*\)/g) ?? []
  assert.equal(todayComparisons.length, 2)
  assert.ok(todayComparisons.every((call) => call.endsWith(', todayDate)')))
  assert.match(source, /todayDate: string/)
  assert.doesNotMatch(source, /resolveScheduleDateRange\(undefined\)/)
  assert.doesNotMatch(source + parts, /isSameDay\(day, new Date\(\)\)/)
  assert.match(source, /todayDate=\{todayDate\}/)
})

test('schedule view centers only visible rail chips and responds to responsive size changes', () => {
  const source = readFileSync(calendarPartsPath, 'utf8')

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
