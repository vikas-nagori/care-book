// Paged reads behind the billing Payments and Packages lists (G-6).
//
// /billing server-renders the newest PAGE_SIZE payments and packages; "Load more" reads the next
// page straight from Supabase in the browser. Both sides must use one total order, or rows tied
// on the sort column can be duplicated or skipped between pages, so every read here (and the
// server page) orders by the date column and then by id.
//
// Rows "Load more" brought in are kept across a router.refresh() (a resume, or the re-render that
// follows an audited change): the screen re-reads them with `fetch*Through`, a keyset read from
// the end of the new first page down to the last row the user had loaded, so they come back with
// fresh status, refunds and linked sessions instead of vanishing or going stale.
//
// Every read is complete or throws: a failed refunds read must not show loaded receipts as never
// refunded, with a live Cancel button.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '../supabase/fetch-all.ts'
import { countLinkedSessions } from './billing-overview-totals.ts'
import type { BillingTimelinePackage, BillingTimelinePayment } from './unified-billing.ts'

export const PAYMENT_LIST_SELECT = '*, patient:patients(id, name), package:packages(id, name)'
export const PACKAGE_LIST_SELECT = '*, patient:patients(id, name)'

/** Ids per `.in()` filter: keeps the request URL well under proxy limits. */
const IN_CHUNK = 100

export type BillingRefundRow = {
  id: string
  payment_id: string
  amount: number
  refund_method: string
  refund_date: string
  reason: string
  reversed: boolean
}

export type PaymentPage = {
  rows: BillingTimelinePayment[]
  linkedSessionCounts: Record<string, number>
  refunds: BillingRefundRow[]
}

export type PackagePage = { rows: BillingTimelinePackage[] }

export const EMPTY_PAYMENT_PAGE: PaymentPage = { rows: [], linkedSessionCounts: {}, refunds: [] }
export const EMPTY_PACKAGE_PAGE: PackagePage = { rows: [] }

// The query builders are typed loosely on purpose: the app has no generated Database type, and
// the same helpers serve the browser client and the server client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

type ListOptions = { count?: 'exact' }

/** Payments newest first, in the one order the server page and "Load more" share. */
export function orderedPayments(supabase: Client, options: ListOptions = {}) {
  return supabase.from('payments').select(PAYMENT_LIST_SELECT, options)
    .order('date', { ascending: false }).order('id', { ascending: false })
}

/** Packages newest first, in the one order the server page and "Load more" share. */
export function orderedPackages(supabase: Client, options: ListOptions = {}) {
  return supabase.from('packages').select(PACKAGE_LIST_SELECT, options)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
}

/**
 * PostgREST `or` filter for "at or before `last` in (column desc, id desc) order". Values are
 * quoted, so a timestamp's `:`/`.`/`+` cannot be read as filter syntax.
 */
export function atOrBeforeFilter(column: string, last: { value: string; id: string }): string {
  const value = `"${last.value.replace(/["\\]/g, '')}"`
  const id = `"${last.id.replace(/["\\]/g, '')}"`
  return `${column}.gt.${value},and(${column}.eq.${value},id.gte.${id})`
}

function chunks<T>(values: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size))
  return out
}

type ChunkRead<Row> = (ids: string[], from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>

/**
 * Every row matching `.in(column, ids)`, for any number of ids: the ids go in URL-sized chunks and
 * each chunk is read completely with fetchAllRows. Stops at the first error, returning it with no
 * rows, so a caller never mistakes a partial set for the whole.
 */
export async function readAllByIds<Row>(ids: readonly string[], read: ChunkRead<Row>): Promise<{ data: Row[]; error: unknown }> {
  const rows: Row[] = []
  for (const chunk of chunks(ids)) {
    const { data, error } = await fetchAllRows<Row>((from, to) => read(chunk, from, to))
    if (error) return { data: [], error }
    rows.push(...data)
  }
  return { data: rows, error: null }
}

async function readAll<Row>(ids: readonly string[], read: ChunkRead<Row>): Promise<Row[]> {
  const { data, error } = await readAllByIds(ids, read)
  if (error) throw error
  return data
}

/** Linked-session counts and refunds (with their reversal state) for these payments. */
async function paymentDetails(supabase: Client, rows: BillingTimelinePayment[]): Promise<PaymentPage> {
  const paymentIds = rows.map((payment) => payment.id)
  if (paymentIds.length === 0) return { rows, linkedSessionCounts: {}, refunds: [] }

  const applications = await readAll<{ payment_id: string }>(paymentIds, (chunk, from, to) =>
    supabase.from('payment_applications').select('payment_id').eq('status', 'active')
      .in('payment_id', chunk).order('id').range(from, to))
  const refunds = await readAll<Omit<BillingRefundRow, 'reversed'>>(paymentIds, (chunk, from, to) =>
    supabase.from('refunds').select('id, payment_id, amount, refund_method, refund_date, reason')
      .in('payment_id', chunk).order('id').range(from, to))
  const reversals = await readAll<{ refund_id: string }>(refunds.map((refund) => refund.id), (chunk, from, to) =>
    supabase.from('refund_reversals').select('refund_id').in('refund_id', chunk).order('refund_id').range(from, to))
  const reversedIds = new Set(reversals.map((reversal) => reversal.refund_id))

  return {
    rows,
    linkedSessionCounts: { ...Object.fromEntries(paymentIds.map((id) => [id, 0])), ...countLinkedSessions(applications) },
    refunds: refunds.map((refund) => ({ ...refund, amount: Number(refund.amount), reversed: reversedIds.has(refund.id) })),
  }
}

/** The `pageSize` payments after the first `from`, with their details. Throws on any failed read. */
export async function fetchPaymentPage(supabase: Client, from: number, pageSize: number): Promise<PaymentPage> {
  const { data, error } = await orderedPayments(supabase).range(from, from + pageSize - 1)
  if (error) throw error
  return paymentDetails(supabase, (data ?? []) as BillingTimelinePayment[])
}

/** Every payment after the first `from`, down to and including `last`. Throws on any failed read. */
export async function fetchPaymentsThrough(supabase: Client, from: number, last: BillingTimelinePayment): Promise<PaymentPage> {
  const { data, error } = await fetchAllRows<BillingTimelinePayment>((start, end) =>
    orderedPayments(supabase).or(atOrBeforeFilter('date', { value: last.date, id: last.id })).range(from + start, from + end))
  if (error) throw error
  return paymentDetails(supabase, data)
}

export async function fetchPackagePage(supabase: Client, from: number, pageSize: number): Promise<PackagePage> {
  const { data, error } = await orderedPackages(supabase).range(from, from + pageSize - 1)
  if (error) throw error
  return { rows: (data ?? []) as BillingTimelinePackage[] }
}

export async function fetchPackagesThrough(supabase: Client, from: number, last: BillingTimelinePackage): Promise<PackagePage> {
  const { data, error } = await fetchAllRows<BillingTimelinePackage>((start, end) =>
    orderedPackages(supabase).or(atOrBeforeFilter('created_at', { value: last.created_at, id: last.id })).range(from + start, from + end))
  if (error) throw error
  return { rows: data }
}

/** The server's first page plus the rows loaded after it, each id once (the first page wins). */
export function withLoadedRows<Row extends { id: string }>(firstPage: readonly Row[], loaded: readonly Row[]): Row[] {
  const seen = new Set(firstPage.map((row) => row.id))
  return [...firstPage, ...loaded.filter((row) => !seen.has(row.id))]
}

/** Each refund once; `fresher` wins (the server's rows, until the loaded rows are re-read). */
export function mergeRefunds(fresher: readonly BillingRefundRow[], older: readonly BillingRefundRow[]): BillingRefundRow[] {
  return withLoadedRows(fresher, older)
}

export function appendPaymentPage(current: PaymentPage, next: PaymentPage): PaymentPage {
  return {
    rows: withLoadedRows(current.rows, next.rows),
    linkedSessionCounts: { ...current.linkedSessionCounts, ...next.linkedSessionCounts },
    refunds: mergeRefunds(current.refunds, next.refunds),
  }
}
