import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const dashboardSource = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8')
const billingPageSource = readFileSync(join(process.cwd(), 'src/app/billing/page.tsx'), 'utf8')
const billingViewSource = readFileSync(join(process.cwd(), 'src/app/billing/billing-view.tsx'), 'utf8')

test('mobile dashboard shows New billing only to billing-enabled admins', () => {
  assert.match(dashboardSource, /access\.canViewBilling \? 'grid-cols-2' : 'grid-cols-1'/)
  assert.match(dashboardSource, /access\.canViewBilling\s*&&\s*\(/)
  assert.match(dashboardSource, /href="\/billing\?new=1"/)
  assert.match(dashboardSource, /New billing/)
  assert.doesNotMatch(dashboardSource, /Find patient/)
})

test('billing deep link opens the existing entry dialog once and clears the flag on close', () => {
  assert.match(billingPageSource, /new\?: string/)
  assert.match(billingPageSource, /initialEntryOpen=\{newEntry === '1'\}/)
  assert.match(billingViewSource, /initialEntryOpen: boolean/)
  assert.match(billingViewSource, /useState\(initialEntryOpen\)/)
  assert.match(billingViewSource, /router\.replace\(cleanBillingUrl/)
})
