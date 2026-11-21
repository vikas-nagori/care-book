'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The calendar's selected date, kept in the URL (`?date=`) so back/forward and reloads work.
 *
 * The page already loads a ±3-week window of appointments. Moving inside that window only
 * updates the URL with history.pushState — no server round trip — so a date tap on a phone is
 * instant. Moving outside it navigates normally, and the server loads the new window.
 */
export function useCalendarDate({
  initialDate,
  loadedFrom,
  loadedTo,
  hrefFor,
}: {
  initialDate: string
  loadedFrom: string
  loadedTo: string
  hrefFor: (date: string) => string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlDate = searchParams.get('date')
  const selectedDate = urlDate && DATE_KEY.test(urlDate) && urlDate >= loadedFrom && urlDate <= loadedTo
    ? urlDate
    : initialDate

  function select(date: string, view: 'day' | 'week' = 'day') {
    const day = parseISO(date)
    const first = view === 'week' ? format(startOfWeek(day, { weekStartsOn: 1 }), 'yyyy-MM-dd') : date
    const last = view === 'week' ? format(addDays(startOfWeek(day, { weekStartsOn: 1 }), 6), 'yyyy-MM-dd') : date
    if (first >= loadedFrom && last <= loadedTo) {
      if (date !== selectedDate) window.history.pushState(null, '', hrefFor(date))
    } else {
      router.push(hrefFor(date), { scroll: false })
    }
  }

  return { selectedDate, select }
}
