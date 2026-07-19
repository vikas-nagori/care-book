export type TourMockupDevice = 'desktop' | 'mobile'

export function resolveTourDevice(
  isDesktopViewport: boolean,
  desktopOverride: TourMockupDevice | null,
): TourMockupDevice {
  if (!isDesktopViewport) return 'mobile'
  return desktopOverride ?? 'desktop'
}
