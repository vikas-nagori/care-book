import { execFileSync } from 'node:child_process'
import { collectLogPages, type LogRecord } from '../src/lib/observability/log-pages.ts'

const [start, end] = process.argv.slice(2)
if (!start?.endsWith('Z') || !end?.endsWith('Z')) throw new Error('Usage: node --experimental-strip-types scripts/audit-vercel-errors.ts START_UTC END_UTC')
const logs = await collectLogPages(async until => {
  const output = execFileSync('vercel', [
    'logs', '--project', 'care-book', '--scope', 'vikasrnagorigmailcoms-projects',
    '--environment', 'production', '--no-branch', '--since', start, '--until', until,
    '--level', 'error', '--limit', '50', '--json',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 60_000 })
  return output.split('\n').filter(Boolean).map(line => JSON.parse(line) as LogRecord)
}, start, end)
const statuses: Record<string, number> = {}
for (const row of logs) {
  const status = String(row.responseStatusCode ?? 'unknown')
  statuses[status] = (statuses[status] ?? 0) + 1
}
// Summaries only. Runtime messages/paths can contain clinical data and stay out of artifacts.
console.log(JSON.stringify({ start, end, complete: true, uniqueErrors: logs.length,
  expectedMissingSession: logs.filter(row => row.message?.includes('Auth session missing!')).length,
  statuses,
}, null, 2))
