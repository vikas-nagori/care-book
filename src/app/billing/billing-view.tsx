'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { Loader2, Plus, IndianRupee, Receipt, AlertCircle, ChevronRight, Ban, RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  getFundingScopeLabel,
  type BillingTimelinePackage,
  type BillingTimelinePayment,
} from '@/lib/billing/unified-billing'
import type { V2PaymentBalanceRow } from '@/lib/billing/v2-balances'
import type { PackageBillingBalanceV2, PackageTemplate } from '@/lib/supabase/types'
import { PaginationNav } from '@/components/pagination-nav'
import { BillingEntryForm } from './billing-entry-form'
import { cancelPackage, recordRefund, voidPayment, voidRefund } from './actions'

type TabId = 'overview' | 'payment_due' | 'payments' | 'packages'

interface BillingViewProps {
  packages: BillingTimelinePackage[]
  packagesTotalCount: number
  packageTemplates: PackageTemplate[]
  appointmentTypes: { id: string; name: string; session_rate: number }[]
  payments: BillingTimelinePayment[]
  paymentsTotalCount: number
  pageSize: number
  patients: { id: string; name: string }[]
  linkedSessionCounts: Record<string, number>
  packageBalances: Record<string, PackageBillingBalanceV2>
  paymentDueRows: V2PaymentBalanceRow[]
  refunds?: { id: string; payment_id: string; amount: number; refund_method: string; refund_date: string; reason: string; reversed: boolean }[]
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

function AuditActionButton({ label, onClick, reverse = false }: { label: string; onClick: (event: React.MouseEvent) => void; reverse?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-[var(--ph-ink-4)] hover:text-[var(--ph-bad)] hover:bg-[var(--ph-bg-soft)] transition-colors"
    >
      {reverse ? <RotateCcw size={15} /> : <Ban size={15} />}
    </button>
  )
}

function PaymentLedgerBadge({ status, refundedAmount, grossAmount }: { status: 'posted' | 'voided'; refundedAmount: number; grossAmount: number }) {
  const state = status === 'voided'
    ? { label: 'Voided', cls: 'bad' }
    : refundedAmount >= grossAmount
      ? { label: 'Refunded', cls: 'warn' }
      : refundedAmount > 0
        ? { label: 'Partially refunded', cls: 'warn' }
        : { label: 'Posted', cls: 'ok' }
  return <span className={`ph-badge ${state.cls}`}>{state.label}</span>
}

export function BillingView({
  packages: initialPackages,
  packagesTotalCount,
  packageTemplates,
  appointmentTypes,
  payments: initialPayments,
  paymentsTotalCount,
  pageSize,
  patients,
  linkedSessionCounts,
  packageBalances,
  paymentDueRows,
  refunds = [],
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
  const [refundRows, setRefundRows] = useState(refunds)
  const [loadingMorePayments, setLoadingMorePayments] = useState(false)
  const [loadingMorePackages, setLoadingMorePackages] = useState(false)
  const [duePage, setDuePage] = useState(1)
  const [showAllPayments, setShowAllPayments] = useState(false)
  const [showAllPackages, setShowAllPackages] = useState(false)
  const [pendingAction, setPendingAction] = useState<
    { kind: 'void_payment' | 'cancel_package' | 'refund_payment' | 'void_refund'; id: string; label: string; maxAmount?: number } | null
  >(null)
  const [actionReason, setActionReason] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [refundMethod, setRefundMethod] = useState('upi')
  const [refundDate, setRefundDate] = useState(defaultPaymentDate)
  const [savingAction, setSavingAction] = useState(false)
  const cleanBillingUrl = initialTab === 'overview' ? '/billing' : `/billing?tab=${initialTab}`

  useEffect(() => setPackages(initialPackages), [initialPackages])
  useEffect(() => setPayments(initialPayments), [initialPayments])
  useEffect(() => setRefundRows(refunds), [refunds])

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

  async function confirmAuditedAction() {
    if (!pendingAction || !actionReason.trim()) return
    setSavingAction(true)
    const result = pendingAction.kind === 'void_payment'
      ? await voidPayment(pendingAction.id, actionReason)
      : pendingAction.kind === 'cancel_package'
        ? await cancelPackage(pendingAction.id, actionReason)
        : pendingAction.kind === 'void_refund'
          ? await voidRefund(pendingAction.id, actionReason)
          : await recordRefund({ paymentId: pendingAction.id, amount: Number(refundAmount), refundMethod, refundDate, reason: actionReason })
    setSavingAction(false)

    if (!result.success) {
      toast({
        title: 'Audited change not saved',
        description: result.message,
        variant: 'destructive',
      })
      return
    }

    setPendingAction(null)
    setActionReason('')
    setRefundAmount('')
    toast({
      title: 'Audited change saved',
      description: 'The ledger and balances have been reconciled.',
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
    if (data) {
      const nextPayments = data as BillingTimelinePayment[]
      setPayments((prev) => [...prev, ...nextPayments])
      const paymentIds = nextPayments.map((payment) => payment.id)
      if (paymentIds.length > 0) {
        const { data: nextRefunds } = await supabase.from('refunds').select('id, payment_id, amount, refund_method, refund_date, reason').in('payment_id', paymentIds)
        const refundIds = (nextRefunds ?? []).map((refund) => refund.id)
        const { data: reversals } = refundIds.length > 0
          ? await supabase.from('refund_reversals').select('refund_id').in('refund_id', refundIds)
          : { data: [] }
        const reversedIds = new Set((reversals ?? []).map((reversal) => reversal.refund_id))
        setRefundRows((prev) => {
          const byId = new Map(prev.map((refund) => [refund.id, refund]))
          for (const refund of nextRefunds ?? []) byId.set(refund.id, { ...refund, amount: Number(refund.amount), reversed: reversedIds.has(refund.id) })
          return [...byId.values()]
        })
      }
    }
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

  const paymentDueTotal = paymentDueRows.reduce((total, row) => total + row.totalDue, 0)
  const activePackages = packages.filter((pkg) => {
    const availed = Number(packageBalances[pkg.id]?.availed_sessions ?? 0)
    return pkg.status === 'active' || (pkg.status === 'completed' && availed !== pkg.total_sessions)
  })

  const timelineItems = useMemo(
    () => buildBillingTimelineItems({ packages, payments, linkedSessionCounts }),
    [packages, payments, linkedSessionCounts],
  )

  const recentPaymentItems = timelineItems.filter((i) => i.type === 'payment_recorded')
  const postedPaymentItems = recentPaymentItems.filter((item) => item.status === 'posted')
  const packageItems       = timelineItems.filter((i) => i.type === 'package_created')

  // Payments Balance is paginated (25/page); payments & packages keep the recent-10 "View more" reveal.
  const dueTotalPages = Math.max(1, Math.ceil(paymentDueRows.length / PAYMENT_DUE_PAGE_SIZE))
  const safeDuePage = Math.min(Math.max(1, duePage), dueTotalPages)
  const visibleDueRows      = paymentDueRows.slice((safeDuePage - 1) * PAYMENT_DUE_PAGE_SIZE, safeDuePage * PAYMENT_DUE_PAGE_SIZE)
  const visiblePaymentItems = showAllPayments ? recentPaymentItems : recentPaymentItems.slice(0, RECENT_LIMIT)
  const visiblePackageItems = showAllPackages ? packageItems       : packageItems.slice(0, RECENT_LIMIT)
  const activeRefundTotals = refundRows.reduce<Record<string, number>>((totals, refund) => {
    if (!refund.reversed) totals[refund.payment_id] = (totals[refund.payment_id] ?? 0) + Number(refund.amount)
    return totals
  }, {})

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
              packageTemplates={packageTemplates}
              appointmentTypes={appointmentTypes}
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
              {postedPaymentItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
                  No payments yet.
                </div>
              ) : (
                postedPaymentItems.slice(0, 6).map((item, i, arr) => (
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
                const balance = packageBalances[pkg.id]
                const availed = Number(balance?.availed_sessions ?? 0)
                const scheduled = Number(balance?.scheduled_sessions ?? 0)
                const availedPct = pkg.total_sessions > 0 ? Math.min(100, (availed / pkg.total_sessions) * 100) : 0
                const scheduledPct = pkg.total_sessions > 0 ? Math.min(100 - availedPct, (scheduled / pkg.total_sessions) * 100) : 0
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
                      <span>{availed} availed · {scheduled} scheduled · {pkg.total_sessions} total</span>
                      <span className="font-mono-data">{Math.round(availedPct)}%</span>
                    </div>
                    <div className="ph-bar" style={{ display: 'flex' }}><span style={{ width: `${availedPct}%` }} /><span style={{ width: `${scheduledPct}%`, opacity: 0.35 }} /></div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1" style={{ marginTop: 8, fontSize: 11.5 }}>
                      <span>Quote <Money n={Number(balance?.quote_amount ?? pkg.total_amount)} /></span>
                      <span>Net received <Money n={Number(balance?.net_received ?? 0)} /></span>
                      <span>Due <Money n={Number(balance?.due_amount ?? 0)} /></span>
                      <span className="col-span-2">Refundable credit <Money n={Number(balance?.refundable_credit ?? 0)} className="ok" /></span>
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
            gridTemplateColumns: '1.6fr 140px 20px',
            gap: 14, padding: '10px 16px',
            fontSize: 10.5, color: 'var(--ph-ink-4)',
            textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
            borderBottom: '1px solid var(--ph-line)',
          }}>
            <div>Patient</div>
            <div style={{ textAlign: 'right' }}>Amount</div>
            <div />
          </div>
          {paymentDueRows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
              No outstanding balances right now.
            </div>
          ) : (
            visibleDueRows.map((row, index) => {
              const isCredit = row.direction === 'credit'
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
                  {/* Regular vs package split lives on the drill-down; the list stays scannable. */}
                  <div className="hidden md:grid" style={{ gridTemplateColumns: '1.6fr 140px 20px', gap: 14, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 500 }}>{row.patientName}</span>
                      <span className={`ph-badge ${isCredit ? 'ok' : 'warn'}`} style={{ fontSize: 10 }}>
                        <span className="ph-badge-dot" />{isCredit ? 'Credit' : 'Due'}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Money n={isCredit ? row.totalCredit : row.totalDue} className={isCredit ? 'ok' : 'warn'} />
                    </div>
                    <ChevronRight size={15} style={{ color: 'var(--ph-ink-4)', justifySelf: 'end' }} />
                  </div>
                  <div className="md:hidden flex items-center justify-between gap-3">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      {row.patientName}
                      <span className={`ph-badge ${isCredit ? 'ok' : 'warn'}`} style={{ fontSize: 10 }}>
                        <span className="ph-badge-dot" />{isCredit ? 'Credit' : 'Due'}
                      </span>
                    </div>
                    <Money n={isCredit ? row.totalCredit : row.totalDue} className={isCredit ? 'ok' : 'warn'} />
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
              gridTemplateColumns: '80px 1.6fr 1.4fr 100px 110px 96px',
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
                    <div className="hidden md:grid" style={{ gridTemplateColumns: '80px 1.6fr 1.4fr 100px 110px 96px', gap: 14, alignItems: 'center' }}>
                      <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                        {format(parseISO(item.sortDate), 'dd MMM')}
                      </div>
                      <div className="flex flex-wrap items-center gap-2" style={{ fontWeight: 500 }}>
                        {item.patientName}
                        <PaymentLedgerBadge status={item.status} refundedAmount={activeRefundTotals[item.id] ?? 0} grossAmount={item.amount} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ph-ink-3)' }}>
                        {item.fundingScope === 'package' ? item.packageName ?? 'Package' : getFundingScopeLabel(item.fundingScope)}
                        {item.notes ? ` · ${item.notes}` : ''}
                      </div>
                      <div style={{ fontSize: 12, textTransform: 'capitalize' }}>{item.paymentMethod}</div>
                      <div style={{ textAlign: 'right' }}><Money n={item.amount} /></div>
                      <div style={{ justifySelf: 'end', display: 'flex' }}>
                        {item.status === 'posted' && item.amount > (activeRefundTotals[item.id] ?? 0) && <AuditActionButton label={`Refund payment for ${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}`} reverse onClick={() => { const refundable = item.amount - (activeRefundTotals[item.id] ?? 0); setRefundAmount(String(refundable)); setPendingAction({ kind: 'refund_payment', id: item.id, label: `${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}`, maxAmount: refundable }) }} />}
                        {item.status === 'posted' && (activeRefundTotals[item.id] ?? 0) === 0 && <AuditActionButton label={`Void payment for ${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}`} onClick={() => setPendingAction({ kind: 'void_payment', id: item.id, label: `${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}` })} />}
                      </div>
                    </div>
                    {/* Mobile row */}
                    <div className="md:hidden flex justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2" style={{ fontWeight: 500 }}>
                          {item.patientName}
                          <PaymentLedgerBadge status={item.status} refundedAmount={activeRefundTotals[item.id] ?? 0} grossAmount={item.amount} />
                        </div>
                        <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
                          {format(parseISO(item.sortDate), 'dd MMM')} · {item.paymentMethod}
                          {item.fundingScope === 'package' ? ` · ${item.packageName ?? 'Package'}` : ` · ${getFundingScopeLabel(item.fundingScope)}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Money n={item.amount} />
                        {item.status === 'posted' && item.amount > (activeRefundTotals[item.id] ?? 0) && <AuditActionButton label={`Refund payment for ${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}`} reverse onClick={() => { const refundable = item.amount - (activeRefundTotals[item.id] ?? 0); setRefundAmount(String(refundable)); setPendingAction({ kind: 'refund_payment', id: item.id, label: `${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}`, maxAmount: refundable }) }} />}
                        {item.status === 'posted' && (activeRefundTotals[item.id] ?? 0) === 0 && <AuditActionButton label={`Void payment for ${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}`} onClick={() => setPendingAction({ kind: 'void_payment', id: item.id, label: `${item.patientName} · ₹${item.amount.toLocaleString('en-IN')}` })} />}
                      </div>
                    </div>
                  </div>
                ) : null
              )
            )}
            {refundRows.length > 0 && <div className="p-3 border-t" style={{ background: 'var(--ph-bg-soft)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ph-ink-3)', marginBottom: 6 }}>Refund history</div>
              {refundRows.map((refund) => <div key={refund.id} className="flex flex-wrap items-center gap-3 py-1 text-xs">
                <span>{format(parseISO(refund.refund_date), 'dd MMM yyyy')}</span>
                <span><Money n={Number(refund.amount)} /></span>
                <span style={{ textTransform: 'capitalize' }}>{refund.refund_method}</span>
                <span className={`ph-badge ${refund.reversed ? 'soft' : 'warn'}`}>{refund.reversed ? 'Reversed' : 'Refunded'}</span>
                <span className="truncate">{refund.reason}</span>
                {!refund.reversed && <AuditActionButton label={`Reverse refund ₹${Number(refund.amount).toLocaleString('en-IN')}`} reverse onClick={() => setPendingAction({ kind: 'void_refund', id: refund.id, label: `Refund · ₹${Number(refund.amount).toLocaleString('en-IN')}` })} />}
              </div>)}
            </div>}
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
                const balance = packageBalances[item.id]
                const availed = Number(balance?.availed_sessions ?? 0)
                const scheduled = Number(balance?.scheduled_sessions ?? 0)
                const availedPct = item.totalSessions > 0 ? Math.min(100, (availed / item.totalSessions) * 100) : 0
                const scheduledPct = item.totalSessions > 0 ? Math.min(100 - availedPct, (scheduled / item.totalSessions) * 100) : 0
                const displayStatus = item.status === 'completed' && availed !== item.totalSessions ? 'active' : item.status
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
                        <span className={`ph-badge ${pkgStatusCls[displayStatus] ?? ''}`}>{displayStatus}</span>
                        {displayStatus === 'active' && <AuditActionButton
                          label={`Cancel package for ${item.patientName} · ${item.packageName}`}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setPendingAction({ kind: 'cancel_package', id: item.id, label: `${item.patientName} · ${item.packageName}` })
                          }}
                        />}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ph-ink-3)', marginBottom: 6 }}>
                      <span>{availed} availed · {scheduled} scheduled · {item.totalSessions} total</span>
                      <span className="font-mono-data">{Math.round(availedPct)}%</span>
                    </div>
                    <div className="ph-bar" style={{ marginBottom: 10, display: 'flex' }}><span style={{ width: `${availedPct}%` }} /><span style={{ width: `${scheduledPct}%`, opacity: 0.35 }} /></div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" style={{ fontSize: 11.5 }}>
                      <span>Quote <Money n={Number(balance?.quote_amount ?? item.totalAmount)} /></span>
                      <span>Net received <Money n={Number(balance?.net_received ?? 0)} /></span>
                      <span>Due <Money n={Number(balance?.due_amount ?? 0)} /></span>
                      <span>Refundable credit <Money n={Number(balance?.refundable_credit ?? 0)} /></span>
                    </div>
                    {displayStatus === 'completed' && balance?.completed_at && <div style={{ fontSize: 11, color: 'var(--ph-ok)', marginTop: 6 }}>Completed {format(parseISO(balance.completed_at), 'dd MMM yyyy')}</div>}
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

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => { if (!open && !savingAction) { setPendingAction(null); setActionReason(''); setRefundAmount('') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.kind === 'cancel_package' ? 'Cancel package' : pendingAction?.kind === 'refund_payment' ? 'Record refund' : pendingAction?.kind === 'void_refund' ? 'Reverse refund' : 'Void payment'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.label ? <><span className="font-medium">{pendingAction.label}</span><br /></> : null}
              This records an immutable audited ledger event and then reconciles balances. No history is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingAction?.kind === 'refund_payment' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor="refund_amount">Amount *</Label><Input id="refund_amount" type="number" min="0.01" max={pendingAction.maxAmount} step="0.01" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="refund_method">Method *</Label><Select value={refundMethod} onValueChange={setRefundMethod}><SelectTrigger id="refund_method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="bank_transfer">Bank Transfer</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label htmlFor="refund_date">Date *</Label><Input id="refund_date" type="date" value={refundDate} onChange={(event) => setRefundDate(event.target.value)} /></div>
          </div>}
          <div className="space-y-2">
            <Label htmlFor="audit_reason">Reason *</Label>
            <Textarea id="audit_reason" value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Explain why this correction is needed" rows={3} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingAction}>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); confirmAuditedAction() }}
              disabled={savingAction || !actionReason.trim() || (pendingAction?.kind === 'refund_payment' && (!Number.isFinite(Number(refundAmount)) || Number(refundAmount) <= 0 || Number(refundAmount) > Number(pendingAction.maxAmount ?? 0)))}
              className="bg-[var(--ph-bad)] hover:bg-[var(--ph-bad)]/90"
            >
              {savingAction ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save audited change'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
