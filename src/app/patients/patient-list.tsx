'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus } from 'lucide-react'
import { PatientListHeader, PatientRows, PatientSearchBar } from '@/components/patients/patient-rows'
import { createClient } from '@/lib/supabase/client'
import { buildPatientSearchFilter, normalizePatientSearchTerm } from '@/lib/patients/patient-search-filter'
import type { Patient } from '@/lib/supabase/types'

/** Most matches we render for one term; beyond this the caller should refine the search. */
const SEARCH_LIMIT = 50
const SEARCH_DEBOUNCE_MS = 250


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
      <PatientListHeader
        title="Patients"
        subtitle={isSearching
          ? awaitingFirstResults
            ? 'Searching all patients…'
            : `${filtered.length}${filtered.length === SEARCH_LIMIT ? '+' : ''} of ${totalCount} match “${term}”`
          : `${totalCount} total · showing ${patients.length}`}
        action={
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
        }
      />

      <PatientSearchBar value={search} onChange={setSearch} searching={searching} />

      <PatientRows
        patients={filtered}
        emptyMessage={emptyMessage}
        actionFor={(patient) => ({ href: `/patients/${patient.id}` })}
        detailColumn={{
          label: 'Joined',
          render: (patient) => new Date(patient.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }),
        }}
      />

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
