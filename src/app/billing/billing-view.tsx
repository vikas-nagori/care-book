'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { Loader2, Plus, IndianRupee, Receipt, AlertCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import {
  buildBillingTimelineItems,
  type BillingTimelinePackage,
  type BillingTimelinePayment,
} from '@/lib/billing/unified-billing'
import type { PaymentDueRow } from '@/lib/billing/payment-due'
import { BillingEntryForm } from './billing-entry-form'

type TabId = 'overview' | 'payment_due' | 'payments' | 'packages'

interface BillingViewProps {
  packages: BillingTimelinePackage[]
  packagesTotalCount: number
  payments: BillingTimelinePayment[]
  paymentsTotalCount: number
  pageSize: number
  patients: { id: string; name: string }[]
  appointments: {
    id: string
    patient_id: string
    date: string
    time: string
    status: 'scheduled' | 'completed' | 'cancelled'
    payment_status: 'unpaid' | 'prepaid' | 'paid'
    fee: number | null
    type: 'home_visit' | 'clinic'
  }[]
  linkedSessionCounts: Record<string, number>
  patientCredit: Record<string, number>
  paymentDueRows: PaymentDueRow[]
  billedThisMonth: number
  billedLastMonth: number
  billedLastMonthLabel: string
  receivedThisMonth: number
}

function Money({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`ph-money ${className}`}>
      <span className="rs">₹</span>
      {n.toLocaleString('en-IN')}
    </span>
  )
}

export function BillingView({
  packages: initialPackages,
  packagesTotalCount,
  payments: initialPayments,
  paymentsTotalCount,
  pageSize,
  patients,
  appointments,
  linkedSessionCounts,
  patientCredit,
  paymentDueRows,
  billedThisMonth,
  billedLastMonth,
  billedLastMonthLabel,
  receivedThisMonth,
}: BillingViewProps) {
  const router = useRouter()
  const [entryOpen, setEntryOpen] = useState(false)
  const [tab, setTab] = useState<TabId>('overview')
  const [packages, setPackages] = useState(initialPackages)
  const [payments, setPayments] = useState(initialPayments)
  const [loadingMorePayments, setLoadingMorePayments] = useState(false)
  const [loadingMorePackages, setLoadingMorePackages] = useState(false)

  async function loadMorePayments() {
    setLoadingMorePayments(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('payments')
      .select('*, patient:patients(id, name), package:packages(id, name)')
      .order('date', { ascending: false })
      .range(payments.length, payments.length + pageSize - 1)
    if (data) setPayments((prev) => [...prev, ...(data as BillingTimelinePayment[])])
    setLoadingMorePayments(false)
  }

  async function loadMorePackages() {
    setLoadingMorePackages(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('packages')
      .select('*, patient:patients(id, name)')
      .order('created_at', { ascending: false })
      .range(packages.length, packages.length + pageSize - 1)
    if (data) setPackages((prev) => [...prev, ...(data as BillingTimelinePackage[])])
    setLoadingMorePackages(false)
  }

  const paymentDueTotal = paymentDueRows.reduce((total, row) => total + row.netDue, 0)
  const activePackages = packages.filter((p) => p.status === 'active')

  const timelineItems = useMemo(
    () => buildBillingTimelineItems({ packages, payments, linkedSessionCounts }),
    [packages, payments, linkedSessionCounts],
  )

  const recentPaymentItems = timelineItems.filter((i) => i.type === 'payment_recorded')
  const packageItems       = timelineItems.filter((i) => i.type === 'package_created')

  const pkgStatusCls: Record<string, string> = {
    active: 'ok', completed: 'info', cancelled: 'bad',
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'payment_due', label: 'Payment Due' },
    { id: 'payments', label: 'Payments' },
    { id: 'packages', label: 'Packages' },
  ]

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
            Billing
          </h1>
          <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }}>
            {format(new Date(), 'MMMM yyyy')}
          </div>
        </div>
        <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
          <DialogTrigger asChild>
            <button style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12.5, fontWeight: 500, padding: '7px 12px',
              borderRadius: 6, border: '1px solid var(--ph-accent)',
              background: 'var(--ph-accent)', color: '#fff', cursor: 'pointer',
              minHeight: 44,
            }}>
              <Plus size={14} />New billing entry
            </button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader><DialogTitle>New Billing Entry</DialogTitle></DialogHeader>
            <BillingEntryForm
              patients={patients}
              packages={packages}
              appointments={appointments}
              patientCredit={patientCredit}
              onSuccess={() => { setEntryOpen(false); router.refresh() }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-5">
        <div className="ph-stat">
          <div className="ph-stat-label"><IndianRupee size={13} /><span>Total billed</span></div>
          <div className="ph-stat-value"><Money n={billedThisMonth} /></div>
          <div className="ph-stat-meta">this month</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><Receipt size={13} /><span>Received</span></div>
          <div className="ph-stat-value" style={{ color: 'var(--ph-ok)' }}><Money n={receivedThisMonth} /></div>
          <div className="ph-stat-meta">this month</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><AlertCircle size={13} /><span>Outstanding</span></div>
          <div className="ph-stat-value" style={{ color: paymentDueTotal > 0 ? 'var(--ph-warn)' : undefined }}>
            <Money n={paymentDueTotal} />
          </div>
          <div className="ph-stat-meta">payment due</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><IndianRupee size={13} /><span>Billed last month</span></div>
          <div className="ph-stat-value"><Money n={billedLastMonth} /></div>
          <div className="ph-stat-meta">{billedLastMonthLabel}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="ph-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`ph-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-5 md:grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>

          {/* Recent payments */}
          <div>
            <div className="ph-section-h">
              <h2>Recent payments</h2>
              <button
                onClick={() => setTab('payments')}
                style={{ fontSize: 12, color: 'var(--ph-ink-3)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                All →
              </button>
            </div>
            <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
              {recentPaymentItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
                  No payments yet.
                </div>
              ) : (
                recentPaymentItems.slice(0, 6).map((item, i, arr) => (
                  item.type === 'payment_recorded' && (
                    <div
                      key={`${item.id}`}
                      style={{
                        display: 'grid', gridTemplateColumns: '60px 1fr auto',
                        gap: 12, padding: '12px 16px',
                        borderBottom: i < arr.length - 1 ? '1px solid var(--ph-line)' : 'none',
                        alignItems: 'center', fontSize: 13,
                      }}
                    >
                      <div className="font-mono-data" style={{ fontSize: 11, color: 'var(--ph-ink-4)' }}>
                        {format(parseISO(item.sortDate), 'dd MMM')}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, color: 'var(--ph-ink)' }}>{item.patientName}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
                          {item.paymentMethod}
                          {item.packageName ? ` · ${item.packageName}` : ''}
                        </div>
                      </div>
                      <Money n={item.amount} />
                    </div>
                  )
                ))
              )}
            </div>
          </div>

          {/* Packages summary */}
          <div>
            <div className="ph-section-h">
              <h2>Active packages</h2>
              <button
                onClick={() => setTab('packages')}
                style={{ fontSize: 12, color: 'var(--ph-ink-3)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                All →
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activePackages.slice(0, 4).map((pkg) => {
                const pct = pkg.total_sessions > 0
                  ? Math.min(100, (pkg.used_sessions / pkg.total_sessions) * 100)
                  : 0
                const patientName = (pkg as unknown as { patient?: { name: string } }).patient?.name ?? 'Patient'
                return (
                  <div
                    key={pkg.id}
                    style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '12px 14px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ph-ink)' }}>{patientName}</div>
                        <div style={{ fontSize: 11, color: 'var(--ph-ink-4)', marginTop: 1 }}>{pkg.name}</div>
                      </div>
                      <span className="ph-badge ok">Active</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ph-ink-3)', marginBottom: 6 }}>
                      <span>{pkg.used_sessions}/{pkg.total_sessions} · {Math.max(pkg.total_sessions - pkg.used_sessions, 0)} due</span>
                      <span className="font-mono-data">{Math.round(pct)}%</span>
                    </div>
                    <div className="ph-bar"><span style={{ width: `${pct}%` }} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12.5 }}>
                      <span style={{ color: 'var(--ph-ink-3)' }}>Paid</span>
                      <span><Money n={pkg.paid_amount} className="ok" /></span>
                    </div>
                  </div>
                )
              })}
              {activePackages.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--ph-ink-4)', fontSize: 13, background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10 }}>
                  No active packages.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment due tab */}
      {tab === 'payment_due' && (
        <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
          <div className="hidden md:grid" style={{
            gridTemplateColumns: '1.6fr 100px 120px 120px 120px 160px',
            gap: 14, padding: '10px 16px',
            fontSize: 10.5, color: 'var(--ph-ink-4)',
            textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
            borderBottom: '1px solid var(--ph-line)',
          }}>
            <div>Patient</div>
            <div>Sessions</div>
            <div style={{ textAlign: 'right' }}>Gross Due</div>
            <div style={{ textAlign: 'right' }}>Credit</div>
            <div style={{ textAlign: 'right' }}>Net Due</div>
            <div>Due Range</div>
          </div>
          {paymentDueRows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
              No payment due right now.
            </div>
          ) : (
            paymentDueRows.map((row, index) => (
              <div
                key={row.patientId}
                style={{
                  padding: '12px 16px',
                  borderBottom: index < paymentDueRows.length - 1 ? '1px solid var(--ph-line)' : 'none',
                  fontSize: 13,
                }}
              >
                <div className="hidden md:grid" style={{ gridTemplateColumns: '1.6fr 100px 120px 120px 120px 160px', gap: 14, alignItems: 'center' }}>
                  <div style={{ fontWeight: 500 }}>{row.patientName}</div>
                  <div className="font-mono-data" style={{ color: 'var(--ph-ink-3)' }}>{row.unpaidSessionCount}</div>
                  <div style={{ textAlign: 'right' }}><Money n={row.grossDue} /></div>
                  <div style={{ textAlign: 'right', color: row.unspentCredit > 0 ? 'var(--ph-ok)' : undefined }}>
                    <Money n={row.unspentCredit} />
                  </div>
                  <div style={{ textAlign: 'right', color: 'var(--ph-warn)', fontWeight: 600 }}>
                    <Money n={row.netDue} />
                  </div>
                  <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                    {format(parseISO(row.oldestDueDate), 'dd MMM')}
                    {row.latestDueDate !== row.oldestDueDate ? ` - ${format(parseISO(row.latestDueDate), 'dd MMM')}` : ''}
                  </div>
                </div>
                <div className="md:hidden space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div style={{ fontWeight: 500 }}>{row.patientName}</div>
                      <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
                        {row.unpaidSessionCount} session{row.unpaidSessionCount === 1 ? '' : 's'} · {format(parseISO(row.oldestDueDate), 'dd MMM')}
                        {row.latestDueDate !== row.oldestDueDate ? ` - ${format(parseISO(row.latestDueDate), 'dd MMM')}` : ''}
                      </div>
                    </div>
                    <Money n={row.netDue} className="warn" />
                  </div>
                  <div className="flex justify-between text-xs" style={{ color: 'var(--ph-ink-4)' }}>
                    <span>Gross <Money n={row.grossDue} /></span>
                    <span>Credit <Money n={row.unspentCredit} /></span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Payments tab */}
      {tab === 'payments' && (
        <>
          <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
            <div className="hidden md:grid" style={{
              gridTemplateColumns: '80px 1.6fr 1.4fr 100px 110px',
              gap: 14, padding: '10px 16px',
              fontSize: 10.5, color: 'var(--ph-ink-4)',
              textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
              borderBottom: '1px solid var(--ph-line)',
            }}>
              <div>Date</div><div>Patient</div><div>For</div><div>Method</div><div style={{ textAlign: 'right' }}>Amount</div>
            </div>
            {recentPaymentItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
                No payments recorded yet.
              </div>
            ) : (
              recentPaymentItems.map((item, i, arr) =>
                item.type === 'payment_recorded' ? (
                  <div
                    key={item.id}
                    style={{
                      padding: '12px 16px',
                      borderBottom: i < arr.length - 1 ? '1px solid var(--ph-line)' : 'none',
                      fontSize: 13,
                    }}
                  >
                    <div className="hidden md:grid" style={{ gridTemplateColumns: '80px 1.6fr 1.4fr 100px 110px', gap: 14, alignItems: 'center' }}>
                      <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                        {format(parseISO(item.sortDate), 'dd MMM')}
                      </div>
                      <div style={{ fontWeight: 500 }}>{item.patientName}</div>
                      <div style={{ fontSize: 12, color: 'var(--ph-ink-3)' }}>
                        {item.packageName ?? 'Session'}
                        {item.notes ? ` · ${item.notes}` : ''}
                      </div>
                      <div style={{ fontSize: 12, textTransform: 'capitalize' }}>{item.paymentMethod}</div>
                      <div style={{ textAlign: 'right' }}><Money n={item.amount} /></div>
                    </div>
                    {/* Mobile row */}
                    <div className="md:hidden flex justify-between gap-3">
                      <div>
                        <div style={{ fontWeight: 500 }}>{item.patientName}</div>
                        <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
                          {format(parseISO(item.sortDate), 'dd MMM')} · {item.paymentMethod}
                          {item.packageName ? ` · ${item.packageName}` : ''}
                        </div>
                      </div>
                      <Money n={item.amount} />
                    </div>
                  </div>
                ) : null
              )
            )}
          </div>
          {payments.length < paymentsTotalCount && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <button
                onClick={loadMorePayments}
                disabled={loadingMorePayments}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 13, fontWeight: 500, padding: '8px 20px',
                  borderRadius: 8, border: '1px solid var(--ph-line)',
                  background: 'var(--ph-surface)', color: 'var(--ph-ink-2)',
                  cursor: loadingMorePayments ? 'not-allowed' : 'pointer',
                  opacity: loadingMorePayments ? 0.6 : 1,
                }}
              >
                {loadingMorePayments ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : `Load more (${paymentsTotalCount - payments.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Packages tab */}
      {tab === 'packages' && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {packageItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13, background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, gridColumn: '1/-1' }}>
                No packages created yet.
              </div>
            ) : (
              packageItems.map((item) => {
                if (item.type !== 'package_created') return null
                const pct = item.totalSessions > 0
                  ? Math.min(100, (item.usedSessions / item.totalSessions) * 100)
                  : 0
                return (
                  <div
                    key={item.id}
                    style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '14px 16px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ph-ink)' }}>{item.patientName}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>{item.packageName}</div>
                      </div>
                      <span className={`ph-badge ${pkgStatusCls[item.status] ?? ''}`}>{item.status}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ph-ink-3)', marginBottom: 6 }}>
                      <span>{item.usedSessions} availed · {Math.max(item.totalSessions - item.usedSessions, 0)} due · {item.totalSessions} total</span>
                      <span className="font-mono-data">{Math.round(pct)}%</span>
                    </div>
                    <div className="ph-bar" style={{ marginBottom: 10 }}><span style={{ width: `${pct}%` }} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                      <span style={{ color: 'var(--ph-ink-3)' }}>Total / Paid</span>
                      <span>
                        <Money n={item.totalAmount} /> / <Money n={item.paidAmount} className="ok" />
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ph-ink-4)', marginTop: 6 }}>
                      {format(new Date(item.sortDate), 'dd MMM yyyy')} · {item.paymentTiming}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          {packages.length < packagesTotalCount && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <button
                onClick={loadMorePackages}
                disabled={loadingMorePackages}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 13, fontWeight: 500, padding: '8px 20px',
                  borderRadius: 8, border: '1px solid var(--ph-line)',
                  background: 'var(--ph-surface)', color: 'var(--ph-ink-2)',
                  cursor: loadingMorePackages ? 'not-allowed' : 'pointer',
                  opacity: loadingMorePackages ? 0.6 : 1,
                }}
              >
                {loadingMorePackages ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : `Load more (${packagesTotalCount - packages.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
