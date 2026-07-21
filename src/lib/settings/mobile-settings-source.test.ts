import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

const pageSource = source('src/app/settings/page.tsx')
const responsiveViewSource = source('src/app/settings/responsive-settings-view.tsx')
const mobileViewSource = source('src/app/settings/mobile-settings-view.tsx')
const sheetSource = source('src/components/ui/sheet.tsx')
const externalStaffSource = source('src/app/settings/external-staff-list.tsx')
const invitesSource = source('src/app/settings/user-invites-list.tsx')
const usersSource = source('src/app/settings/users-list.tsx')
const settingsFormSource = source('src/app/settings/settings-form.tsx')

test('settings page passes normalized server data into one responsive coordinator', () => {
  assert.equal(pageSource.match(/<SettingsResponsiveView/g)?.length, 2)
  assert.match(pageSource, /accessLevel="profile_only"/)
  assert.match(pageSource, /accessLevel="admin"/)
  assert.match(pageSource, /appointmentTypes=\{appointmentTypes \?\? \[\]\}/)
  assert.match(pageSource, /settings=\{globalSettings \?\? null\}/)
  assert.match(pageSource, /profiles=\{activeProfiles\}/)
  assert.match(pageSource, /isExternalStaffSchemaMissing=\{externalStaffError\?\.code === 'PGRST205'\}/)
  assert.doesNotMatch(pageSource, /<MobileSettingsView|<AccountSummary|<AppointmentTypesList/)
  assert.match(responsiveViewSource, /useSettingsDesktopLayout\(\)/)
  assert.match(responsiveViewSource, /if \(isDesktop\)/)
  assert.match(responsiveViewSource, /hidden space-y-6 md:block/)
  assert.match(responsiveViewSource, /md:hidden/)
  assert.match(mobileViewSource, /variant="sheet"/)
  assert.match(responsiveViewSource, /<SettingsForm settings=\{settings\}/)
  assert.match(mobileViewSource, /<SettingsForm settings=\{settings\} variant="sheet"/)
})

test('mobile settings uses one controlled bottom sheet for all semantic menu buttons', () => {
  assert.match(mobileViewSource, /selectedSection, setSelectedSection/)
  assert.match(mobileViewSource, /sheetOpen, setSheetOpen/)
  assert.equal(mobileViewSource.match(/<Sheet\s/g)?.length, 1)
  assert.match(mobileViewSource, /open=\{sheetOpen\}/)
  assert.match(mobileViewSource, /onOpenChange=\{\(open\) => \{/)
  assert.match(mobileViewSource, /setSheetOpen\(open\)/)
  assert.doesNotMatch(mobileViewSource, /if \(!open\) setSelectedSection\(null\)/)
  assert.match(mobileViewSource, /<button/)
  assert.match(mobileViewSource, /aria-hidden="true"/)
  assert.match(mobileViewSource, /<SheetTitle/)
})

test('controlled sheet restores focus to its menu button and keeps a 44px close hit target', () => {
  assert.match(mobileViewSource, /useRef<HTMLButtonElement \| null>\(null\)/)
  assert.match(mobileViewSource, /lastTriggerRef\.current = event\.currentTarget/)
  assert.match(mobileViewSource, /shouldRestoreSettingsFocus\([\s\S]*trigger\.getClientRects\(\)\.length/)
  assert.match(mobileViewSource, /onCloseAutoFocus=\{\(event\) => \{[\s\S]*trigger\.focus\(\)/)
  assert.match(sheetSource, /h-11 w-11/)
  assert.match(sheetSource, /h-\[30px\] w-\[30px\][^\n]*bg-\[var\(--ph-bg-soft\)\]/)
})

test('responsive coordinator hydrates from mobile and unmounts the mobile portal at md', () => {
  assert.match(responsiveViewSource, /useSyncExternalStore/)
  assert.match(responsiveViewSource, /SETTINGS_DESKTOP_MEDIA_QUERY/)
  assert.match(responsiveViewSource, /window\.matchMedia/)
  assert.match(responsiveViewSource, /getSettingsServerSnapshot/)
  assert.ok(
    responsiveViewSource.indexOf('if (isDesktop)') < responsiveViewSource.indexOf('<MobileSettingsView'),
    'desktop branch should return before mobile branch is constructed',
  )
})

test('sheet variants branch before constructing desktop and mobile list representations', () => {
  for (const [path, componentSource] of [
    ['external-staff-list.tsx', externalStaffSource],
    ['user-invites-list.tsx', invitesSource],
    ['users-list.tsx', usersSource],
  ] as const) {
    assert.doesNotMatch(componentSource, /const desktopList|const mobileList/, path)
    assert.ok(
      componentSource.indexOf("if (variant === 'sheet')") < componentSource.indexOf('<Table>'),
      `${path} should choose its variant before building the desktop table`,
    )
  }
})

test('mobile invite dates preserve revoked semantics and user-controlled names can wrap', () => {
  assert.match(invitesSource, /`Revoked \$\{formatTimestamp\(invite\.revoked_at\)\}`/)
  assert.doesNotMatch(invitesSource, /`Updated \$\{formatTimestamp\(invite\.updated_at\)\}`/)
  assert.match(externalStaffSource, /min-w-0[^"']*\[overflow-wrap:anywhere\]/)
  assert.match(usersSource, /min-w-0[^"']*\[overflow-wrap:anywhere\]/)
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
    'src/app/settings/settings-form.tsx',
  ]) {
    const componentSource = source(path)
    assert.match(componentSource, /useId\(\)/, `${path} should use React useId`)
  }
})

test('session fees form preserves its card and sheet presentations', () => {
  assert.match(settingsFormSource, /variant\?: 'card' \| 'sheet'/)
  assert.match(settingsFormSource, /if \(variant === 'sheet'\)/)
  assert.match(settingsFormSource, /Clinic Visit Fee \(₹\)/)
  assert.match(settingsFormSource, /Home Visit Fee \(₹\)/)
})
