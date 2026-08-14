export type V2PatientBalanceInput = {
  patient_id: string
  quote_amount: number
  net_received: number
  applied_amount: number
  due_amount: number
  refundable_credit: number
}

export type V2PackageBalanceInput = {
  patient_id: string
  due_amount: number
  refundable_credit: number
}

export type V2PaymentBalanceRow = {
  patientId: string
  patientName: string
  ordinaryDue: number
  ordinaryCredit: number
  packageDue: number
  packageCredit: number
  totalDue: number
  totalCredit: number
  direction: 'due' | 'credit'
}

export function buildV2PaymentBalanceRows({
  patients,
  patientBalances,
  packageBalances,
}: {
  patients: { id: string; name: string }[]
  patientBalances: V2PatientBalanceInput[]
  packageBalances: V2PackageBalanceInput[]
}): V2PaymentBalanceRow[] {
  const names = new Map(patients.map((patient) => [patient.id, patient.name]))
  const packageTotals = new Map<string, { due: number; credit: number }>()
  for (const balance of packageBalances) {
    const current = packageTotals.get(balance.patient_id) ?? { due: 0, credit: 0 }
    current.due += Number(balance.due_amount ?? 0)
    current.credit += Number(balance.refundable_credit ?? 0)
    packageTotals.set(balance.patient_id, current)
  }

  return patientBalances
    .map((balance) => {
      const scoped = packageTotals.get(balance.patient_id) ?? { due: 0, credit: 0 }
      const totalDue = Number(balance.due_amount ?? 0)
      const totalCredit = Number(balance.refundable_credit ?? 0)
      return {
        patientId: balance.patient_id,
        patientName: names.get(balance.patient_id) ?? 'Unknown patient',
        ordinaryDue: Math.max(0, totalDue - scoped.due),
        ordinaryCredit: Math.max(0, totalCredit - scoped.credit),
        packageDue: scoped.due,
        packageCredit: scoped.credit,
        totalDue,
        totalCredit,
        direction: totalDue > 0 ? 'due' as const : 'credit' as const,
      }
    })
    .filter((row) => row.totalDue > 0 || row.totalCredit > 0)
    .sort((left, right) => right.totalDue - left.totalDue || right.totalCredit - left.totalCredit || left.patientName.localeCompare(right.patientName))
}
