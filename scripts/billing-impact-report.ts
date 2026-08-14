#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'

import { assertApprovedBillingImpactPlan, buildBillingImpactReport, type BillingImpactPlan } from '../src/lib/billing/impact-report.ts'
import { CARE_BOOK_PRODUCTION_PROJECT_REF, assertExpectedSupabaseProject, fetchSupabaseBillingSource } from '../src/lib/billing/impact-rest.ts'
import { mapSupabaseBillingSource } from '../src/lib/billing/impact-source.ts'
import { buildBillingSourceRowCounts, buildLiveDatabaseFingerprint } from '../src/lib/billing/live-db-fingerprint.ts'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const outputPath = argument('--output')
const planPath = argument('--plan')
if (!supabaseUrl || !serviceRoleKey || !outputPath || !planPath) {
  throw new Error('Usage requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, --plan and --output.')
}
assertExpectedSupabaseProject(supabaseUrl, CARE_BOOK_PRODUCTION_PROJECT_REF)

const plan = JSON.parse(await readFile(planPath, 'utf8')) as BillingImpactPlan
assertApprovedBillingImpactPlan(plan)
const raw = await fetchSupabaseBillingSource({ supabaseUrl, serviceRoleKey })
const report = buildBillingImpactReport(
  mapSupabaseBillingSource(raw), plan, buildLiveDatabaseFingerprint(raw), buildBillingSourceRowCounts(raw),
)
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })

process.stdout.write(JSON.stringify({
  outputPath,
  inputFingerprint: report.inputFingerprint,
  liveDbFingerprint: report.liveDbFingerprint,
  liveDbFingerprintVersion: report.liveDbFingerprintVersion,
  sourceRowCounts: report.sourceRowCounts,
  planFingerprint: report.planFingerprint,
  reportChecksum: report.reportChecksum,
  patients: report.patients.length,
  invariantFailures: report.invariantFailures.length,
}) + '\n')
if (report.invariantFailures.length > 0) {
  throw new Error(`Billing impact report blocked by ${report.invariantFailures.length} invariant failure(s).`)
}
