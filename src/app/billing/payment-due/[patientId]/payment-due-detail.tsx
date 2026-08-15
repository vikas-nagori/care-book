import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'
import { formatTime12 } from '@/lib/format-time'
import {
  getPackageProgress,
  PACKAGE_STATUS_BADGE_CLASS,
  PACKAGE_STATUS_LABEL,
} from '@/lib/billing/package-progress'

export type PaymentDueSession = {
  id: string
  date: string
  time: string
  type: string
  fee: number
}

export type PaymentDuePackage = {
  id: string
  name: string
  status: string
  availedSessions: number
  scheduledSessions: number
  totalSessions: number
  quoteAmount: number
  netReceived: number
  dueAmount: number
  refundableCredit: number
}

type PaymentDueDetailProps = {
  patientName: string
  sessions: PaymentDueSession[]
  // Required, not optional: forgetting to pass these is exactly the bug that made the due tile
  // unexplainable from the list below it.
  scheduledSessions: PaymentDueSession[]
  // Same reasoning: the package due/credit tiles are unexplainable without the packages behind them.
  packages: PaymentDuePackage[]
  ordinaryDue: number
  ordinaryCredit: number
  packageDue: number
  packageCredit: number
}

function Money({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`ph-money ${className}`}>
      <span className="rs">₹</span>
      {n.toLocaleString('en-IN')}
    </span>
  )
}

// One card of session rows with a footer subtotal. Both the completed and the scheduled sections
// render through this so the two tallies stay visually identical and add up the same way.
function SessionCard({
  testId,
  sessions,
  emptyMessage,
  totalLabel,
}: {
  testId: string
  sessions: PaymentDueSession[]
  emptyMessage: string
  totalLabel: string
}) {
  return (
    <div data-testid={testId} style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
      {sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
          {emptyMessage}
        </div>
      ) : (
        sessions.map((session, index) => (
          <div
            key={session.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
              borderBottom: index < sessions.length - 1 ? '1px solid var(--ph-line)' : 'none',
              fontSize: 13,
            }}
          >
            <div style={{ minWidth: 96 }}>
              <div className="font-mono-data" style={{ fontWeight: 500, color: 'var(--ph-ink)' }}>
                {format(parseISO(session.date), 'dd MMM yyyy')}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>{formatTime12(session.time)}</div>
            </div>
            <span className="ph-badge soft" style={{ textTransform: 'none', fontSize: 10.5 }}>
              {session.type}
            </span>
            <div style={{ marginLeft: 'auto' }}><Money n={session.fee} /></div>
          </div>
        ))
      )}
      {sessions.length > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', borderTop: '1px solid var(--ph-line)', background: 'var(--ph-bg-soft)',
          fontSize: 13, fontWeight: 600,
        }}>
          <span>{totalLabel}</span>
          <Money n={sessions.reduce((sum, session) => sum + session.fee, 0)} />
        </div>
      )}
    </div>
  )
}

// The package due/credit tiles above are meaningless on their own — this is the "where did that come
// from" answer: one progress card per package, each a link into the same package detail the billing
// overview links to, so the drill-down keeps going instead of dead-ending here.
function PackageProgressCard({ pkg }: { pkg: PaymentDuePackage }) {
  const { availedPct, scheduledPct, displayStatus } = getPackageProgress({
    status: pkg.status,
    availedSessions: pkg.availedSessions,
    scheduledSessions: pkg.scheduledSessions,
    totalSessions: pkg.totalSessions,
  })

  return (
    <Link
      href={`/billing/packages/${pkg.id}`}
      data-testid={`package-progress-${pkg.id}`}
      className="hover:bg-[var(--ph-bg-soft)]"
      style={{
        display: 'block', background: 'var(--ph-surface)', border: '1px solid var(--ph-line)',
        borderRadius: 10, padding: '12px 14px', textDecoration: 'none', color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ph-ink)' }}>{pkg.name}</div>
          <div style={{ fontSize: 11, color: 'var(--ph-ink-4)', marginTop: 1 }}>
            {pkg.availedSessions} availed · {pkg.scheduledSessions} scheduled · {pkg.totalSessions} total
          </div>
        </div>
        <span className={`ph-badge ${PACKAGE_STATUS_BADGE_CLASS[displayStatus] ?? ''}`} style={{ flexShrink: 0, alignSelf: 'flex-start' }}>
          {PACKAGE_STATUS_LABEL[displayStatus] ?? displayStatus}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 11.5, color: 'var(--ph-ink-3)', marginBottom: 6 }}>
        <span className="font-mono-data">{Math.round(availedPct)}%</span>
      </div>
      <div className="ph-bar" style={{ display: 'flex' }} aria-label={`${pkg.name} session progress`}>
        <span style={{ width: `${availedPct}%` }} />
        <span style={{ width: `${scheduledPct}%`, opacity: 0.35 }} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1" style={{ marginTop: 8, fontSize: 11.5 }}>
        <span>Quote <Money n={pkg.quoteAmount} /></span>
        <span>Net received <Money n={pkg.netReceived} /></span>
        <span>Due <Money n={pkg.dueAmount} /></span>
        <span className="col-span-2">Refundable credit <Money n={pkg.refundableCredit} className="ok" /></span>
      </div>
    </Link>
  )
}

// Presentational tally of a patient's balance — kept prop-driven and side-effect free so a future
// "Export / Share PDF" action can render the same summary without touching data fetching.
export function PaymentDueDetail({
  patientName,
  sessions,
  scheduledSessions,
  packages,
  ordinaryDue, ordinaryCredit, packageDue, packageCredit,
}: PaymentDueDetailProps) {
  const totalDue = ordinaryDue + packageDue
  const totalCredit = ordinaryCredit + packageCredit
  const isCredit = totalDue === 0 && totalCredit > 0
  // A patient can owe nothing for past sessions yet still carry a due from upcoming ones, so
  // "settled" is only honest when neither list has anything left in it.
  const unpaidEmptyMessage = scheduledSessions.length > 0
    ? 'No unpaid or partially paid completed sessions — the balance above comes from the scheduled sessions below.'
    : `No unpaid or partially paid sessions — this balance is ${isCredit ? 'refundable credit.' : 'settled.'}`

  return (
    <div className="px-4 pb-4 md:p-6">
      <MobilePageHeader title="Balance detail" backHref="/billing" />

      <div className="hidden md:flex items-center gap-2" style={{ marginBottom: 20 }}>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/billing" aria-label="Back to billing"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
            {patientName}
          </h1>
          <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }}>Payments balance detail</div>
        </div>
      </div>

      <div className="md:hidden" style={{ margin: '12px 0 16px' }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ph-ink)' }}>{patientName}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>Payments balance detail</div>
      </div>

      {/* Summary: how the balance is calculated */}
      <div className="grid grid-cols-2 gap-3 mb-5 md:grid-cols-4">
        <div className="ph-stat">
          <div className="ph-stat-label"><span>Regular due</span></div>
          <div className="ph-stat-value"><Money n={ordinaryDue} /></div>
          <div className="ph-stat-meta">regular sessions only</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><span>Regular credit</span></div>
          <div className="ph-stat-value" style={{ color: ordinaryCredit > 0 ? 'var(--ph-ok)' : undefined }}><Money n={ordinaryCredit} /></div>
          <div className="ph-stat-meta">refundable regular</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><span>Package due</span></div>
          <div className="ph-stat-value" style={{ color: packageDue > 0 ? 'var(--ph-warn)' : undefined }}><Money n={packageDue} /></div>
          <div className="ph-stat-meta">not covered by regular credit</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><span>Package credit</span></div>
          <div className="ph-stat-value" style={{ color: packageCredit > 0 ? 'var(--ph-ok)' : undefined }}><Money n={packageCredit} /></div>
          <div className="ph-stat-meta">refundable within packages</div>
        </div>
      </div>

      {/* Packages behind the two package tiles above, each a link onward to its session history */}
      {packages.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="ph-section-h">
            <h2>Packages</h2>
            <span style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>tap for session history</span>
          </div>
          <div data-testid="package-progress-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {packages.map((pkg) => <PackageProgressCard key={pkg.id} pkg={pkg} />)}
          </div>
        </div>
      )}

      {/* Per-session tally — completed sessions already delivered but not yet settled */}
      <div className="ph-section-h">
        <h2>Unpaid sessions</h2>
        <span style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>completed, awaiting payment</span>
      </div>
      <SessionCard testId="unpaid-sessions-card" sessions={sessions} emptyMessage={unpaidEmptyMessage} totalLabel="Session fees shown" />

      {/* Scheduled sessions count toward the due above even though they haven't happened yet */}
      <div className="ph-section-h" style={{ marginTop: 20 }}>
        <h2>Scheduled sessions</h2>
        <span style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>upcoming, included in the due above</span>
      </div>
      <SessionCard
        testId="scheduled-sessions-card"
        sessions={scheduledSessions}
        emptyMessage="No scheduled sessions are contributing to this balance."
        totalLabel="Scheduled fees shown"
      />
    </div>
  )
}
