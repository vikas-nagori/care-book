import { createHash } from 'node:crypto'

export type FundingScope = 'ordinary' | 'package'
export type ReceiptStatus = 'posted' | 'voided'
export type AppointmentPaymentStatus = 'unpaid' | 'prepaid' | 'partially_prepaid' | 'paid' | 'partially_paid'

export interface BillingImpactInput {
  clinics: Array<{ id: string; name: string }>
  patients: Array<{ id: string; clinicId: string; name: string }>
  appointmentTypes: Array<{
    id: string; clinicId: string; name: string; isDefault?: boolean; isShared?: boolean; sortOrder?: number
  }>
  appointments: Array<{
    id: string; clinicId: string; patientId: string; appointmentTypeId?: string | null
    date: string; time: string; status: string; fee: number; paymentStatus?: string | null; createdAt: string
  }>
  packages: Array<{
    id: string; clinicId: string; patientId: string; name: string; totalSessions: number
    usedSessions: number; totalAmount: number; perSessionAmount: number; paidAmount: number
    status: string; appointmentTypeId?: string | null; startsOn?: string | null; createdAt: string
  }>
  payments: BillingImpactPayment[]
  appointmentPayments: Array<{
    paymentId: string; appointmentId: string; amountApplied: number; createdAt: string
  }>
  packageSessionAllocations: Array<{
    packageId: string; appointmentId: string; lifecycle?: string | null; createdAt?: string
  }>
  refunds?: BillingImpactRefund[]
  refundReversals?: Array<{ id: string; refundId: string; createdAt: string }>
}

export interface BillingImpactPayment {
  id: string; clinicId: string; patientId: string; packageId?: string | null; amount: number
  paymentMethod: string; date: string; createdAt: string; fundingScope?: FundingScope
  status?: ReceiptStatus
}

export interface BillingImpactRefund {
  id: string; clinicId: string; patientId: string; paymentId: string; amount: number
  refundMethod: string; refundDate: string; reason: string; createdAt: string
}

export interface BillingImpactPlan {
  asOfDate: string
  voidPaymentIds?: string[]
  replacementPayments?: BillingImpactPayment[]
  refunds?: BillingImpactRefund[]
  packageOverrides?: Array<{
    packageId: string; startsOn?: string; appointmentTypeId?: string
    totalSessions?: number; totalAmount?: number; perSessionAmount?: number
  }>
  expectedOutcomes?: Array<{
    patientId: string
    ordinary?: Partial<Pick<MoneyImpact, 'due' | 'refundableCredit' | 'netReceived' | 'applied'>>
    packages?: Array<{
      packageId: string
      availed?: number
      scheduled?: number
      remaining?: number
      lifecycle?: 'active' | 'completed' | 'cancelled'
      due?: number
      refundableCredit?: number
    }>
    appointmentBadges?: Array<{ appointmentId: string; expected: AppointmentPaymentStatus }>
  }>
}

export function assertApprovedBillingImpactPlan(plan: BillingImpactPlan): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.asOfDate)) {
    throw new Error('The billing impact report requires an approved as-of date.')
  }
  const operationCount = (plan.voidPaymentIds?.length ?? 0)
    + (plan.replacementPayments?.length ?? 0)
    + (plan.refunds?.length ?? 0)
    + (plan.packageOverrides?.length ?? 0)
  if (operationCount === 0 || (plan.expectedOutcomes?.length ?? 0) === 0) {
    throw new Error('The billing impact report requires approved correction operations and expected outcomes.')
  }
}

export interface BillingImpactReport {
  schemaVersion: 1
  asOfDate: string
  inputFingerprint: string
  planFingerprint: string
  reportChecksum: string
  patients: PatientImpact[]
  invariantFailures: string[]
}

interface MoneyImpact {
  quote: number
  netReceived: number
  applied: number
  due: number
  refundableCredit: number
}

export interface PatientImpact {
  patientId: string
  patientName: string
  clinicId: string
  clinicName: string
  ordinary: MoneyImpact
  packages: Array<MoneyImpact & {
    packageId: string; packageName: string; appointmentTypeId: string | null; startsOn: string
    availed: number; scheduled: number; remaining: number; lifecycle: 'active' | 'completed' | 'cancelled'
  }>
  appointmentBadgeChanges: Array<{
    appointmentId: string; date: string; previous: string; expected: AppointmentPaymentStatus
  }>
  receipts: Array<{
    paymentId: string; date: string; amount: number; fundingScope: FundingScope
    packageId: string | null; status: ReceiptStatus
  }>
  refunds: Array<{
    refundId: string; paymentId: string; refundDate: string; amount: number; reversed: boolean
  }>
}

type AppliedAmount = { ordinary: number; package: number }

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

function sourceFingerprint(input: BillingImpactInput): string {
  const normalized = {
    clinics: byId(input.clinics),
    patients: byId(input.patients),
    appointmentTypes: byId(input.appointmentTypes),
    appointments: byId(input.appointments),
    packages: byId(input.packages),
    payments: byId(input.payments),
    appointmentPayments: [...input.appointmentPayments].sort((a, b) =>
      `${a.paymentId}:${a.appointmentId}`.localeCompare(`${b.paymentId}:${b.appointmentId}`)),
    packageSessionAllocations: [...input.packageSessionAllocations].sort((a, b) =>
      `${a.packageId}:${a.appointmentId}:${a.lifecycle ?? ''}`.localeCompare(`${b.packageId}:${b.appointmentId}:${b.lifecycle ?? ''}`)),
    refunds: byId(input.refunds ?? []),
    refundReversals: byId(input.refundReversals ?? []),
  }
  return checksum(normalized)
}

function approvedPlanFingerprint(plan: BillingImpactPlan): string {
  return checksum({
    ...plan,
    voidPaymentIds: [...(plan.voidPaymentIds ?? [])].sort(),
    replacementPayments: byId(plan.replacementPayments ?? []),
    refunds: byId(plan.refunds ?? []),
    packageOverrides: [...(plan.packageOverrides ?? [])].sort((a, b) => a.packageId.localeCompare(b.packageId)),
    expectedOutcomes: [...(plan.expectedOutcomes ?? [])].sort((a, b) => a.patientId.localeCompare(b.patientId)),
  })
}

function chronological<T extends { date: string; time?: string; createdAt?: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    `${left.date}:${left.time ?? ''}:${left.createdAt ?? ''}:${left.id}`
      .localeCompare(`${right.date}:${right.time ?? ''}:${right.createdAt ?? ''}:${right.id}`))
}

export function buildBillingImpactReport(input: BillingImpactInput, plan: BillingImpactPlan): BillingImpactReport {
  const failures: string[] = []
  const paymentIds = new Set(input.payments.map((payment) => payment.id))
  for (const paymentId of plan.voidPaymentIds ?? []) {
    if (!paymentIds.has(paymentId)) failures.push(`Correction plan payment not found: ${paymentId}`)
  }
  const packageIds = new Set(input.packages.map((pkg) => pkg.id))
  for (const override of plan.packageOverrides ?? []) {
    if (!packageIds.has(override.packageId)) failures.push(`Correction plan package not found: ${override.packageId}`)
  }

  const overrideByPackage = new Map((plan.packageOverrides ?? []).map((override) => [override.packageId, override]))
  const allPayments = [
    ...input.payments.map((payment) => ({
      ...payment,
      packageId: payment.packageId ?? null,
      fundingScope: payment.fundingScope ?? (payment.packageId ? 'package' : 'ordinary') as FundingScope,
      status: (plan.voidPaymentIds ?? []).includes(payment.id) ? 'voided' as const : payment.status ?? 'posted' as const,
    })),
    ...(plan.replacementPayments ?? []).map((payment) => ({
      ...payment,
      packageId: payment.packageId ?? null,
      fundingScope: payment.fundingScope ?? (payment.packageId ? 'package' : 'ordinary') as FundingScope,
      status: payment.status ?? 'posted' as const,
    })),
  ]
  const allRefunds = [...(input.refunds ?? []), ...(plan.refunds ?? [])]
  const reversedRefundIds = new Set((input.refundReversals ?? []).map((reversal) => reversal.refundId))
  const activeRefundByPayment = new Map<string, number>()
  for (const refund of allRefunds) {
    if (!reversedRefundIds.has(refund.id)) {
      activeRefundByPayment.set(refund.paymentId, roundMoney((activeRefundByPayment.get(refund.paymentId) ?? 0) + refund.amount))
    }
  }

  const defaultTypeByClinic = new Map<string, string>()
  for (const clinic of input.clinics) {
    const candidates = input.appointmentTypes
      .filter((type) => type.clinicId === clinic.id)
      .sort((left, right) => {
        const leftRank = left.name === 'Clinic' ? 0 : left.isDefault && left.isShared ? 1 : left.isShared ? 2 : 3
        const rightRank = right.name === 'Clinic' ? 0 : right.isDefault && right.isShared ? 1 : right.isShared ? 2 : 3
        return leftRank - rightRank || (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.id.localeCompare(right.id)
      })
    if (candidates[0]) defaultTypeByClinic.set(clinic.id, candidates[0].id)
  }

  const normalizedPackages = input.packages.map((pkg) => {
    const override = overrideByPackage.get(pkg.id)
    const firstReceiptDate = chronological(
      allPayments.filter((payment) => payment.packageId === pkg.id),
    )[0]?.date
    return {
      ...pkg,
      appointmentTypeId: override?.appointmentTypeId ?? pkg.appointmentTypeId ?? defaultTypeByClinic.get(pkg.clinicId) ?? null,
      startsOn: override?.startsOn ?? pkg.startsOn ?? firstReceiptDate ?? pkg.createdAt.slice(0, 10),
      totalSessions: override?.totalSessions ?? pkg.totalSessions,
      totalAmount: override?.totalAmount ?? pkg.totalAmount,
      perSessionAmount: override?.perSessionAmount ?? pkg.perSessionAmount,
    }
  })

  const appointments = chronological(input.appointments.map((appointment) => ({ ...appointment, date: appointment.date.slice(0, 10) })))
  const activeAppointments = appointments.filter((appointment) =>
    ['scheduled', 'completed'].includes(appointment.status) && appointment.fee > 0)
  const appointmentById = new Map(appointments.map((appointment) => [appointment.id, appointment]))
  const paymentById = new Map(allPayments.map((payment) => [payment.id, payment]))
  const desiredPackageByAppointment = new Map<string, { packageId: string; lifecycle: 'scheduled' | 'availed' }>()
  const packageSessions = new Map<string, string[]>()

  const currentlyProtectedPackageAppointments = new Set<string>()
  for (const allocation of input.packageSessionAllocations) {
    if (allocation.lifecycle === 'released') continue
    const appointment = appointmentById.get(allocation.appointmentId)
    const pkg = normalizedPackages.find((candidate) => candidate.id === allocation.packageId)
    if (appointment && pkg && pkg.status !== 'cancelled' && activeAppointments.includes(appointment)
      && appointment.appointmentTypeId === pkg.appointmentTypeId && appointment.date >= pkg.startsOn) {
      currentlyProtectedPackageAppointments.add(appointment.id)
    }
  }

  const preordinaryApplications = new Map<string, Map<string, number>>()
  const ordinaryPayments = chronological(allPayments.filter((payment) => payment.status === 'posted' && payment.fundingScope === 'ordinary'))
  const ordinaryRemaining = new Map(ordinaryPayments.map((payment) => [
    payment.id,
    Math.max(roundMoney(payment.amount - (activeRefundByPayment.get(payment.id) ?? 0)), 0),
  ]))
  const chargeRemaining = new Map(activeAppointments.map((appointment) => [appointment.id, appointment.fee]))
  function applyOrdinary(paymentId: string, appointmentId: string, requested: number) {
    const amount = roundMoney(Math.min(ordinaryRemaining.get(paymentId) ?? 0, chargeRemaining.get(appointmentId) ?? 0, requested))
    if (amount <= 0) return
    const applications = preordinaryApplications.get(paymentId) ?? new Map<string, number>()
    applications.set(appointmentId, roundMoney((applications.get(appointmentId) ?? 0) + amount))
    preordinaryApplications.set(paymentId, applications)
    ordinaryRemaining.set(paymentId, roundMoney((ordinaryRemaining.get(paymentId) ?? 0) - amount))
    chargeRemaining.set(appointmentId, roundMoney((chargeRemaining.get(appointmentId) ?? 0) - amount))
  }
  for (const legacy of [...input.appointmentPayments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const payment = paymentById.get(legacy.paymentId)
    const appointment = appointmentById.get(legacy.appointmentId)
    if (payment?.status === 'posted' && payment.fundingScope === 'ordinary'
      && appointment?.patientId === payment.patientId && appointment.clinicId === payment.clinicId) {
      applyOrdinary(payment.id, legacy.appointmentId, legacy.amountApplied)
    }
  }
  for (const payment of ordinaryPayments) {
    for (const appointment of activeAppointments) {
      if (appointment.patientId !== payment.patientId || appointment.clinicId !== payment.clinicId) continue
      if (currentlyProtectedPackageAppointments.has(appointment.id)) continue
      applyOrdinary(payment.id, appointment.id, Number.POSITIVE_INFINITY)
      if ((ordinaryRemaining.get(payment.id) ?? 0) <= 0) break
    }
  }

  const sortedPackages = [...normalizedPackages].sort((left, right) =>
    `${left.createdAt}:${left.id}`.localeCompare(`${right.createdAt}:${right.id}`))
  for (const pkg of sortedPackages) {
    if (pkg.status === 'cancelled') continue
    const eligible = activeAppointments.filter((appointment) =>
      appointment.patientId === pkg.patientId
      && appointment.clinicId === pkg.clinicId
      && appointment.appointmentTypeId === pkg.appointmentTypeId
      && appointment.date >= pkg.startsOn
      && !desiredPackageByAppointment.has(appointment.id)
      && [...preordinaryApplications.values()].every((applications) => (applications.get(appointment.id) ?? 0) === 0))
      .slice(0, pkg.totalSessions)
    packageSessions.set(pkg.id, eligible.map((appointment) => appointment.id))
    for (const appointment of eligible) {
      desiredPackageByAppointment.set(appointment.id, {
        packageId: pkg.id,
        lifecycle: appointment.status === 'completed' ? 'availed' : 'scheduled',
      })
    }
  }

  const appliedByAppointment = new Map<string, AppliedAmount>()
  const appliedByPayment = new Map<string, number>()
  function recordApplication(paymentId: string, appointmentId: string, scope: FundingScope, amount: number) {
    if (amount <= 0) return
    const applied = appliedByAppointment.get(appointmentId) ?? { ordinary: 0, package: 0 }
    applied[scope] = roundMoney(applied[scope] + amount)
    appliedByAppointment.set(appointmentId, applied)
    appliedByPayment.set(paymentId, roundMoney((appliedByPayment.get(paymentId) ?? 0) + amount))
  }
  for (const [paymentId, applications] of preordinaryApplications) {
    for (const [appointmentId, amount] of applications) recordApplication(paymentId, appointmentId, 'ordinary', amount)
  }
  for (const payment of chronological(allPayments.filter((candidate) => candidate.status === 'posted'))) {
    if (payment.fundingScope === 'ordinary') continue
    let remaining = Math.max(roundMoney(payment.amount - (activeRefundByPayment.get(payment.id) ?? 0)), 0)
    for (const appointmentId of packageSessions.get(payment.packageId ?? '') ?? []) {
      const appointment = appointmentById.get(appointmentId)!
      const alreadyApplied = appliedByAppointment.get(appointmentId)
      const chargeDue = Math.max(roundMoney(appointment.fee - (alreadyApplied?.ordinary ?? 0) - (alreadyApplied?.package ?? 0)), 0)
      const amount = Math.min(remaining, chargeDue)
      recordApplication(payment.id, appointmentId, 'package', amount)
      remaining = roundMoney(remaining - amount)
      if (remaining <= 0) break
    }
  }

  const patientReports: PatientImpact[] = []
  for (const patient of [...input.patients].sort((left, right) =>
    `${left.clinicId}:${left.name}:${left.id}`.localeCompare(`${right.clinicId}:${right.name}:${right.id}`))) {
    const patientAppointments = activeAppointments.filter((appointment) => appointment.patientId === patient.id)
    const ordinaryAppointments = patientAppointments.filter((appointment) => !desiredPackageByAppointment.has(appointment.id))
    const ordinaryApplied = roundMoney(ordinaryAppointments.reduce((sum, appointment) =>
      sum + (appliedByAppointment.get(appointment.id)?.ordinary ?? 0), 0))
    const ordinaryQuote = roundMoney(ordinaryAppointments.reduce((sum, appointment) => sum + appointment.fee, 0))
    const patientOrdinaryPayments = allPayments.filter((payment) =>
      payment.patientId === patient.id && payment.status === 'posted' && payment.fundingScope === 'ordinary')
    const ordinaryNetReceived = roundMoney(patientOrdinaryPayments.reduce((sum, payment) =>
      sum + Math.max(payment.amount - (activeRefundByPayment.get(payment.id) ?? 0), 0), 0))

    const packageReports = sortedPackages.filter((pkg) => pkg.patientId === patient.id).map((pkg) => {
      const appointmentIds = packageSessions.get(pkg.id) ?? []
      const sessionAppointments = appointmentIds.map((id) => appointmentById.get(id)!)
      const availed = sessionAppointments.filter((appointment) => appointment.status === 'completed').length
      const scheduled = sessionAppointments.filter((appointment) => appointment.status === 'scheduled').length
      const quote = roundMoney(pkg.totalAmount)
      const activeCharge = roundMoney(sessionAppointments.reduce((sum, appointment) => sum + appointment.fee, 0))
      const applied = roundMoney(sessionAppointments.reduce((sum, appointment) =>
        sum + (appliedByAppointment.get(appointment.id)?.package ?? 0), 0))
      const receipts = allPayments.filter((payment) =>
        payment.packageId === pkg.id && payment.status === 'posted' && payment.fundingScope === 'package')
      const netReceived = roundMoney(receipts.reduce((sum, payment) =>
        sum + Math.max(payment.amount - (activeRefundByPayment.get(payment.id) ?? 0), 0), 0))
      if (appointmentIds.length > pkg.totalSessions) failures.push(`Package ${pkg.id} exceeds its session limit`)
      return {
        packageId: pkg.id,
        packageName: pkg.name,
        appointmentTypeId: pkg.appointmentTypeId,
        startsOn: pkg.startsOn,
        quote,
        netReceived,
        applied,
        due: roundMoney(Math.max(activeCharge - applied, 0)),
        refundableCredit: roundMoney(Math.max(netReceived - applied, 0)),
        availed,
        scheduled,
        remaining: Math.max(pkg.totalSessions - availed - scheduled, 0),
        lifecycle: pkg.status === 'cancelled' ? 'cancelled' as const : availed === pkg.totalSessions ? 'completed' as const : 'active' as const,
      }
    })

    const appointmentBadgeChanges = patientAppointments.flatMap((appointment) => {
      const amounts = appliedByAppointment.get(appointment.id) ?? { ordinary: 0, package: 0 }
      const expected: AppointmentPaymentStatus = amounts.package >= appointment.fee
        ? 'prepaid'
        : amounts.package > 0
          ? 'partially_prepaid'
          : amounts.ordinary >= appointment.fee
            ? 'paid'
            : amounts.ordinary > 0
              ? 'partially_paid'
              : 'unpaid'
      return appointment.paymentStatus === expected ? [] : [{
        appointmentId: appointment.id,
        date: appointment.date,
        previous: appointment.paymentStatus ?? 'unpaid',
        expected,
      }]
    })
    const patientReceipts = chronological(allPayments.filter((payment) => payment.patientId === patient.id)).map((payment) => ({
      paymentId: payment.id,
      date: payment.date,
      amount: payment.amount,
      fundingScope: payment.fundingScope,
      packageId: payment.packageId,
      status: payment.status,
    }))
    const patientRefunds = allRefunds.filter((refund) => refund.patientId === patient.id)
      .sort((left, right) => `${left.refundDate}:${left.id}`.localeCompare(`${right.refundDate}:${right.id}`))
      .map((refund) => ({
        refundId: refund.id,
        paymentId: refund.paymentId,
        refundDate: refund.refundDate,
        amount: refund.amount,
        reversed: reversedRefundIds.has(refund.id),
      }))
    patientReports.push({
      patientId: patient.id,
      patientName: patient.name,
      clinicId: patient.clinicId,
      clinicName: input.clinics.find((clinic) => clinic.id === patient.clinicId)?.name ?? '(unknown clinic)',
      ordinary: {
        quote: ordinaryQuote,
        netReceived: ordinaryNetReceived,
        applied: ordinaryApplied,
        due: roundMoney(Math.max(ordinaryQuote - ordinaryApplied, 0)),
        refundableCredit: roundMoney(Math.max(ordinaryNetReceived - ordinaryApplied, 0)),
      },
      packages: packageReports,
      appointmentBadgeChanges,
      receipts: patientReceipts,
      refunds: patientRefunds,
    })
  }

  for (const appointmentId of desiredPackageByAppointment.keys()) {
    const count = [...packageSessions.values()].filter((ids) => ids.includes(appointmentId)).length
    if (count > 1) failures.push(`Appointment ${appointmentId} is claimed by more than one package`)
  }
  for (const expected of plan.expectedOutcomes ?? []) {
    const patient = patientReports.find((candidate) => candidate.patientId === expected.patientId)
    if (!patient) {
      failures.push(`Expected outcome patient not found: ${expected.patientId}`)
      continue
    }
    for (const [field, expectedValue] of Object.entries(expected.ordinary ?? {})) {
      const calculated = patient.ordinary[field as keyof MoneyImpact]
      if (calculated !== expectedValue) {
        failures.push(`${expected.patientId} ordinary ${field}: expected ${expectedValue}, calculated ${calculated}`)
      }
    }
    for (const expectedPackage of expected.packages ?? []) {
      const pkg = patient.packages.find((candidate) => candidate.packageId === expectedPackage.packageId)
      if (!pkg) {
        failures.push(`${expected.patientId} package not found: ${expectedPackage.packageId}`)
        continue
      }
      for (const [field, expectedValue] of Object.entries(expectedPackage)) {
        if (field === 'packageId') continue
        const calculated = pkg[field as keyof typeof pkg]
        if (calculated !== expectedValue) {
          failures.push(`${expected.patientId} package ${expectedPackage.packageId} ${field}: expected ${expectedValue}, calculated ${calculated}`)
        }
      }
    }
    for (const expectedBadge of expected.appointmentBadges ?? []) {
      const appointment = appointmentById.get(expectedBadge.appointmentId)
      const change = patient.appointmentBadgeChanges.find((candidate) => candidate.appointmentId === expectedBadge.appointmentId)
      const calculated = change?.expected ?? appointment?.paymentStatus ?? 'unpaid'
      if (calculated !== expectedBadge.expected) {
        failures.push(`${expected.patientId} appointment ${expectedBadge.appointmentId} badge: expected ${expectedBadge.expected}, calculated ${calculated}`)
      }
    }
  }
  failures.sort()
  const inputFingerprint = sourceFingerprint(input)
  const planFingerprint = approvedPlanFingerprint(plan)
  const reportWithoutChecksum = {
    schemaVersion: 1 as const,
    asOfDate: plan.asOfDate,
    inputFingerprint,
    planFingerprint,
    patients: patientReports,
    invariantFailures: failures,
  }
  return { ...reportWithoutChecksum, reportChecksum: checksum(reportWithoutChecksum) }
}
