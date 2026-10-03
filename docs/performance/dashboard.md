# Dashboard performance verification

The production audit baseline was mobile P75 LCP 4.29s (47 events, 45 at `/`) and dashboard function P75 2.12s. These are separate measurement surfaces. A local browser result is not a production P75 comparison.

## Changes

- Removed the reminder patient-selector query from the initial dashboard load. It previously fetched/serialized every patient even when no reminder editor was opened. Options now load through an authenticated, RLS-protected action on demand, with pagination, loading/error/retry states.
- Load appointment and reminder form modules on demand.
- Six database policies evaluate request-invariant `auth.uid()` values through scalar subqueries. Ownership, clinic and role predicates are preserved.
- Profile memoization remains deferred: React 18.3.1's installed runtime/types do not expose the proposed `cache` API. Do not substitute a global cache for authenticated data or cast around this mismatch.

## Synthetic database measurements

Disposable local Postgres, 200 synthetic patients and 2,400 appointments, three warm-cache runs per query, authenticated roles:

| Query | Admin median | Staff median |
| --- | ---: | ---: |
| Patient billing balances | 90.35ms | 21.08ms |
| Appointment/patient join, 1,400 rows | 129.07ms | 178.63ms |
| Patient selector, 200 rows | 14.54ms | 14.88ms |

Staff balance inspection was a read-only policy probe; the application never makes that billing request for staff. Existing RLS controls which underlying records contribute. These are local synthetic values, not hosted latency estimates.

For 10,000 synthetic MCP grants, five warm-cache runs of the owning user's SELECT returned the same 10,000 rows before/after. Median execution fell from **2.408ms to 0.930ms** when per-row `auth.uid()` became an InitPlan. This establishes the policy optimization locally, not a claimed dashboard LCP improvement.

The baseline mobile browser samples on local fixtures were admin TTFB 43.1ms/LCP 76ms and staff TTFB 52.7ms/LCP 72ms. Run `e2e/shared/dashboard-observability.spec.ts` on the same build mode/data for new samples; its JSON attachment records TTFB, response end, transferred HTML bytes and the observed LCP candidate. These lightweight samples are not a throttled trace or a real-user percentile.

## Release checks

Verify admin/staff routes, reminder edit/retry, appointment creation, and unavailable-versus-zero metrics. Compare fresh production Speed Insights after deployment with at least 50 comparable mobile samples; target LCP <2.5s and dashboard server P75 <1s. Record collection gaps instead of substituting zero.

A billing aggregate rewrite, broad index additions and dependency upgrades are not included: the local evidence does not isolate an index defect or establish financial equivalence for a replacement query. Continue profiling those if production latency remains high. Full-dataset JavaScript billing summaries still need a separate pagination/aggregation correctness review at large volumes.
