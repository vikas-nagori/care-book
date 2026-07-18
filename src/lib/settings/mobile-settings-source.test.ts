import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

const pageSource = source('src/app/settings/page.tsx')
const mobileViewSource = source('src/app/settings/mobile-settings-view.tsx')
const sheetSource = source('src/components/ui/sheet.tsx')

test('settings page preserves desktop content and passes normalized server data to mobile settings', () => {
  assert.match(pageSource, /hidden md:block/)
  assert.match(pageSource, /md:hidden/)
  assert.match(pageSource, /<MobileSettingsView/)
  assert.match(pageSource, /appointmentTypes=\{appointmentTypes \?\? \[\]\}/)
  assert.match(pageSource, /profiles=\{activeProfiles\}/)
  assert.match(pageSource, /isExternalStaffSchemaMissing=\{externalStaffError\?\.code === 'PGRST205'\}/)
  assert.match(mobileViewSource, /variant="sheet"/)
})

test('mobile settings uses one controlled bottom sheet for all semantic menu buttons', () => {
  assert.match(mobileViewSource, /useState<MobileSettingsSectionKey \| null>\(null\)/)
  assert.equal(mobileViewSource.match(/<Sheet\s/g)?.length, 1)
  assert.match(mobileViewSource, /open=\{openSection !== null\}/)
  assert.match(mobileViewSource, /onOpenChange=\{\(open\) => \{/)
  assert.match(mobileViewSource, /if \(!open\) setOpenSection\(null\)/)
  assert.match(mobileViewSource, /<button/)
  assert.match(mobileViewSource, /aria-hidden="true"/)
  assert.match(mobileViewSource, /<SheetTitle/)
})

test('controlled sheet restores focus to its menu button and keeps a 44px close hit target', () => {
  assert.match(mobileViewSource, /useRef<HTMLButtonElement \| null>\(null\)/)
  assert.match(mobileViewSource, /lastTriggerRef\.current = event\.currentTarget/)
  assert.match(mobileViewSource, /onCloseAutoFocus=\{\(event\) => \{[\s\S]*lastTriggerRef\.current\?\.focus\(\)/)
  assert.match(sheetSource, /h-11 w-11/)
  assert.match(sheetSource, /h-\[30px\] w-\[30px\][^\n]*bg-\[var\(--ph-bg-soft\)\]/)
})

test('bottom sheet has the required mobile geometry, safe area, overlay, and drag handle', () => {
  assert.match(sheetSource, /bg-\[rgba\(20,18,16,\.42\)\]/)
  assert.match(sheetSource, /max-h-\[80dvh\]/)
  assert.match(sheetSource, /rounded-t-\[22px\]/)
  assert.match(sheetSource, /overflow-y-auto/)
  assert.match(sheetSource, /env\(safe-area-inset-bottom/)
  assert.match(sheetSource, /h-1 w-\[38px\]/)
})

test('duplicated interactive settings sections derive form control IDs per instance', () => {
  for (const path of [
    'src/app/settings/appointment-types-list.tsx',
    'src/app/settings/package-templates-list.tsx',
    'src/app/settings/invite-form.tsx',
    'src/app/settings/external-staff-list.tsx',
  ]) {
    const componentSource = source(path)
    assert.match(componentSource, /useId\(\)/, `${path} should use React useId`)
  }
})
