// Complete, chunked reads for PostgREST queries.
//
// PostgREST caps an un-ranged select at its `max-rows` setting (1000 on Supabase) and returns the
// truncated set *without* an error — so a query that outgrows the cap starts silently reporting
// wrong totals. Every aggregate-over-all-rows read goes through here instead: it walks `.range()`
// windows until a short chunk proves the table is exhausted, and it throws at a hard ceiling rather
// than ever handing back a partial set that a caller might mistake for the whole thing.

/** Supabase's `max-rows`. Chunks are sized to it so a full chunk means "there is probably more". */
export const POSTGREST_MAX_ROWS = 1000

/**
 * A cap on total rows pulled into memory for one metric. Far above real volume (the busiest month on
 * record is ~300 rows), so hitting it means something is wrong — a missing filter, or growth that
 * warrants server-side aggregation. Failing loudly is the point.
 */
export const DEFAULT_HARD_CAP = 20_000

export type ChunkResult<Row, Err> = { data: Row[] | null; error: Err | null }

/**
 * Fetch every row a query matches, in `chunkSize` windows.
 *
 * `runChunk` receives an inclusive `[from, to]` range — pass it straight to `.range()`. Iteration
 * stops on the first chunk shorter than `chunkSize`, which is the only reliable end-of-data signal
 * PostgREST gives. A query error aborts immediately and is returned with empty `data`, so a caller
 * can never treat a half-read set as complete.
 *
 * @throws when the accumulated row count exceeds `hardCap` — deliberately, in place of truncating.
 */
export async function fetchAllRows<Row, Err = unknown>(
  runChunk: (from: number, to: number) => PromiseLike<ChunkResult<Row, Err>>,
  { chunkSize = POSTGREST_MAX_ROWS, hardCap = DEFAULT_HARD_CAP }: { chunkSize?: number; hardCap?: number } = {},
): Promise<{ data: Row[]; error: Err | null }> {
  const all: Row[] = []

  for (let from = 0; ; from += chunkSize) {
    const { data, error } = await runChunk(from, from + chunkSize - 1)
    if (error) return { data: [], error }

    const chunk = data ?? []
    all.push(...chunk)

    if (all.length > hardCap) {
      throw new Error(
        `fetchAllRows exceeded its hard cap of ${hardCap} rows — refusing to return a truncated result`,
      )
    }
    if (chunk.length < chunkSize) return { data: all, error: null }
  }
}
