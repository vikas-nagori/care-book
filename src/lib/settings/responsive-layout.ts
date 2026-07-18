export const SETTINGS_DESKTOP_MEDIA_QUERY = '(min-width: 768px)'

export function getSettingsServerSnapshot() {
  return false
}

export function shouldRestoreSettingsFocus(isConnected: boolean, clientRectCount: number) {
  return isConnected && clientRectCount > 0
}
