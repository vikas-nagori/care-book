import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ALL_ACCOUNTS,
  AUTHENTICATED_ACCOUNTS,
  PLATFORM,
  PLATFORM_SIGNOUT,
} from './accounts.ts'

test('Playwright owns the E2E server by default instead of reusing an arbitrary port 3000 process', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const reuseSetting = config.match(/reuseExistingServer:\s*([^,\n]+)/)?.[1]?.trim()

  assert.equal(reuseSetting, 'false')
})

test('the full local Supabase matrix uses one worker to avoid exhausting GoTrue database connections', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const workersSetting = config.match(/workers:\s*([^,\n]+)/)?.[1]?.trim()

  assert.equal(workersSetting, '1')
})

test('critical clinic write flows run for both admin and staff projects', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const patientsSpec = readFileSync(new URL('../shared/patients.spec.ts', import.meta.url), 'utf8')
  const scheduleSpec = readFileSync(new URL('../shared/schedule-write-flows.spec.ts', import.meta.url), 'utf8')

  for (const projectName of ['admin-desktop', 'admin-mobile', 'staff-desktop', 'staff-mobile']) {
    const project = config.match(new RegExp(`name: '${projectName}',[\\s\\S]*?\\n\\s*},`))?.[0] ?? ''
    assert.match(project, /testMatch:\s*\['shared\/\*\*\/\*\.spec\.ts'/, projectName)
  }
  assert.match(patientsSpec, /creates a representative patient/)
  assert.match(patientsSpec, /edits a factory-owned patient/)
  assert.match(scheduleSpec, /books a shared appointment/)
  assert.match(scheduleSpec, /books a restricted appointment/)
  assert.match(scheduleSpec, /changes appointment status/)
  assert.match(scheduleSpec, /adds a SOAP session note/)
  assert.match(scheduleSpec, /deletes a scheduled appointment/)
})

test('platform sign-out runs only after the platform desktop project completes', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const signoutSpec = readFileSync(new URL('../platform/zz-signout.spec.ts', import.meta.url), 'utf8')
  const env = readFileSync(new URL('../../.env.e2e', import.meta.url), 'utf8')
  const platformProject = config.match(/name: 'platform-desktop',[\s\S]*?\n\s*},/)?.[0] ?? ''
  const signoutProject = config.match(/name: 'platform-signout',[\s\S]*?\n\s*},/)?.[0] ?? ''
  const allowlist = env.match(/^PLATFORM_ADMIN_EMAILS=(.+)$/m)?.[1]?.split(',') ?? []

  assert.match(platformProject, /testIgnore:\s*\['platform\/zz-signout\.spec\.ts'\]/)
  assert.match(signoutProject, /dependencies:\s*\['platform-desktop'\]/)
  assert.match(signoutProject, /testMatch:\s*\['platform\/zz-signout\.spec\.ts'\]/)
  assert.match(signoutProject, /storageState:\s*\{\s*cookies:\s*\[\],\s*origins:\s*\[\]\s*}/)
  assert.notEqual(PLATFORM_SIGNOUT.email, PLATFORM.email)
  assert.ok(ALL_ACCOUNTS.includes(PLATFORM_SIGNOUT))
  assert.ok(!AUTHENTICATED_ACCOUNTS.includes(PLATFORM_SIGNOUT))
  assert.ok(allowlist.includes(PLATFORM.email))
  assert.ok(allowlist.includes(PLATFORM_SIGNOUT.email))
  assert.match(signoutSpec, /signIn\(page,\s*PLATFORM_SIGNOUT\)/)
  assert.doesNotMatch(signoutSpec, /signIn\(page,\s*PLATFORM\)/)
})

test('the browser runs on the clinic calendar so seeded dates and the dashboard agree', () => {
  // Without this, the browser inherits the runner's UTC clock while the seed dates fixtures in IST.
  // Between 18:30 and 24:00 UTC those are different calendar days and today's appointments
  // disappear from the dashboard, failing the suite for five and a half hours every day.
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const timezoneSetting = config.match(/timezoneId:\s*([^,\n]+)/)?.[1]?.trim()

  assert.equal(timezoneSetting, "'Asia/Kolkata'")
})

test('the app server shares the browser clinic calendar so nothing hydrates mismatched', () => {
  // Browser-only pinning renders dates in the runner's zone on the server and the clinic zone on
  // the client. React reports that as hydration error #418 and the page-error guards fail the test.
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const webServerBlock = config.match(/webServer:\s*\{[\s\S]*?\n\s{2}\},/)?.[0] ?? ''

  assert.match(webServerBlock, /env:\s*\{\s*TZ:\s*'Asia\/Kolkata'\s*\}/)
})

test('the web server builds by default and only skips the build when CI has already produced one', () => {
  // CI overlaps `next build` with the Supabase boot and then passes E2E_PREBUILT=1. Any other
  // caller must still get a fresh build so a stale .next directory is never what gets tested.
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const command = config.match(/command:\s*([^\n]+),\n/)?.[1]?.trim() ?? ''

  assert.match(config, /process\.env\.E2E_PREBUILT === '1'/)
  assert.match(command, /PREBUILT \? 'npm run start:e2e' : 'npm run build:e2e && npm run start:e2e'/)
})

test('an iPhone WebKit project runs the @ios subset as the clinic admin, in its own CI job', () => {
  // Every iPhone runs the installed app on WebKit, which the Pixel 5 projects never exercise
  // (decision D5). WebKit is installed only in the `e2e-ios` job, which runs this project in
  // parallel with the shards so no shard carries it, and the `e2e` gate requires it.
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8')
  const iosProject = config.match(/name: 'mobile-ios',[\s\S]*?\n\s*}/)?.[0] ?? ''

  assert.match(iosProject, /devices\['iPhone 14'\]/)
  assert.match(iosProject, /grep:\s*\/@ios\//)
  assert.match(iosProject, /storageState:\s*ADMIN\.storageState/)
  assert.match(iosProject, /dependencies:\s*\['setup'\]/)
  assert.match(config, /process\.env\.E2E_SKIP_IOS === '1'/)

  const shardJob = workflowJob(workflow, 'e2e-shard')
  const iosJob = workflowJob(workflow, 'e2e-ios')
  const gate = workflowJob(workflow, 'e2e')

  // The shard runners never see the project: E2E_SKIP_IOS removes it from their config, so even
  // naming it in an e2e-shard group would fail loudly instead of running it without WebKit.
  assert.match(shardJob, /E2E_SKIP_IOS: '1'/)
  assert.doesNotMatch(shardJob, /webkit|mobile-ios/)
  assert.ok(matrixEntries('e2e-ios', iosJob).every((entry) => entry.projects.join(' ') === 'mobile-ios'))
  assert.match(iosJob, /playwright install --with-deps chromium webkit/)
  assert.match(iosJob, /E2E_PREBUILT: '1'/)
  assert.doesNotMatch(iosJob, /E2E_SKIP_IOS/)
  const webkitInstalls = workflow.match(/playwright install[^\n]*webkit/g) ?? []
  assert.equal(webkitInstalls.length, 2, 'only e2e-ios installs WebKit (cache miss and cache hit)')
  assert.ok(webkitInstalls.every((line) => iosJob.includes(line)))
  assert.match(gate, /needs: \[e2e-shard, e2e-ios\]/)
  assert.match(gate, /if: always\(\)/)
})

// ---------------------------------------------------------------------------------------------
// CI split. The e2e jobs run as matrix entries that each name a group of Playwright projects and
// one slice of it (.github/workflows/test.yml). These tests keep that split complete: a project
// nobody assigned would otherwise never run in CI, and nothing would turn red.
// ---------------------------------------------------------------------------------------------

const E2E_JOBS = ['e2e-shard', 'e2e-ios']

/** One top-level job of the workflow, comments dropped (a job's leading comment would otherwise
 * end up in the block above it). */
function workflowJob(workflow: string, name: string): string {
  const jobs = workflow.replace(/^\s*#.*\n/gm, '').split(/\n(?=  [a-z][\w-]*:\n)/)
  return jobs.find((block) => block.startsWith(`  ${name}:\n`)) ?? ''
}

type MatrixEntry = { job: string; group: string; projects: string[]; slice: number; slices: number }

/** The job's `matrix.include` entries, written one flow mapping per line. */
function matrixEntries(job: string, block: string): MatrixEntry[] {
  const include = block.match(/\n {6}matrix:\n {8}include:\n((?: {10}- \{[^\n]*\}\n)+)/)?.[1]
  assert.ok(include, `${job}: matrix.include must list one "- { … }" entry per line`)
  return include.trim().split('\n').map((line) => {
    const body = line.trim().replace(/^- \{\s*/, '').replace(/\s*\}$/, '')
    const fields = Object.fromEntries(
      body.split(/,\s*/).map((pair) => {
        const [key, ...value] = pair.split(':')
        return [key.trim(), value.join(':').trim().replace(/^'(.*)'$/, '$1')]
      }),
    )
    return {
      job,
      group: fields.group ?? '',
      projects: (fields.projects ?? '').split(/\s+/).filter(Boolean),
      slice: Number(fields.slice),
      slices: Number(fields.slices),
    }
  })
}

type ProjectDecl = { name: string; dependencies: string[]; setup: boolean }

/** Every project declared in playwright.config.ts, conditional ones (mobile-ios) included. */
function configProjects(config: string): ProjectDecl[] {
  const section = config.slice(config.indexOf('projects: ['))
  const names = [...section.matchAll(/name: '([\w-]+)'/g)]
  return names.map((match, i) => {
    const block = section.slice(match.index, names[i + 1]?.index ?? section.length)
    const dependencies = block.match(/dependencies:\s*\[([^\]]*)\]/)?.[1].match(/[\w-]+/g) ?? []
    return { name: match[1], dependencies, setup: /testMatch:\s*\/[^\n]*setup/.test(block) }
  })
}

/** Everything wrong with how the matrix covers the projects; empty when the split is sound. */
function splitProblems(entries: MatrixEntry[], projects: ProjectDecl[]): string[] {
  const problems: string[] = []
  const declared = new Map(projects.map((project) => [project.name, project]))
  const groups = new Map<string, MatrixEntry[]>()
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry])

  const owner = new Map<string, string>()
  for (const [group, members] of groups) {
    const [first] = members
    const projectSet = first.projects.join(' ')
    if (!group) problems.push('an entry has no group')
    if (first.projects.length === 0) problems.push(`${group}: names no project`)
    for (const member of members) {
      if (member.projects.join(' ') !== projectSet) problems.push(`${group}: entries name different projects`)
      if (member.slices !== first.slices) problems.push(`${group}: entries disagree on slices`)
      if (member.job !== first.job) problems.push(`${group}: split across ${member.job} and ${first.job}`)
    }
    const slices = members.map((member) => member.slice).sort((a, b) => a - b)
    const expected = Array.from({ length: first.slices }, (_, i) => i + 1)
    if (!Number.isInteger(first.slices) || first.slices < 1 || slices.join(',') !== expected.join(',')) {
      problems.push(`${group}: slices are [${slices}], expected exactly [${expected}] of ${first.slices}`)
    }
    for (const name of first.projects) {
      const project = declared.get(name)
      if (!project) problems.push(`${group}: unknown project ${name}`)
      else if (project.setup) problems.push(`${group}: ${name} is a setup project; it runs as a dependency`)
      if (owner.has(name) && owner.get(name) !== group) {
        problems.push(`${name} runs in two groups: ${owner.get(name)} and ${group}`)
      }
      owner.set(name, group)
    }
  }

  for (const project of projects) {
    if (project.setup) continue
    const group = owner.get(project.name)
    if (!group) {
      problems.push(`${project.name} is in no CI group, so CI never runs it`)
      continue
    }
    // Playwright runs a dependency in full wherever its dependant runs. Outside the dependant's
    // group, or in a sliced group, the dependency's tests would run more than once.
    for (const dependency of project.dependencies) {
      if (declared.get(dependency)?.setup) continue
      if (owner.get(dependency) !== group) {
        problems.push(`${project.name} depends on ${dependency}, which must share its group`)
      }
      if ((groups.get(group)?.[0].slices ?? 1) !== 1) {
        problems.push(`${group} holds a dependency chain (${project.name} -> ${dependency}) and cannot be sliced`)
      }
    }
  }
  return problems
}

function ciSplit() {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8')
  const entries = E2E_JOBS.flatMap((job) => matrixEntries(job, workflowJob(workflow, job)))
  return { workflow, entries, projects: configProjects(config) }
}

test('every Playwright project runs in exactly one CI group, whose slices are exactly 1..n', () => {
  const { entries, projects } = ciSplit()

  // The parser must see the real config, or an empty list would pass trivially.
  assert.ok(projects.some((project) => project.name === 'setup' && project.setup))
  assert.ok(projects.some((project) => project.name === 'mobile-ios' && !project.setup))
  assert.ok(projects.filter((project) => !project.setup).length >= 11)
  assert.deepEqual(splitProblems(entries, projects), [])
})

test('the CI split guard rejects an unassigned project, a missing slice and a sliced dependency', () => {
  const { entries, projects } = ciSplit()
  const sliced = entries.find((entry) => entry.slices > 1)
  assert.ok(sliced, 'at least one group is sliced')
  const signoutGroup = entries.find((entry) => entry.projects.includes('platform-signout'))
  assert.ok(signoutGroup)

  const newProject = [...projects, { name: 'new-project', dependencies: ['setup'], setup: false }]
  assert.ok(splitProblems(entries, newProject).some((problem) => problem.includes('new-project is in no CI group')))

  const missingSlice = entries.filter((entry) => entry !== sliced)
  assert.ok(splitProblems(missingSlice, projects).some((problem) => problem.startsWith(`${sliced.group}: slices`)))

  const twice = [...entries, { ...sliced, group: 'duplicate', slice: 1, slices: 1 }]
  assert.ok(splitProblems(twice, projects).some((problem) => problem.includes('runs in two groups')))

  const slicedChain = entries
    .filter((entry) => entry.group !== signoutGroup.group)
    .concat([1, 2].map((slice) => ({ ...signoutGroup, slice, slices: 2 })))
  assert.ok(splitProblems(slicedChain, projects).some((problem) => problem.includes('cannot be sliced')))
})

test('each e2e runner runs exactly its own matrix entry and uploads a uniquely named report on failure', () => {
  const { workflow } = ciSplit()
  for (const job of E2E_JOBS) {
    const block = workflowJob(workflow, job)
    assert.match(block, /fail-fast: false/, job)
    // The check name and the artifact name carry the group and slice, so they are unique per entry.
    assert.match(block, /\n {4}name: [\w-]+ \([^\n]*\$\{\{ matrix\.slice \}\}\/\$\{\{ matrix\.slices \}\}\)\n/, job)
    assert.match(block, /PROJECTS: \$\{\{ matrix\.projects \}\}/, job)
    assert.match(block, /SLICE: \$\{\{ matrix\.slice \}\}\/\$\{\{ matrix\.slices \}\}/, job)
    assert.match(block, /for project in \$PROJECTS; do args\+=\("--project=\$project"\); done/, job)
    assert.match(block, /npm run test:e2e -- "\$\{args\[@\]\}" --shard="\$SLICE"/, job)
    assert.match(
      block,
      /if: failure\(\)\n\s+uses: actions\/upload-artifact@v4\n\s+with:\n\s+name: playwright-report-\$\{\{ matrix\.group \}\}-\$\{\{ matrix\.slice \}\}of\$\{\{ matrix\.slices \}\}\n/,
      job,
    )
    // The ports are reserved before any step can open a connection, and the start is retried once.
    assert.match(block, /steps:\n\s+- name: Reserve the local Supabase ports\n\s+run: \|\n[^\n]*\n\s+sudo sysctl -w net\.ipv4\.ip_local_reserved_ports=54320-54329\n/, job)
    assert.match(block, /npx supabase stop --no-backup \|\| true\n\s+start_supabase\n/, job)
  }
})
