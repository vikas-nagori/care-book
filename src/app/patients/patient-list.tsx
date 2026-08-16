'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Search, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { buildPatientSearchFilter, normalizePatientSearchTerm } from '@/lib/patients/patient-search-filter'
import type { Patient } from '@/lib/supabase/types'

/** Most matches we render for one term; beyond this the caller should refine the search. */
const SEARCH_LIMIT = 50
const SEARCH_DEBOUNCE_MS = 250

function getInitials(name: string) {
  return name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()
}

interface PatientListProps {
  initialPatients: Patient[]
  totalCount: number
  pageSize: number
}

export function PatientList({ initialPatients, totalCount, pageSize }: PatientListProps) {
  const [search, setSearch] = useState('')
  const [patients, setPatients] = useState<Patient[]>(initialPatients)
  const [loadingMore, setLoadingMore] = useState(false)
  const [matches, setMatches] = useState<Patient[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)

  const term = normalizePatientSearchTerm(search)
  const isSearching = term.length > 0

  // Search hits the database rather than the loaded page. The browser holds only the first
  // `pageSize` patients, so filtering that array could never find anyone further down the
  // alphabet — and the Load more button is hidden while searching, leaving them unreachable.
  useEffect(() => {
    const filter = buildPatientSearchFilter(search)
    if (!filter) {
      setMatches(null)
      setSearching(false)
      setSearchFailed(false)
      return
    }

    setSearching(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .or(filter)
        .order('name')
        .limit(SEARCH_LIMIT)
        .abortSignal(controller.signal)

      // A newer keystroke already aborted this request; its results are stale.
      if (controller.signal.aborted) return
      setSearchFailed(Boolean(error))
      setMatches(error ? [] : data ?? [])
      setSearching(false)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [search])

  const filtered = isSearching ? matches ?? [] : patients
  const awaitingFirstResults = isSearching && matches === null

  const emptyMessage = awaitingFirstResults
    ? 'Searching…'
    : searchFailed
      ? 'Search could not be completed. Check your connection and try again.'
      : isSearching
        ? `No patients match “${term}”.`
        : 'No patients yet. Add your first patient!'

  async function loadMore() {
    setLoadingMore(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('patients')
      .select('*')
      .order('name')
      .range(patients.length, patients.length + pageSize - 1)
    if (data) setPatients((prev) => [...prev, ...data])
    setLoadingMore(false)
  }

  const hasMore = patients.length < totalCount

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
            Patients
          </h1>
          <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }} data-testid="patient-list-count">
            {isSearching
              ? awaitingFirstResults
                ? 'Searching all patients…'
                : `${filtered.length}${filtered.length === SEARCH_LIMIT ? '+' : ''} of ${totalCount} match “${term}”`
              : `${totalCount} total · showing ${patients.length}`}
          </div>
        </div>
        <Link
          href="/patients/new"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12.5, fontWeight: 500, padding: '7px 12px', minHeight: 44,
            borderRadius: 6, border: '1px solid var(--ph-accent)',
            background: 'var(--ph-accent)', color: '#fff', textDecoration: 'none',
          }}
        >
          <Plus size={14} />New patient
        </Link>
      </div>

      {/* Search + filter row */}
      <div className="sticky top-0 z-10 bg-[var(--ph-bg)] pb-2 -mx-4 px-4 md:relative md:top-auto md:mx-0 md:px-0 md:pb-0 md:bg-transparent mb-4">
        <div className="ph-search" style={{ flex: 1 }}>
          <Search size={14} style={{ color: 'var(--ph-ink-4)', flexShrink: 0 }} />
          <input
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searching && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--ph-ink-4)', flexShrink: 0 }} aria-label="Searching" />}
        </div>
      </div>

      {/* Desktop table */}
      <div
        className="hidden md:block"
        style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: '36px 2fr 1.2fr 1fr 28px',
          gap: 14, padding: '10px 16px',
          fontSize: 10.5, color: 'var(--ph-ink-4)',
          textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
          borderBottom: '1px solid var(--ph-line)',
        }}>
          <div />
          <div>Patient</div>
          <div>Phone</div>
          <div>Joined</div>
          <div />
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
            {emptyMessage}
          </div>
        ) : (
          filtered.map((patient, i) => (
            <Link
              key={patient.id}
              href={`/patients/${patient.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '36px 2fr 1.2fr 1fr 28px',
                gap: 14, padding: '12px 16px',
                alignItems: 'center',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--ph-line)' : 'none',
                textDecoration: 'none', color: 'inherit',
                transition: 'background 0.1s',
              }}
              className="hover:bg-[var(--ph-bg-soft)]"
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
              <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                {new Date(patient.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
              </div>
              <div style={{ color: 'var(--ph-ink-4)', display: 'flex', justifyContent: 'flex-end' }}>
                <ChevronRight size={16} />
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Mobile card list */}
      <div
        className="md:hidden"
        style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}
      >
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
            {emptyMessage}
          </div>
        ) : (
          filtered.map((patient) => (
            <Link key={patient.id} href={`/patients/${patient.id}`} className="ph-patient-row" style={{ minHeight: 56 }}>
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
            </Link>
          ))
        )}
      </div>

      {/* Search results are capped; refining the term is the way past the cap, not paging. */}
      {isSearching && filtered.length === SEARCH_LIMIT && (
        <p style={{ textAlign: 'center', marginTop: 12, fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
          Showing the first {SEARCH_LIMIT} matches — type more to narrow the search.
        </p>
      )}

      {/* Load more */}
      {hasMore && !isSearching && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: 500, padding: '8px 20px',
              borderRadius: 8, border: '1px solid var(--ph-line)',
              background: 'var(--ph-surface)', color: 'var(--ph-ink-2)',
              cursor: loadingMore ? 'not-allowed' : 'pointer',
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : `Load more (${totalCount - patients.length} remaining)`}
          </button>
        </div>
      )}
    </>
  )
}
