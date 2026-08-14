export function PaymentBadge({ status }: { status?: string }) {
  if (!status) return null
  const map: Record<string, { cls: string; label: string }> = {
    paid:    { cls: 'ok',   label: 'Paid' },
    prepaid: { cls: 'info', label: 'Prepaid' },
    partially_prepaid: { cls: 'info', label: 'Partially prepaid' },
    partially_paid: { cls: 'warn', label: 'Partially paid' },
    unpaid:  { cls: 'warn', label: 'Due' },
  }
  const m = map[status] ?? { cls: '', label: status }
  return (
    <span className={`ph-badge ${m.cls}`}>
      <span className="ph-badge-dot" />
      {m.label}
    </span>
  )
}

export function StatusBadge({ status }: { status?: string }) {
  if (!status) return null
  const map: Record<string, { cls: string; label: string }> = {
    completed: { cls: 'ok',     label: 'Done' },
    scheduled: { cls: 'accent', label: 'Scheduled' },
    cancelled: { cls: '',       label: 'Cancelled' },
  }
  const m = map[status] ?? { cls: '', label: status }
  return <span className={`ph-badge ${m.cls}`}>{m.label}</span>
}
