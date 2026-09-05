export type ValidatedReminderInput = {
  title: string
  date: string
  time: string | null
  patient_id: string | null
  contact_name: string | null
  phone: string | null
  notes: string | null
}

export function isReminderId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

export function validateReminderInput(input: unknown):
  | { success: true; data: ValidatedReminderInput }
  | { success: false; message: string } {
  const fail = (message: string) => ({ success: false as const, message })
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Enter a reminder title and date.')
  const value = input as Record<string, unknown>
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 200) {
    return fail('Enter a title of 1–200 characters.')
  }
  if (typeof value.date !== 'string' || !validDate(value.date)) return fail('Enter a valid reminder date.')
  const optional: Record<string, string | null> = {}
  for (const [key, label, max] of [['time', 'Time', 5], ['patientId', 'Patient', 36], ['contactName', 'Contact name', 200], ['phone', 'Phone', 50], ['notes', 'Notes', 5000]] as const) {
    const raw = value[key]
    if (raw != null && typeof raw !== 'string') return fail(`${label} must be text.`)
    const normalized = typeof raw === 'string' ? raw.trim() : ''
    if (normalized.length > max) return fail(`${label} must be ${max} characters or fewer.`)
    optional[key] = normalized || null
  }
  if (optional.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(optional.time)) return fail('Enter a valid time in HH:mm format.')
  if (optional.patientId && !isReminderId(optional.patientId)) return fail('Choose a valid patient.')
  return { success: true, data: {
    title: value.title.trim(), date: value.date, time: optional.time,
    patient_id: optional.patientId, contact_name: optional.contactName, phone: optional.phone, notes: optional.notes,
  } }
}
