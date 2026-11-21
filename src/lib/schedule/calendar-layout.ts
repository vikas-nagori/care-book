// Geometry for the schedule's hourly calendar, shared by the clinic schedule and the
// External Staff calendar so the two grids always lay out identically.

export const START_HOUR = 7
export const END_HOUR = 22
export const HOUR_HEIGHT = 100
export const PX_PER_MIN = HOUR_HEIGHT / 60

export type CalendarSlot = { time: string; duration_minutes: number }

// Chip/cell accent colors keyed off the type's visibility: shared types (e.g. clinic
// visits) read as the accent color, restricted types (e.g. home visits) as the warn color.
export function typeColorTokens(isShared: boolean) {
  return isShared
    ? { border: 'var(--ph-accent)', bg: 'var(--ph-accent-soft)', fg: 'var(--ph-accent-ink)' }
    : { border: 'var(--ph-warn)', bg: 'var(--ph-warn-soft)', fg: 'var(--ph-warn)' }
}

// The grid defaults to 7am–10pm, but expands to cover any booking outside that window so an
// out-of-hours appointment (e.g. a 00:30 home visit) is never hidden off the top or bottom —
// which previously masked accidental double-bookings.
export function computeHourRange(appts: readonly CalendarSlot[]): { startHour: number; endHour: number } {
  let startHour = START_HOUR
  let endHour = END_HOUR
  for (const a of appts) {
    const [h, m] = a.time.split(':').map(Number)
    if (h < startHour) startHour = h
    const apptEndHour = Math.ceil((h * 60 + m + a.duration_minutes) / 60)
    if (apptEndHour > endHour) endHour = apptEndHour
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) }
}

export function buildHours(startHour: number, endHour: number) {
  return Array.from({ length: endHour - startHour + 1 }, (_, i) => {
    const h = startHour + i
    const hh = h % 24
    return { label: `${hh % 12 || 12} ${hh >= 12 ? 'PM' : 'AM'}`, hh: h.toString().padStart(2, '0') }
  })
}

export function timeToY(time: string, startHour: number): number {
  const [hStr, mStr] = time.split(':')
  return ((parseInt(hStr) - startHour) * 60 + parseInt(mStr)) * PX_PER_MIN
}

export type ApptLayoutInfo = { column: number; totalColumns: number }

/** Greedy overlap-column assignment for side-by-side rendering of simultaneous appointments. */
export function computeColumns<T extends { id: string } & CalendarSlot>(appts: readonly T[]): Map<string, ApptLayoutInfo> {
  if (appts.length === 0) return new Map()
  const parsed = appts.map((a) => {
    const [h, m] = a.time.split(':').map(Number)
    const start = h * 60 + m
    return { id: a.id, start, end: start + a.duration_minutes }
  })
  parsed.sort((a, b) => a.start - b.start)
  const columnEnds: number[] = []
  const assigned = new Map<string, number>()
  for (const p of parsed) {
    let col = columnEnds.findIndex((end) => end <= p.start)
    if (col === -1) col = columnEnds.length
    columnEnds[col] = p.end
    assigned.set(p.id, col)
  }
  const result = new Map<string, ApptLayoutInfo>()
  for (const p of parsed) {
    const overlapping = parsed.filter((o) => o.start < p.end && o.end > p.start)
    const maxCol = Math.max(...overlapping.map((o) => assigned.get(o.id)!))
    result.set(p.id, { column: assigned.get(p.id)!, totalColumns: maxCol + 1 })
  }
  return result
}
