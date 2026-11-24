#!/usr/bin/env node
// Summarises a Playwright JSON report (the `json` reporter CI enables in playwright.config.ts) as
// per-project and per-file test time, so the CI split in .github/workflows/test.yml can be
// re-weighted from real numbers instead of test counts.
//
//   node scripts/e2e-timing-summary.mjs e2e-results.json [--label <job>] [--tests]
//
// Markdown goes to stdout (CI appends it to $GITHUB_STEP_SUMMARY). With --tests, one tab-separated
// `E2E-TIMING` line per test goes to stderr, i.e. the job log, in execution order:
//   E2E-TIMING <project> <file> <title> <status> <ms>
// Time per test is the sum of all its attempts, so a retried test counts what it really cost.
import { readFileSync } from 'node:fs'

let file = ''
let label = ''
let perTest = false
for (const args = process.argv.slice(2); args.length > 0; ) {
  const arg = args.shift()
  if (arg === '--label') label = args.shift() ?? ''
  else if (arg === '--tests') perTest = true
  else file = arg
}

if (!file) {
  console.error('usage: e2e-timing-summary.mjs <results.json> [--label <job>] [--tests]')
  process.exit(2)
}

const report = JSON.parse(readFileSync(file, 'utf8'))

/** Flattens the nested suite tree into one entry per (test, project), in report order. */
function collect(suite, fileName, out) {
  const suiteFile = suite.file ?? fileName
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const ms = (test.results ?? []).reduce((sum, result) => sum + (result.duration ?? 0), 0)
      out.push({
        project: test.projectName || '(none)',
        file: spec.file ?? suiteFile,
        title: spec.title,
        status: test.status,
        ms,
        // A test that never started (an earlier failure stopped the run) has no results.
        startTime: test.results?.[0]?.startTime ?? '',
      })
    }
  }
  for (const child of suite.suites ?? []) collect(child, suiteFile, out)
  return out
}

const tests = []
for (const suite of report.suites ?? []) collect(suite, suite.file, tests)

const seconds = (ms) => (ms / 1000).toFixed(1)
const projects = new Map()
const files = new Map()
for (const t of tests) {
  const p = projects.get(t.project) ?? { tests: 0, ran: 0, skipped: 0, flaky: 0, failed: 0, ms: 0 }
  p.tests += 1
  p.ms += t.ms
  if (t.status === 'skipped') p.skipped += 1
  else p.ran += 1
  if (t.status === 'flaky') p.flaky += 1
  if (t.status === 'unexpected') p.failed += 1
  projects.set(t.project, p)

  const key = `${t.project}\t${t.file}`
  const f = files.get(key) ?? { project: t.project, file: t.file, tests: 0, ms: 0 }
  f.tests += 1
  f.ms += t.ms
  files.set(key, f)
}

const totalMs = [...projects.values()].reduce((sum, p) => sum + p.ms, 0)
const wallMs = report.stats?.duration ?? 0
const lines = []
lines.push(`### E2E test time${label ? ` — ${label}` : ''}`)
lines.push('')
lines.push(
  `Playwright wall-clock ${seconds(wallMs)}s; summed test time ${seconds(totalMs)}s ` +
    `(the difference is browser/web-server start-up and worker restarts).`,
)
lines.push('')
lines.push('| Project | Tests | Ran | Skipped | Flaky | Failed | Test time (s) |')
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const [name, p] of [...projects].sort((a, b) => b[1].ms - a[1].ms)) {
  lines.push(`| ${name} | ${p.tests} | ${p.ran} | ${p.skipped} | ${p.flaky} | ${p.failed} | ${seconds(p.ms)} |`)
}
lines.push('')
lines.push('<details><summary>Slowest files</summary>')
lines.push('')
lines.push('| Project | File | Tests | Test time (s) |')
lines.push('| --- | --- | ---: | ---: |')
for (const f of [...files.values()].sort((a, b) => b.ms - a.ms).slice(0, 20)) {
  lines.push(`| ${f.project} | ${f.file} | ${f.tests} | ${seconds(f.ms)} |`)
}
lines.push('')
lines.push('</details>')
lines.push('')
process.stdout.write(lines.join('\n'))

if (perTest) {
  // Execution order, so a slice boundary can be simulated exactly from the log.
  const ordered = [...tests].sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0))
  for (const t of ordered) {
    process.stderr.write(['E2E-TIMING', t.project, t.file, t.title, t.status, t.ms].join('\t') + '\n')
  }
}
