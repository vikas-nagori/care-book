export type PaymentCandidate = {
  id: string
  patient_id: string
  date: string
  status: 'scheduled' | 'completed' | 'cancelled'
  payment_status: 'unpaid' | 'prepaid' | 'partially_prepaid' | 'paid' | 'partially_paid'
  fee: number | null
  type?: string
}

type CandidateParams = {
  appointments: PaymentCandidate[]
  patientId: string
  today: string
}

type CoverageParams = {
  amount: number
  candidates: PaymentCandidate[]
}

type AllocationPreviewParams = {
  appointments: PaymentCandidate[]
  patientId: string
  amount: number
  today: string
  // Unspent credit already sitting on the patient's earlier payments. Under the pooled
  // FIFO model (migration 014) this is consumed before the new amount, so it shifts which
  // sessions the new payment actually covers. Defaults to 0.
  existingCredit?: number
}

type PackageSessionCandidateParams = {
  appointments: PaymentCandidate[]
  patientId: string
}

function hasPositiveFee(appointment: PaymentCandidate) {
  return Number(appointment.fee) > 0
}

function sortByDate(left: PaymentCandidate, right: PaymentCandidate) {
  return left.date.localeCompare(right.date)
}

function getCoverableSessions<T extends PaymentCandidate>({
  amount,
  candidates,
}: Omit<CoverageParams, 'candidates'> & { candidates: T[] }) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      covered: [] as T[],
      total: 0,
      remaining: Math.max(0, Number.isFinite(amount) ? amount : 0),
    }
  }

  let remainingAmount = amount
  let total = 0
  const covered: T[] = []

  for (const candidate of candidates) {
    const fee = Number(candidate.fee)
    if (!Number.isFinite(fee) || fee <= 0) continue
    if (fee > remainingAmount) break

    covered.push(candidate)
    remainingAmount -= fee
    total += fee
  }

  return {
    covered,
    total,
    remaining: remainingAmount,
  }
}

export function getPaymentCandidates<T extends PaymentCandidate>({
  appointments,
  patientId,
  today,
}: Omit<CandidateParams, 'appointments'> & { appointments: T[] }) {
  // Packages are prepaid-only: candidates are the patient's upcoming unpaid scheduled sessions.
  return appointments
    .filter((appointment) => {
      if (appointment.patient_id !== patientId) return false
      if (appointment.payment_status !== 'unpaid') return false
      if (!hasPositiveFee(appointment)) return false

      return appointment.status === 'scheduled' && appointment.date >= today
    })
    .sort(sortByDate)
}

export function getSessionsToCover<T extends PaymentCandidate>({
  amount,
  candidates,
}: Omit<CoverageParams, 'candidates'> & { candidates: T[] }) {
  return getCoverableSessions({ amount, candidates }).covered
}

export function sumAppointmentFees<T extends PaymentCandidate>(appointments: T[]) {
  return appointments.reduce((total, appointment) => total + Number(appointment.fee ?? 0), 0)
}

export function getPaymentAllocationPreview<T extends PaymentCandidate>({
  appointments,
  patientId,
  amount,
  today,
  existingCredit = 0,
}: Omit<AllocationPreviewParams, 'appointments'> & { appointments: T[] }) {
  const completedCandidates = appointments
    .filter((appointment) => {
      return (
        appointment.patient_id === patientId &&
        appointment.status === 'completed' &&
        appointment.payment_status === 'unpaid' &&
        hasPositiveFee(appointment)
      )
    })
    .sort(sortByDate)

  const scheduledCandidates = appointments
    .filter((appointment) => {
      return (
        appointment.patient_id === patientId &&
        appointment.status === 'scheduled' &&
        appointment.payment_status === 'unpaid' &&
        appointment.date >= today &&
        hasPositiveFee(appointment)
      )
    })
    .sort(sortByDate)

  // Coverage funded by `total` credit: completed sessions first, then upcoming ones.
  function simulate(total: number) {
    const outstanding = getCoverableSessions({ amount: total, candidates: completedCandidates })
    const prepaid = getCoverableSessions({
      amount: outstanding.remaining,
      candidates: scheduledCandidates,
    })
    return { outstanding: outstanding.covered, prepaid: prepaid.covered, remaining: prepaid.remaining }
  }

  const base = Math.max(0, Number.isFinite(existingCredit) ? existingCredit : 0)
  // FIFO: older unspent credit is consumed first, so the new payment covers whatever the
  // pooled (existing + new) credit reaches beyond what existing credit alone would cover.
  const before = simulate(base)
  const after = simulate(base + (Number.isFinite(amount) ? amount : 0))

  const beforeOutstandingIds = new Set(before.outstanding.map((appointment) => appointment.id))
  const beforePrepaidIds = new Set(before.prepaid.map((appointment) => appointment.id))

  const outstandingSessions = after.outstanding.filter((a) => !beforeOutstandingIds.has(a.id))
  const prepaidSessions = after.prepaid.filter((a) => !beforePrepaidIds.has(a.id))

  const outstandingTotal = sumAppointmentFees(outstandingSessions)
  const prepaidTotal = sumAppointmentFees(prepaidSessions)

  return {
    outstandingSessions,
    prepaidSessions,
    outstandingTotal,
    prepaidTotal,
    allocatedTotal: outstandingTotal + prepaidTotal,
    // Patient's total advance credit left over once this payment is pooled in.
    remainingCredit: after.remaining,
  }
}

export function calculatePackageTotal(totalSessions: number, perSessionAmount: number) {
  if (
    !Number.isFinite(totalSessions) ||
    !Number.isFinite(perSessionAmount) ||
    totalSessions <= 0 ||
    perSessionAmount < 0
  ) {
    return 0
  }

  return totalSessions * perSessionAmount
}

export function getPackageSessionCandidates<T extends PaymentCandidate>({
  appointments,
  patientId,
}: Omit<PackageSessionCandidateParams, 'appointments'> & { appointments: T[] }) {
  return appointments
    .filter((appointment) => {
      return (
        appointment.patient_id === patientId &&
        (appointment.status === 'completed' || appointment.status === 'scheduled') &&
        hasPositiveFee(appointment)
      )
    })
    .sort(sortByDate)
}
