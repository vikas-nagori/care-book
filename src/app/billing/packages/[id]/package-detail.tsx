import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'

export type PackageSession = {
  id: string
  appointmentReferenceId: string
  date: string | null
  time: string | null
  type: string | null
  fee: number | null
  appointmentStatus: string | null
  lifecycle: 'scheduled' | 'availed' | 'released'
  releasedAt: string | null
  releaseReason: string | null
}

type PackageDetailProps = {
  patientName: string
  name: string
  status: string
  availedSessions: number
  scheduledSessions: number
  totalSessions: number
  quoteAmount: number
  netReceived: number
  appliedAmount: number
  dueAmount: number
  refundableCredit: number
  completedAt: string | null
  sessions: PackageSession[]
}

const statusCls: Record<string, string> = { active: 'ok', completed: 'info', cancelled: 'bad' }
const statusLabel: Record<string, string> = { active: 'Active', completed: 'Completed', cancelled: 'Cancelled' }

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
  patientName, name, status, availedSessions, scheduledSessions, totalSessions,
  quoteAmount, netReceived, appliedAmount, dueAmount, refundableCredit, completedAt, sessions,
}: PackageDetailProps) {
  const availedPct = totalSessions > 0 ? Math.min(100, (availedSessions / totalSessions) * 100) : 0
  const scheduledPct = totalSessions > 0 ? Math.min(100 - availedPct, (scheduledSessions / totalSessions) * 100) : 0
  const displayStatus = status === 'completed' && availedSessions !== totalSessions ? 'active' : status

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
              {availedSessions} availed · {scheduledSessions} scheduled · {totalSessions} total
            </div>
            {status === 'completed' && availedSessions === totalSessions && completedAt && (
              <div style={{ fontSize: 11.5, color: 'var(--ph-ok)', marginTop: 3 }}>
                Completed {format(parseISO(completedAt), 'dd MMM yyyy')}
              </div>
            )}
          </div>
          <span className={`ph-badge ${statusCls[displayStatus] ?? ''}`}>{statusLabel[displayStatus] ?? displayStatus}</span>
        </div>
        <div className="ph-bar" style={{ marginBottom: 12, display: 'flex' }} aria-label="Package session progress">
          <span style={{ width: `${availedPct}%` }} />
          <span style={{ width: `${scheduledPct}%`, opacity: 0.35 }} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Quote', quoteAmount], ['Net received', netReceived], ['Applied', appliedAmount],
            ['Due', dueAmount], ['Refundable credit', refundableCredit],
          ].map(([label, amount]) => (
            <div key={String(label)}>
              <div style={{ color: 'var(--ph-ink-4)', fontSize: 10.5 }}>{label}</div>
              <div style={{ fontSize: 12.5, marginTop: 2 }}><Money n={Number(amount)} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="ph-section-h">
        <h2>
          Session history
          <span style={{ color: 'var(--ph-ink-4)', fontWeight: 400 }}> · {sessions.length}</span>
        </h2>
      </div>

      <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
            No package session history yet.
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
                {session.date ? format(parseISO(session.date), 'dd MMM yyyy') : session.releasedAt ? format(parseISO(session.releasedAt), 'dd MMM yyyy') : 'Unknown date'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{session.type ?? `Deleted appointment · ${session.appointmentReferenceId}`}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
                  {formatTime(session.time)}{session.time ? ' · ' : ''}
                  <span style={{ textTransform: 'capitalize' }}>{session.lifecycle}</span>
                  {session.lifecycle === 'released' && session.releaseReason ? <span> · {session.releaseReason}</span> : null}
                </div>
              </div>
              <span className={`ph-badge ${session.lifecycle === 'availed' ? 'ok' : session.lifecycle === 'scheduled' ? 'info' : 'soft'}`}>
                {session.lifecycle === 'availed' ? 'Availed' : session.lifecycle === 'scheduled' ? 'Scheduled' : 'Released'}
              </span>
              {session.fee != null && <Money n={Number(session.fee)} />}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
