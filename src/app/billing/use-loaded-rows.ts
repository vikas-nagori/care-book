'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requestErrorMessage } from '@/lib/actions/request-error-message'
import { createClient } from '@/lib/supabase/client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

/** How one billing list reads its pages. Define it at module level: the hook keys effects on it. */
export type LoadedRowsSource<Row extends { id: string }, Page extends { rows: Row[] }> = {
  empty: Page
  /** The `pageSize` rows after the first `from`. Throws on any failed read. */
  fetchPage: (supabase: Client, from: number, pageSize: number) => Promise<Page>
  /** Every row after the first `from`, down to and including `last`. Throws on any failed read. */
  fetchThrough: (supabase: Client, from: number, last: Row) => Promise<Page>
  append: (current: Page, next: Page) => Page
  loadErrorTitle: string
  refreshErrorTitle: string
}

type Notify = (input: { title: string; description: string; variant: 'destructive' }) => unknown

/**
 * Rows a list loaded with "Load more", below the server's first page (G-6).
 *
 * The server page is re-rendered on every router.refresh() — the resume refresh, and the
 * re-render an audited change ships back. The rows loaded below it are then re-read down to the
 * last one the user had, so they stay on screen with fresh data instead of being dropped (or
 * kept stale). If that re-read fails the loaded rows are dropped, with a message, rather than
 * shown with out-of-date money figures.
 */
export function useLoadedRows<Row extends { id: string }, Page extends { rows: Row[] }>(
  source: LoadedRowsSource<Row, Page>,
  firstPage: readonly Row[],
  pageSize: number,
  notify: Notify,
) {
  const [loaded, setLoaded] = useState<Page>(source.empty)
  const [loading, setLoading] = useState(false)
  const loadedRef = useRef<Page>(source.empty)
  // Bumped by every read; a read that finishes after a newer one started is ignored.
  const generation = useRef(0)

  const commit = useCallback((page: Page) => {
    loadedRef.current = page
    setLoaded(page)
  }, [])

  useEffect(() => {
    const current = loadedRef.current
    if (current.rows.length === 0) return
    const run = ++generation.current
    const last = current.rows[current.rows.length - 1]
    setLoading(true)
    source.fetchThrough(createClient(), firstPage.length, last)
      .then((page) => {
        if (run === generation.current) commit(page)
      })
      .catch((error: unknown) => {
        if (run !== generation.current) return
        commit(source.empty)
        notify({ title: source.refreshErrorTitle, description: requestErrorMessage(error), variant: 'destructive' })
      })
      .finally(() => {
        if (run === generation.current) setLoading(false)
      })
  }, [firstPage, source, commit, notify])

  const loadMore = useCallback(async () => {
    const run = ++generation.current
    setLoading(true)
    try {
      const next = await source.fetchPage(createClient(), firstPage.length + loadedRef.current.rows.length, pageSize)
      if (run === generation.current) commit(source.append(loadedRef.current, next))
    } catch (error) {
      // fetchAllRows throws at its row cap and every read can fail: say so, never stick on "Loading…".
      if (run === generation.current) notify({ title: source.loadErrorTitle, description: requestErrorMessage(error), variant: 'destructive' })
    } finally {
      if (run === generation.current) setLoading(false)
    }
  }, [firstPage, pageSize, source, commit, notify])

  return { loaded, loading, loadMore }
}
