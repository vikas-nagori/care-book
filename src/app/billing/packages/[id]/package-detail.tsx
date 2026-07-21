import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'

export type PackageSession = {
  id: string
  date: string
  time: string | null
  type: string | null
  fee: number | null
  status: string
}

type PackageDetailProps = {
  patientName: string
  name: string
  status: string
  usedSessions: number
  totalSessions: number
  paidAmount: number
  totalAmount: number
  sessions: PackageSession[]
}

const statusCls: Record<string, string> = { active: 'ok', completed: 'info', cancelled: 'bad' }

function Money({ n }: { n: number }) {
  return (
    <span className="ph-money">
      <span className="rs">₹</span>
      {n.toLocaleString('en-IN')}
    </span>
  )
}

function formatTime(time: string | null): string {
  if (!time) return ''
  const parsed = parseISO(`2000-01-01T${time}`)
  return Number.isNaN(parsed.getTime()) ? '' : format(parsed, 'h:mm a')
}

// Presentational package detail: summary + the dates on which sessions were taken under the package.
export function PackageDetail({
  patientName, name, status, usedSessions, totalSessions, paidAmount, totalAmount, sessions,
}: PackageDetailProps) {
  const pct = totalSessions > 0 ? Math.min(100, (usedSessions / totalSessions) * 100) : 0

  return (
    <div className="px-4 pb-4 md:p-6">
      <MobilePageHeader title={name} backHref="/billing?tab=packages" />

      <div className="hidden md:flex items-center gap-2" style={{ marginBottom: 20 }}>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/billing?tab=packages" aria-label="Back to billing"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
            {name}
          </h1>
          <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }}>{patientName}</div>
        </div>
      </div>

      {/* Summary */}
      <div className="ph-stat mb-5">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ph-ink)' }}>{patientName}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
              {usedSessions} availed · {Math.max(totalSessions - usedSessions, 0)} due · {totalSessions} total
            </div>
          </div>
          <span className={`ph-badge ${statusCls[status] ?? ''}`}>{status}</span>
        </div>
        <div className="ph-bar" style={{ marginBottom: 8 }}><span style={{ width: `${pct}%` }} /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: 'var(--ph-ink-3)' }}>Paid / Total</span>
          <span><Money n={paidAmount} /> / <Money n={totalAmount} /></span>
        </div>
      </div>

      <div className="ph-section-h">
        <h2>
          Sessions taken
          <span style={{ color: 'var(--ph-ink-4)', fontWeight: 400 }}> · {sessions.length}</span>
        </h2>
      </div>

      <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
            No sessions have been taken under this package yet.
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
              <div className="font-mono-data" style={{ minWidth: 96, fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                {format(parseISO(session.date), 'dd MMM yyyy')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{session.type ?? 'Session'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
                  {formatTime(session.time)}{session.time ? ' · ' : ''}
                  <span style={{ textTransform: 'capitalize' }}>{session.status}</span>
                </div>
              </div>
              {session.fee != null && <Money n={Number(session.fee)} />}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
