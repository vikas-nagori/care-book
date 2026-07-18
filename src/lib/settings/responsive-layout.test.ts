import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSettingsServerSnapshot,
  SETTINGS_DESKTOP_MEDIA_QUERY,
  shouldRestoreSettingsFocus,
} from './responsive-layout.ts'

test('settings responsive layout uses the Tailwind md breakpoint and mobile SSR snapshot', () => {
  assert.equal(SETTINGS_DESKTOP_MEDIA_QUERY, '(min-width: 768px)')
  assert.equal(getSettingsServerSnapshot(), false)
})

test('settings focus restoration requires a connected and visibly laid out trigger', () => {
  assert.equal(shouldRestoreSettingsFocus(true, 1), true)
  assert.equal(shouldRestoreSettingsFocus(false, 1), false)
  assert.equal(shouldRestoreSettingsFocus(true, 0), false)
})
