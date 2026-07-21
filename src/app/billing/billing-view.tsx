'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { Loader2, Plus, IndianRupee, Receipt, AlertCircle, ChevronRight, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { createClient } from '@/lib/supabase/client'
import {
  buildBillingTimelineItems,
  type BillingTimelinePackage,
  type BillingTimelinePayment,
} from '@/lib/billing/unified-billing'
import type { PaymentDueRow } from '@/lib/billing/payment-due'
import type { PackageTemplate } from '@/lib/supabase/types'
import { PaginationNav } from '@/components/pagination-nav'
import { BillingEntryForm } from './billing-entry-form'
import { deletePackage, deletePayment } from './actions'

type TabId = 'overview' | 'payment_due' | 'payments' | 'packages'

interface BillingViewProps {
  packages: BillingTimelinePackage[]
  packagesTotalCount: number
  packageTemplates: PackageTemplate[]
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
    type: string
  }[]
  linkedSessionCounts: Record<string, number>
  patientCredit: Record<string, number>
  paymentDueRows: PaymentDueRow[]
  billedThisMonth: number
  billedLastMonth: number
  billedLastMonthLabel: string
  currentMonthLabel: string
  defaultPaymentDate: string
  clinicToday: string
  receivedThisMonth: number
  initialTab?: TabId
  initialEntryOpen: boolean
}

// Rows shown per list tab before "View more" reveals the rest.
const RECENT_LIMIT = 10
// The Payments Balance (Outstanding) tab can list every owing patient, so it gets real pagination.
const PAYMENT_DUE_PAGE_SIZE = 25

function Money({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`ph-money ${className}`}>
      <span className="rs">₹</span>
      {n.toLocaleString('en-IN')}
    </span>
  )
}

function SectionBar({ title, count }: { title: string; count: number }) {
  return (
    <div className="ph-section-h">
      <h2>
        {title}
        <span style={{ color: 'var(--ph-ink-4)', fontWeight: 400 }}> · {count}</span>
      </h2>
    </div>
  )
}

function RevealButton({ label, onClick, loading = false }: { label: string; onClick: () => void; loading?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
      <button
        onClick={onClick}
        disabled={loading}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 500, padding: '8px 20px',
          borderRadius: 8, border: '1px solid var(--ph-line)',
          background: 'var(--ph-surface)', color: 'var(--ph-ink-2)',
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : label}
      </button>
    </div>
  )
}

function DeleteIconButton({ label, onClick }: { label: string; onClick: (event: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-[var(--ph-ink-4)] hover:text-[var(--ph-bad)] hover:bg-[var(--ph-bg-soft)] transition-colors"
    >
      <Trash2 size={15} />
    </button>
  )
}

export function BillingView({
  packages: initialPackages,
  packagesTotalCount,
  packageTemplates,
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
  currentMonthLabel,
  defaultPaymentDate,
  clinicToday,
  receivedThisMonth,
  initialTab = 'overview',
  initialEntryOpen,
}: BillingViewProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [entryOpen, setEntryOpen] = useState(initialEntryOpen)
  const [tab, setTab] = useState<TabId>(initialTab)
  const [packages, setPackages] = useState(initialPackages)
  const [payments, setPayments] = useState(initialPayments)
  const [loadingMorePayments, setLoadingMorePayments] = useState(false)
  const [loadingMorePackages, setLoadingMorePackages] = useState(false)
  const [duePage, setDuePage] = useState(1)
  const [showAllPayments, setShowAllPayments] = useState(false)
  const [showAllPackages, setShowAllPackages] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'payment' | 'package'; id: string; label: string } | null
  >(null)
  const [deleting, setDeleting] = useState(false)
  const cleanBillingUrl = initialTab === 'overview' ? '/billing' : `/billing?tab=${initialTab}`

  function handleEntryOpenChange(open: boolean) {
    setEntryOpen(open)
    if (!open && initialEntryOpen) {
      router.replace(cleanBillingUrl, { scroll: false })
    }
  }

  function handleEntrySuccess() {
    setEntryOpen(false)
    if (initialEntryOpen) {
      router.replace(cleanBillingUrl, { scroll: false })
    }
    router.refresh()
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const { kind, id } = pendingDelete
    const result = kind === 'payment' ? await deletePayment(id) : await deletePackage(id)
    setDeleting(false)

    if (!result.success) {
      toast({
        title: `Could not delete ${kind}`,
        description: result.message,
        variant: 'destructive',
      })
      return
    }

    // Drop the deleted entry locally; balances recompute server-side on refresh.
    if (kind === 'payment') {
      setPayments((prev) => prev.filter((p) => p.id !== id))
    } else {
      setPackages((prev) => prev.filter((p) => p.id !== id))
    }
    setPendingDelete(null)
    toast({
      title: `${kind === 'payment' ? 'Payment' : 'Package'} deleted`,
      description: 'Balances have been recomputed.',
    })
    router.refresh()
  }

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

  // Payments Balance is paginated (25/page); payments & packages keep the recent-10 "View more" reveal.
  const dueTotalPages = Math.max(1, Math.ceil(paymentDueRows.length / PAYMENT_DUE_PAGE_SIZE))
  const safeDuePage = Math.min(Math.max(1, duePage), dueTotalPages)
  const visibleDueRows      = paymentDueRows.slice((safeDuePage - 1) * PAYMENT_DUE_PAGE_SIZE, safeDuePage * PAYMENT_DUE_PAGE_SIZE)
  const visiblePaymentItems = showAllPayments ? recentPaymentItems : recentPaymentItems.slice(0, RECENT_LIMIT)
  const visiblePackageItems = showAllPackages ? packageItems       : packageItems.slice(0, RECENT_LIMIT)

  const pkgStatusCls: Record<string, string> = {
    active: 'ok', completed: 'info', cancelled: 'bad',
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'payment_due', label: 'Payments Balance' },
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
            {currentMonthLabel}
          </div>
        </div>
        <Dialog open={entryOpen} onOpenChange={handleEntryOpenChange}>
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
              packageTemplates={packageTemplates}
              appointments={appointments}
              patientCredit={patientCredit}
              defaultPaymentDate={defaultPaymentDate}
              clinicToday={clinicToday}
              onSuccess={handleEntrySuccess}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats — each drills down to the records behind the figure */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-5">
        <Link href="/billing/metrics/billed-this-month" className="ph-stat ph-stat-link">
          <div className="ph-stat-label"><IndianRupee size={13} /><span>Total billed</span></div>
          <div className="ph-stat-value"><Money n={billedThisMonth} /></div>
          <div className="ph-stat-meta">this month</div>
        </Link>
        <Link href="/billing/metrics/received-this-month" className="ph-stat ph-stat-link">
          <div className="ph-stat-label"><Receipt size={13} /><span>Received</span></div>
          <div className="ph-stat-value" style={{ color: 'var(--ph-ok)' }}><Money n={receivedThisMonth} /></div>
          <div className="ph-stat-meta">this month</div>
        </Link>
        <button type="button" onClick={() => setTab('payment_due')} className="ph-stat ph-stat-link" style={{ textAlign: 'left' }}>
          <div className="ph-stat-label"><AlertCircle size={13} /><span>Outstanding</span></div>
          <div className="ph-stat-value" style={{ color: paymentDueTotal > 0 ? 'var(--ph-warn)' : undefined }}>
            <Money n={paymentDueTotal} />
          </div>
          <div className="ph-stat-meta">payment due</div>
        </button>
        <Link href="/billing/metrics/billed-last-month" className="ph-stat ph-stat-link">
          <div className="ph-stat-label"><IndianRupee size={13} /><span>Billed last month</span></div>
          <div className="ph-stat-value"><Money n={billedLastMonth} /></div>
          <div className="ph-stat-meta">{billedLastMonthLabel}</div>
        </Link>
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
                  <Link
                    key={pkg.id}
                    href={`/billing/packages/${pkg.id}`}
                    className="hover:bg-[var(--ph-bg-soft)]"
                    style={{ display: 'block', background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '12px 14px', textDecoration: 'none', color: 'inherit' }}
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
                  </Link>
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

      {/* Payments Balance tab — owing patients and credit balances, click through to the tally */}
      {tab === 'payment_due' && (
        <>
        <SectionBar title="Payments Balance" count={paymentDueRows.length} />
        <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
          <div className="hidden md:grid" style={{
            gridTemplateColumns: '1.6fr 100px 120px 120px 130px 150px 20px',
            gap: 14, padding: '10px 16px',
            fontSize: 10.5, color: 'var(--ph-ink-4)',
            textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
            borderBottom: '1px solid var(--ph-line)',
          }}>
            <div>Patient</div>
            <div>Sessions</div>
            <div style={{ textAlign: 'right' }}>Gross Due</div>
            <div style={{ textAlign: 'right' }}>Credit</div>
            <div style={{ textAlign: 'right' }}>Balance</div>
            <div>Due Range</div>
            <div />
          </div>
          {paymentDueRows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
              No outstanding balances right now.
            </div>
          ) : (
            visibleDueRows.map((row, index) => {
              const isCredit = row.direction === 'credit'
              const range = row.oldestDueDate
                ? `${format(parseISO(row.oldestDueDate), 'dd MMM')}${row.latestDueDate && row.latestDueDate !== row.oldestDueDate ? ` - ${format(parseISO(row.latestDueDate), 'dd MMM')}` : ''}`
                : '—'
              return (
                <Link
                  key={row.patientId}
                  href={`/billing/payment-due/${row.patientId}`}
                  className="hover:bg-[var(--ph-bg-soft)]"
                  style={{
                    display: 'block',
                    padding: '12px 16px',
                    borderBottom: index < visibleDueRows.length - 1 ? '1px solid var(--ph-line)' : 'none',
                    fontSize: 13, textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <div className="hidden md:grid" style={{ gridTemplateColumns: '1.6fr 100px 120px 120px 130px 150px 20px', gap: 14, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 500 }}>{row.patientName}</span>
                      <span className={`ph-badge ${isCredit ? 'ok' : 'warn'}`} style={{ fontSize: 10 }}>
                        <span className="ph-badge-dot" />{isCredit ? 'Credit' : 'Due'}
                      </span>
                    </div>
                    <div className="font-mono-data" style={{ color: 'var(--ph-ink-3)' }}>{row.unpaidSessionCount}</div>
                    <div style={{ textAlign: 'right' }}><Money n={row.grossDue} /></div>
                    <div style={{ textAlign: 'right', color: row.unspentCredit > 0 ? 'var(--ph-ok)' : undefined }}>
                      <Money n={row.unspentCredit} />
                    </div>
                    <div style={{ textAlign: 'right', color: isCredit ? 'var(--ph-ok)' : 'var(--ph-warn)', fontWeight: 600 }}>
                      <Money n={isCredit ? row.netCredit : row.netDue} />
                    </div>
                    <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>{range}</div>
                    <ChevronRight size={15} style={{ color: 'var(--ph-ink-4)', justifySelf: 'end' }} />
                  </div>
                  <div className="md:hidden space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                          {row.patientName}
                          <span className={`ph-badge ${isCredit ? 'ok' : 'warn'}`} style={{ fontSize: 10 }}>
                            <span className="ph-badge-dot" />{isCredit ? 'Credit' : 'Due'}
                          </span>
                        </div>
                        <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
                          {row.unpaidSessionCount} session{row.unpaidSessionCount === 1 ? '' : 's'} · {range}
                        </div>
                      </div>
                      <Money n={isCredit ? row.netCredit : row.netDue} className={isCredit ? 'ok' : 'warn'} />
                    </div>
                    <div className="flex justify-between text-xs" style={{ color: 'var(--ph-ink-4)' }}>
                      <span>Gross <Money n={row.grossDue} /></span>
                      <span>Credit <Money n={row.unspentCredit} /></span>
                    </div>
                  </div>
                </Link>
              )
            })
          )}
        </div>
        <PaginationNav
          page={safeDuePage}
          totalPages={dueTotalPages}
          onPageChange={setDuePage}
          ariaLabel="Payments balance pages"
        />
        </>
      )}

      {/* Payments tab */}
      {tab === 'payments' && (
        <>
          <SectionBar title="Payments" count={recentPaymentItems.length} />
          <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
            <div className="hidden md:grid" style={{
              gridTemplateColumns: '80px 1.6fr 1.4fr 100px 110px 44px',
              gap: 14, padding: '10px 16px',
              fontSize: 10.5, color: 'var(--ph-ink-4)',
              textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
              borderBottom: '1px solid var(--ph-line)',
            }}>
              <div>Date</div><div>Patient</div><div>For</div><div>Method</div><div style={{ textAlign: 'right' }}>Amount</div><div />
            </div>
            {recentPaymentItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
                No payments recorded yet.
              </div>
            ) : (
              visiblePaymentItems.map((item, i, arr) =>
                item.type === 'payment_recorded' ? (
                  <div
                    key={item.id}
                    style={{
                      padding: '12px 16px',
                      borderBottom: i < arr.length - 1 ? '1px solid var(--ph-line)' : 'none',
                      fontSize: 13,
                    }}
                  >
                    <div className="hidden md:grid" style={{ gridTemplateColumns: '80px 1.6fr 1.4fr 100px 110px 44px', gap: 14, alignItems: 'center' }}>
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
                      <div style={{ justifySelf: 'end' }}>
                        <DeleteIconButton
                          label={`Delete payment for ${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}`}
                          onClick={() => setPendingDelete({ kind: 'payment', id: item.id, label: `${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}` })}
                        />
                      </div>
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
                      <div className="flex items-center gap-1">
                        <Money n={item.amount} />
                        <DeleteIconButton
                          label={`Delete payment for ${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}`}
                          onClick={() => setPendingDelete({ kind: 'payment', id: item.id, label: `${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}` })}
                        />
                      </div>
                    </div>
                  </div>
                ) : null
              )
            )}
          </div>
          {!showAllPayments && recentPaymentItems.length > RECENT_LIMIT && (
            <RevealButton label={`View more (${recentPaymentItems.length - RECENT_LIMIT} more)`} onClick={() => setShowAllPayments(true)} />
          )}
          {showAllPayments && payments.length < paymentsTotalCount && (
            <RevealButton
              label={`Load more (${paymentsTotalCount - payments.length} remaining)`}
              onClick={loadMorePayments}
              loading={loadingMorePayments}
            />
          )}
          {showAllPayments && recentPaymentItems.length > RECENT_LIMIT && (
            <RevealButton label="Show less" onClick={() => setShowAllPayments(false)} />
          )}
        </>
      )}

      {/* Packages tab */}
      {tab === 'packages' && (
        <>
          <SectionBar title="Packages" count={packageItems.length} />
          <div className="grid gap-4 md:grid-cols-2">
            {packageItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13, background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, gridColumn: '1/-1' }}>
                No packages created yet.
              </div>
            ) : (
              visiblePackageItems.map((item) => {
                if (item.type !== 'package_created') return null
                const pct = item.totalSessions > 0
                  ? Math.min(100, (item.usedSessions / item.totalSessions) * 100)
                  : 0
                return (
                  <Link
                    key={item.id}
                    href={`/billing/packages/${item.id}`}
                    className="hover:bg-[var(--ph-bg-soft)]"
                    style={{ display: 'block', background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '14px 16px', textDecoration: 'none', color: 'inherit' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ph-ink)' }}>{item.patientName}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>{item.packageName}</div>
                      </div>
                      <div className="flex items-start gap-1">
                        <span className={`ph-badge ${pkgStatusCls[item.status] ?? ''}`}>{item.status}</span>
                        <DeleteIconButton
                          label={`Delete package for ${item.patientName} · ${item.packageName}`}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setPendingDelete({ kind: 'package', id: item.id, label: `${item.patientName} · ${item.packageName}` })
                          }}
                        />
                      </div>
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
                      {format(parseISO(item.sortDate), 'dd MMM yyyy')}
                    </div>
                  </Link>
                )
              })
            )}
          </div>
          {!showAllPackages && packageItems.length > RECENT_LIMIT && (
            <RevealButton label={`View more (${packageItems.length - RECENT_LIMIT} more)`} onClick={() => setShowAllPackages(true)} />
          )}
          {showAllPackages && packages.length < packagesTotalCount && (
            <RevealButton
              label={`Load more (${packagesTotalCount - packages.length} remaining)`}
              onClick={loadMorePackages}
              loading={loadingMorePackages}
            />
          )}
          {showAllPackages && packageItems.length > RECENT_LIMIT && (
            <RevealButton label="Show less" onClick={() => setShowAllPackages(false)} />
          )}
        </>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {pendingDelete?.kind === 'package' ? 'package' : 'payment'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.label ? <><span className="font-medium">{pendingDelete.label}</span><br /></> : null}
              This permanently removes the {pendingDelete?.kind === 'package' ? 'package and its collected payment' : 'payment'} and recomputes balances. The most recent completed sessions may become unpaid. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); confirmDelete() }}
              disabled={deleting}
              className="bg-[var(--ph-bad)] hover:bg-[var(--ph-bad)]/90"
            >
              {deleting ? <><Loader2 size={14} className="animate-spin" /> Deleting…</> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
