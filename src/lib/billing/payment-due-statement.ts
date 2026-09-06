import { formatDateOnly, getZonedCalendarContext, CLINIC_TIME_ZONE } from '../timezone.ts'

export type PaymentDueRegularScope = 'all_due' | 'previous_month'

export type PaymentDueApplicationSource = {
  amount: string
  status: 'active' | 'reversed'
}

export type PaymentDueAppointmentSource = {
  id: string
  date: string
  time: string | null
  type: string | null
  status: 'scheduled' | 'completed' | 'cancelled'
  chargeId: string | null
  chargeAmount: string
  chargeStatus: 'pending' | 'posted' | 'voided'
  packageId: string | null
  packageLifecycle: 'scheduled' | 'availed' | 'released' | null
  applications: PaymentDueApplicationSource[]
}

export type PaymentDuePackageSource = {
  id: string
  name: string
  createdAt: string
  quoteAmount: string
  netReceived: string
  totalSessions: number
}

export type PaymentDueStatementSource = {
  snapshotAt: string
  clinic: { name: string }
  patient: { id: string; name: string }
  appointments: PaymentDueAppointmentSource[]
  packages: PaymentDuePackageSource[]
}

export type PaymentDueStatementOptions = {
  regularScope: PaymentDueRegularScope
  periodMonth?: string
  generatedAt: Date
  timeZone?: string
}

export type PaymentDueRegularRow = {
  id: string
  date: string
  time: string | null
  type: string
  feePaise: number
  paidPaise: number
  duePaise: number
}

export type PaymentDuePackageSession = {
  id: string
  date: string
  time: string | null
  type: string
}

export type PaymentDuePackageSection = {
  id: string
  name: string
  quoteAmountPaise: number
  paidIntoPackagePaise: number
  totalSessions: number
  sessionsLeft: number
  completedSessions: PaymentDuePackageSession[]
  completedChargePaise: number
  completedPaidPaise: number
  duePaise: number
}

export type PaymentDueStatement = {
  snapshotAt: string
  generatedAt: string
  clinicName: string
  patientId: string
  patientName: string
  regular: {
    periodLabel: string
    rows: PaymentDueRegularRow[]
    totalFeePaise: number
    totalPaidPaise: number
    totalDuePaise: number
  } | null
  packages: PaymentDuePackageSection[]
  totalDuePaise: number
  isEmpty: boolean
}

const PERIOD_MONTH_PATTERN = /^\d{4}-\d{2}$/
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/

function parseMoneyPaise(value: string, label: string) {
  if (typeof value !== 'string' || !MONEY_PATTERN.test(value)) {
    throw new Error(`Invalid money value for ${label}.`)
  }
  const [whole, fraction = ''] = value.split('.')
  const wholePaise = Number(whole) * 100
  const fractionPaise = Number(fraction.padEnd(2, '0'))
  const paise = wholePaise + fractionPaise
  if (!Number.isSafeInteger(paise)) throw new Error(`Money value is too large for ${label}.`)
  return paise
}

function sumApplications(appointment: PaymentDueAppointmentSource) {
  let total = 0
  for (const application of appointment.applications) {
    if (application.status !== 'active') continue
    const amount = parseMoneyPaise(application.amount, `application ${appointment.id}`)
    total += amount
    if (!Number.isSafeInteger(total)) throw new Error(`Money total is too large for appointment ${appointment.id}.`)
  }
  const charge = parseMoneyPaise(appointment.chargeAmount, `charge ${appointment.id}`)
  if (total > charge) throw new Error(`Active applications exceed charge for appointment ${appointment.id}.`)
  return { charge, paid: total, due: charge - total }
}

function assertDateKey(value: string, label: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid date for ${label}.`)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new Error(`Invalid date for ${label}.`)
  }
}

function isCurrentPackageAllocation(appointment: PaymentDueAppointmentSource) {
  return Boolean(appointment.packageId && appointment.packageLifecycle !== 'released')
}

function sortAppointments(left: PaymentDueAppointmentSource, right: PaymentDueAppointmentSource) {
  return left.date.localeCompare(right.date)
    || (left.time ?? '').localeCompare(right.time ?? '')
    || left.id.localeCompare(right.id)
}

function assertPeriodMonth(periodMonth: string) {
  if (!PERIOD_MONTH_PATTERN.test(periodMonth)) throw new Error('Invalid previous-month period.')
  const [year, month] = periodMonth.split('-').map(Number)
  if (month < 1 || month > 12) throw new Error('Invalid previous-month period.')
  const date = new Date(Date.UTC(year, month - 1, 1))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) throw new Error('Invalid previous-month period.')
}

export function getPreviousMonthPeriod(now: Date, timeZone = CLINIC_TIME_ZONE) {
  const context = getZonedCalendarContext(now, timeZone)
  return {
    periodMonth: context.previousMonthStart.slice(0, 7),
    periodLabel: formatDateOnly(context.previousMonthStart, 'MMMM yyyy'),
    startDate: context.previousMonthStart,
    endDate: context.previousMonthEnd,
  }
}

function periodForOptions(options: PaymentDueStatementOptions) {
  if (options.regularScope === 'all_due') return null
  const expected = getPreviousMonthPeriod(options.generatedAt, options.timeZone)
  if (!options.periodMonth || options.periodMonth !== expected.periodMonth) {
    throw new Error('The previous-month period has changed. Refresh and try again.')
  }
  assertPeriodMonth(options.periodMonth)
  return expected
}

export function buildPaymentDueStatement(
  source: PaymentDueStatementSource,
  options: PaymentDueStatementOptions,
): PaymentDueStatement {
  const period = periodForOptions(options)
  const periodLabel = options.regularScope === 'all_due'
    ? 'All completed regular sessions with payment pending'
    : `${period!.periodLabel} · completed regular sessions with payment pending`

  source.appointments.forEach((appointment) => assertDateKey(appointment.date, `appointment ${appointment.id}`))
  const sortedAppointments = [...source.appointments].sort(sortAppointments)
  const packageAppointmentIds = new Set(
    sortedAppointments.filter(isCurrentPackageAllocation).map((appointment) => appointment.id),
  )

  const regularRows = sortedAppointments.flatMap((appointment) => {
    if (appointment.status !== 'completed' || appointment.chargeStatus !== 'posted' || !appointment.chargeId) return []
    if (packageAppointmentIds.has(appointment.id)) return []
    if (period && (appointment.date < period.startDate || appointment.date > period.endDate)) return []

    const amounts = sumApplications(appointment)
    if (amounts.due <= 0) return []
    return [{
      id: appointment.id,
      date: appointment.date,
      time: appointment.time,
      type: appointment.type?.trim() || 'Session',
      feePaise: amounts.charge,
      paidPaise: amounts.paid,
      duePaise: amounts.due,
    }]
  })

  const regular = regularRows.length === 0 ? null : {
    periodLabel,
    rows: regularRows,
    totalFeePaise: regularRows.reduce((sum, row) => sum + row.feePaise, 0),
    totalPaidPaise: regularRows.reduce((sum, row) => sum + row.paidPaise, 0),
    totalDuePaise: regularRows.reduce((sum, row) => sum + row.duePaise, 0),
  }

  const packages = [...source.packages]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .flatMap((packageSource): PaymentDuePackageSection[] => {
      const packageAppointments = sortedAppointments.filter((appointment) =>
        appointment.packageId === packageSource.id
        && appointment.packageLifecycle === 'availed'
        && appointment.status === 'completed'
      )
      const completedSessions = packageAppointments.map((appointment) => ({
        id: appointment.id,
        date: appointment.date,
        time: appointment.time,
        type: appointment.type?.trim() || 'Session',
      }))
      let completedChargePaise = 0
      let completedPaidPaise = 0
      let duePaise = 0
      for (const appointment of packageAppointments.filter((appointment) => appointment.chargeStatus === 'posted' && appointment.chargeId)) {
        const amounts = sumApplications(appointment)
        completedChargePaise += amounts.charge
        completedPaidPaise += amounts.paid
        duePaise += amounts.due
      }
      // A prepaid package legitimately owes nothing yet still belongs in the summary: it is the
      // patient's record of the sessions taken under the package. Only a package with no completed
      // session has nothing to report.
      if (completedSessions.length === 0) return []

      const quoteAmountPaise = parseMoneyPaise(packageSource.quoteAmount, `package ${packageSource.id} quote`)
      const paidIntoPackagePaise = parseMoneyPaise(packageSource.netReceived, `package ${packageSource.id} receipts`)
      const availedCount = completedSessions.length
      return [{
        id: packageSource.id,
        name: packageSource.name.trim() || 'Package',
        quoteAmountPaise,
        paidIntoPackagePaise,
        totalSessions: packageSource.totalSessions,
        sessionsLeft: Math.max(packageSource.totalSessions - availedCount, 0),
        completedSessions,
        completedChargePaise,
        completedPaidPaise,
        duePaise,
      }]
    })

  const totalDuePaise = (regular?.totalDuePaise ?? 0) + packages.reduce((sum, packageSection) => sum + packageSection.duePaise, 0)
  return {
    snapshotAt: source.snapshotAt,
    generatedAt: options.generatedAt.toISOString(),
    clinicName: source.clinic.name,
    patientId: source.patient.id,
    patientName: source.patient.name,
    regular,
    packages,
    totalDuePaise,
    isEmpty: regular === null && packages.length === 0,
  }
}

/**
 * Formats paise for the PDF. The renderer uses a PDF standard-14 font (Helvetica), whose WinAnsi
 * encoding has no glyph for ₹ (U+20B9): pdfkit then emits the raw code point as two hex bytes,
 * which a viewer reads as a space followed by ¹. Spell the currency out instead.
 */
export function formatPaiseAsInr(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Money cannot be negative or unsafe.')
  const whole = Math.floor(value / 100)
  const fraction = value % 100
  return `Rs. ${whole.toLocaleString('en-IN')}.${fraction.toString().padStart(2, '0')}`
}
