'use client'

// Patient list building blocks shared by the clinic Patients page and the External Staff
// Shared Patients page: header, search bar, and the desktop table / mobile card rows.

import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, Loader2, Search } from 'lucide-react'

export type PatientRowData = {
  id: string
  name: string
  phone: string | null
  gender?: string | null
  dob?: string | null
}

/** A row either navigates (href) or opens something in place (onSelect). */
export type PatientRowAction = { href: string } | { onSelect: () => void }

function getInitials(name: string) {
  return name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()
}

export function PatientListHeader({ title, subtitle, action }: { title: string; subtitle: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
          {title}
        </h1>
        <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }} data-testid="patient-list-count">
          {subtitle}
        </div>
      </div>
      {action}
    </div>
  )
}

export function PatientSearchBar({ value, onChange, searching = false }: {
  value: string
  onChange: (value: string) => void
  searching?: boolean
}) {
  return (
    <div className="sticky top-0 z-10 bg-[var(--ph-bg)] pb-2 -mx-4 px-4 md:relative md:top-auto md:mx-0 md:px-0 md:pb-0 md:bg-transparent mb-4">
      <div className="ph-search" style={{ flex: 1 }}>
        <Search size={14} style={{ color: 'var(--ph-ink-4)', flexShrink: 0 }} />
        <input
          placeholder="Search by name or phone…"
          aria-label="Search patients"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {searching && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--ph-ink-4)', flexShrink: 0 }} aria-label="Searching" />}
      </div>
    </div>
  )
}

function RowShell({ action, className, style, children }: {
  action: PatientRowAction
  className?: string
  style: CSSProperties
  children: ReactNode
}) {
  if ('href' in action) {
    return <Link href={action.href} className={className} style={style}>{children}</Link>
  }
  return (
    <button type="button" onClick={action.onSelect} className={className}
      style={{ ...style, width: '100%', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', font: 'inherit' }}>
      {children}
    </button>
  )
}

const DESKTOP_COLUMNS = '36px 2fr 1.2fr 1fr 28px'

export function PatientRows<T extends PatientRowData>({
  patients,
  emptyMessage,
  actionFor,
  detailColumn,
}: {
  patients: readonly T[]
  emptyMessage: string
  actionFor: (patient: T) => PatientRowAction
  /** Third desktop column, e.g. "Joined" on the clinic list. */
  detailColumn: { label: string; render: (patient: T) => ReactNode }
}) {
  const empty = (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
      {emptyMessage}
    </div>
  )
  return (
    <>
      {/* Desktop table */}
      <div
        className="hidden md:block"
        style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: DESKTOP_COLUMNS,
          gap: 14, padding: '10px 16px',
          fontSize: 10.5, color: 'var(--ph-ink-4)',
          textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
          borderBottom: '1px solid var(--ph-line)',
        }}>
          <div />
          <div>Patient</div>
          <div>Phone</div>
          <div>{detailColumn.label}</div>
          <div />
        </div>

        {patients.length === 0 ? empty : patients.map((patient, i) => (
          <RowShell
            key={patient.id}
            action={actionFor(patient)}
            className="hover:bg-[var(--ph-bg-soft)]"
            style={{
              display: 'grid',
              gridTemplateColumns: DESKTOP_COLUMNS,
              gap: 14, padding: '12px 16px',
              alignItems: 'center',
              borderBottom: i < patients.length - 1 ? '1px solid var(--ph-line)' : 'none',
              textDecoration: 'none', color: 'inherit',
              transition: 'background 0.1s',
            }}
          >
            <div className="ph-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
              {getInitials(patient.name)}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ph-ink)' }}>{patient.name}</div>
              {patient.gender && (
                <div style={{ fontSize: 11, color: 'var(--ph-ink-4)', marginTop: 1, textTransform: 'capitalize' }}>
                  {patient.gender}{patient.dob ? ` · ${new Date().getFullYear() - new Date(patient.dob).getFullYear()} y` : ''}
                </div>
              )}
            </div>
            <div className="font-mono-data" style={{ fontSize: 12, color: 'var(--ph-ink-3)' }}>{patient.phone}</div>
            <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {detailColumn.render(patient)}
            </div>
            <div style={{ color: 'var(--ph-ink-4)', display: 'flex', justifyContent: 'flex-end' }}>
              <ChevronRight size={16} />
            </div>
          </RowShell>
        ))}
      </div>

      {/* Mobile card list */}
      <div
        className="md:hidden"
        style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}
      >
        {patients.length === 0 ? empty : patients.map((patient) => (
          <RowShell key={patient.id} action={actionFor(patient)} className="ph-patient-row" style={{ minHeight: 56 }}>
            <div className="ph-avatar" style={{ width: 38, height: 38, fontSize: 12 }}>
              {getInitials(patient.name)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ph-ink)' }}>{patient.name}</div>
              <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>
                {patient.phone}
              </div>
            </div>
            {patient.gender && (
              <span className="ph-badge soft" style={{ textTransform: 'capitalize', fontSize: 11 }}>
                {patient.gender}
              </span>
            )}
            <ChevronRight size={16} style={{ color: 'var(--ph-ink-4)', flexShrink: 0 }} />
          </RowShell>
        ))}
      </div>
    </>
  )
}
