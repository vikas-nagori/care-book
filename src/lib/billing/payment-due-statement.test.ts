import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPaymentDueStatement,
  formatPaiseAsInr,
  getPreviousMonthPeriod,
  type PaymentDueStatementSource,
} from './payment-due-statement.ts'

const source: PaymentDueStatementSource = {
  snapshotAt: '2026-09-06T04:30:00.000Z',
  clinic: { name: 'Sample Clinic' },
  patient: { id: 'patient-1', name: 'Sample Patient' },
  appointments: [
    {
      id: 'regular-aug', date: '2026-08-01', time: '09:00:00', type: 'Clinic session', status: 'completed',
      chargeId: 'charge-aug', chargeAmount: '800.00', chargeStatus: 'posted', packageId: null, packageLifecycle: null,
      applications: [{ amount: '300.00', status: 'active' }],
    },
    {
      id: 'regular-jul', date: '2026-07-31', time: '09:00:00', type: 'Clinic session', status: 'completed',
      chargeId: 'charge-jul', chargeAmount: '900.00', chargeStatus: 'posted', packageId: null, packageLifecycle: null,
      applications: [],
    },
    {
      id: 'package-1', date: '2026-08-25', time: '11:00:00', type: 'Package session', status: 'completed',
      chargeId: 'charge-package-1', chargeAmount: '800.00', chargeStatus: 'posted', packageId: 'pkg-1', packageLifecycle: 'availed',
      applications: [{ amount: '500.00', status: 'active' }],
    },
    {
      id: 'package-2', date: '2026-07-20', time: '11:00:00', type: 'Package session', status: 'completed',
      chargeId: 'charge-package-2', chargeAmount: '800.00', chargeStatus: 'posted', packageId: 'pkg-1', packageLifecycle: 'availed',
      applications: [{ amount: '800.00', status: 'active' }],
    },
    {
      id: 'package-zero', date: '2026-08-28', time: '11:00:00', type: 'Package session', status: 'completed',
      chargeId: 'charge-package-zero', chargeAmount: '0.00', chargeStatus: 'posted', packageId: 'pkg-1', packageLifecycle: 'availed',
      applications: [],
    },
    {
      id: 'package-scheduled', date: '2026-09-10', time: '11:00:00', type: 'Package session', status: 'scheduled',
      chargeId: 'charge-package-scheduled', chargeAmount: '800.00', chargeStatus: 'pending', packageId: 'pkg-1', packageLifecycle: 'scheduled',
      applications: [],
    },
    {
      id: 'regular-scheduled', date: '2026-09-11', time: '09:00:00', type: 'Clinic session', status: 'scheduled',
      chargeId: 'charge-scheduled', chargeAmount: '900.00', chargeStatus: 'pending', packageId: null, packageLifecycle: null,
      applications: [],
    },
    {
      id: 'regular-paid', date: '2026-08-03', time: '09:00:00', type: 'Clinic session', status: 'completed',
      chargeId: 'charge-paid', chargeAmount: '500.00', chargeStatus: 'posted', packageId: null, packageLifecycle: null,
      applications: [{ amount: '500.00', status: 'active' }],
    },
  ],
  packages: [
    {
      id: 'pkg-1', name: 'Physiotherapy package', createdAt: '2026-07-01T00:00:00.000Z',
      quoteAmount: '8000.00', netReceived: '2400.00', totalSessions: 10,
    },
  ],
}

test('calculates partial regular-session due without including scheduled or paid sessions', () => {
  const statement = buildPaymentDueStatement(source, {
    regularScope: 'all_due',
    generatedAt: new Date('2026-09-06T04:30:00.000Z'),
  })

  assert.deepEqual(statement.regular?.rows.map((row) => [row.id, row.duePaise]), [
    ['regular-jul', 90000],
    ['regular-aug', 50000],
  ])
  assert.equal(statement.regular?.totalDuePaise, 140000)
  assert.equal(statement.regular?.rows.some((row) => row.id === 'regular-scheduled'), false)
  assert.equal(statement.regular?.rows.some((row) => row.id === 'regular-paid'), false)
})

test('previous-month scope filters regular rows by clinic calendar month only', () => {
  const statement = buildPaymentDueStatement(source, {
    regularScope: 'previous_month',
    periodMonth: '2026-08',
    generatedAt: new Date('2026-09-06T04:30:00.000Z'),
  })

  assert.deepEqual(statement.regular?.rows.map((row) => row.id), ['regular-aug'])
  assert.equal(statement.regular?.periodLabel, 'August 2026 · completed regular sessions with payment pending')
  assert.deepEqual(statement.packages[0]?.completedSessions.map((session) => session.date), ['2026-07-20', '2026-08-25', '2026-08-28'])
})

test('package sessions left ignores scheduled reservations and package history is independent of regular scope', () => {
  const allDue = buildPaymentDueStatement(source, { regularScope: 'all_due', generatedAt: new Date('2026-09-06T04:30:00.000Z') })
  const previous = buildPaymentDueStatement(source, { regularScope: 'previous_month', periodMonth: '2026-08', generatedAt: new Date('2026-09-06T04:30:00.000Z') })

  assert.equal(allDue.packages[0]?.sessionsLeft, 7)
  assert.equal(allDue.packages[0]?.totalSessions, 10)
  assert.deepEqual(allDue.packages[0]?.completedSessions, previous.packages[0]?.completedSessions)
  assert.equal(allDue.packages[0]?.duePaise, 30000)
})

test('omits empty sections and returns an empty statement when no eligible content remains', () => {
  const regularOnly = buildPaymentDueStatement({ ...source, packages: [], appointments: source.appointments.filter((row) => !row.packageId) }, { regularScope: 'all_due', generatedAt: new Date('2026-09-06T04:30:00.000Z') })
  assert.ok(regularOnly.regular)
  assert.equal(regularOnly.packages.length, 0)

  // Fully applied charges settle the regular section, but a package with completed sessions is
  // still reportable history, so the statement is not empty.
  const settled = buildPaymentDueStatement({ ...source, appointments: source.appointments.map((row) => ({ ...row, applications: [{ amount: row.chargeAmount, status: 'active' as const }] })) }, { regularScope: 'all_due', generatedAt: new Date('2026-09-06T04:30:00.000Z') })
  assert.equal(settled.regular, null)
  assert.equal(settled.packages.length, 1)
  assert.equal(settled.totalDuePaise, 0)
  assert.equal(settled.isEmpty, false)
})

test('rejects malformed or over-applied money instead of producing a plausible total', () => {
  assert.throws(() => buildPaymentDueStatement({ ...source, appointments: [{ ...source.appointments[0], applications: [{ amount: '900.00', status: 'active' }] }] }, { regularScope: 'all_due', generatedAt: new Date('2026-09-06T04:30:00.000Z') }), /exceed charge/i)
  assert.throws(() => buildPaymentDueStatement({ ...source, appointments: [{ ...source.appointments[0], chargeAmount: 'oops' }] }, { regularScope: 'all_due', generatedAt: new Date('2026-09-06T04:30:00.000Z') }), /money/i)
  assert.throws(() => buildPaymentDueStatement({ ...source, appointments: [{ ...source.appointments[0], date: '2026-02-30' }] }, { regularScope: 'all_due', generatedAt: new Date('2026-09-06T04:30:00.000Z') }), /date/i)
})

test('derives the previous month including year across January rollover', () => {
  assert.deepEqual(getPreviousMonthPeriod(new Date('2027-01-02T04:30:00.000Z')), {
    periodMonth: '2026-12',
    periodLabel: 'December 2026',
    startDate: '2026-12-01',
    endDate: '2026-12-31',
  })
})

test('keeps a fully paid package so a prepaid package-only patient still gets a statement', () => {
  const packageOnly: PaymentDueStatementSource = {
    ...source,
    appointments: source.appointments
      .filter((row) => row.packageId)
      .map((row) => ({ ...row, applications: [{ amount: row.chargeAmount, status: 'active' as const }] })),
  }
  const statement = buildPaymentDueStatement(packageOnly, { regularScope: 'all_due', generatedAt: new Date('2026-09-06T04:30:00.000Z') })

  assert.equal(statement.regular, null)
  assert.equal(statement.packages.length, 1)
  assert.equal(statement.packages[0]?.duePaise, 0)
  assert.deepEqual(statement.packages[0]?.completedSessions.map((session) => session.date), ['2026-07-20', '2026-08-25', '2026-08-28'])
  assert.equal(statement.totalDuePaise, 0)
  assert.equal(statement.isEmpty, false)
})

test('drops a package with no completed sessions and stays empty when nothing is left to report', () => {
  const nothing = buildPaymentDueStatement({
    ...source,
    appointments: source.appointments
      .filter((row) => !row.packageId)
      .map((row) => ({ ...row, applications: [{ amount: row.chargeAmount, status: 'active' as const }] })),
  }, { regularScope: 'all_due', generatedAt: new Date('2026-09-06T04:30:00.000Z') })

  assert.equal(nothing.regular, null)
  assert.equal(nothing.packages.length, 0)
  assert.equal(nothing.isEmpty, true)
})

test('formats money without ₹ because the PDF standard font has no rupee glyph', () => {
  assert.equal(formatPaiseAsInr(600000), 'Rs. 6,000.00')
  assert.equal(formatPaiseAsInr(0), 'Rs. 0.00')
  assert.equal(formatPaiseAsInr(12345678), 'Rs. 1,23,456.78')
})
