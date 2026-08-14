import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'
import { formatTime12 } from '@/lib/format-time'

export type PaymentDueSession = {
  id: string
  date: string
  time: string
  type: string
  fee: number
}

type PaymentDueDetailProps = {
  patientName: string
  sessions: PaymentDueSession[]
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

// Presentational tally of a patient's balance — kept prop-driven and side-effect free so a future
// "Export / Share PDF" action can render the same summary without touching data fetching.
export function PaymentDueDetail({
  patientName,
  sessions,
  ordinaryDue, ordinaryCredit, packageDue, packageCredit,
}: PaymentDueDetailProps) {
  const totalDue = ordinaryDue + packageDue
  const totalCredit = ordinaryCredit + packageCredit
  const isCredit = totalDue === 0 && totalCredit > 0

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
          <div className="ph-stat-label"><span>Ordinary due</span></div>
          <div className="ph-stat-value"><Money n={ordinaryDue} /></div>
          <div className="ph-stat-meta">ordinary FIFO only</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><span>Ordinary credit</span></div>
          <div className="ph-stat-value" style={{ color: ordinaryCredit > 0 ? 'var(--ph-ok)' : undefined }}><Money n={ordinaryCredit} /></div>
          <div className="ph-stat-meta">refundable ordinary</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><span>Package due</span></div>
          <div className="ph-stat-value" style={{ color: packageDue > 0 ? 'var(--ph-warn)' : undefined }}><Money n={packageDue} /></div>
          <div className="ph-stat-meta">not covered by ordinary credit</div>
        </div>
        <div className="ph-stat">
          <div className="ph-stat-label"><span>Package credit</span></div>
          <div className="ph-stat-value" style={{ color: packageCredit > 0 ? 'var(--ph-ok)' : undefined }}><Money n={packageCredit} /></div>
          <div className="ph-stat-meta">refundable within packages</div>
        </div>
      </div>

      {/* Per-session tally */}
      <div className="ph-section-h"><h2>Unpaid sessions</h2></div>
      <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
            No unpaid or partially paid sessions — this balance is {isCredit ? 'refundable credit.' : 'settled.'}
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
            <span>Session fees shown</span>
            <Money n={sessions.reduce((sum, session) => sum + session.fee, 0)} />
          </div>
        )}
      </div>
    </div>
  )
}
