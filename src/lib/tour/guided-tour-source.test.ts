import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const tourSource = readFileSync(
  join(process.cwd(), 'src/components/tour/guided-tour.tsx'),
  'utf8',
)

test('guided tour resolves its device through the mobile-first policy', () => {
  assert.match(tourSource, /resolveTourDevice\(isDesktopViewport, deviceOverride\)/)
  assert.match(tourSource, /const isMobile = device === 'mobile'/)
  assert.doesNotMatch(tourSource, /hasMobile|chapterHasMobile|effectiveMobile/)
})

test('entering a mobile viewport clears any desktop-session override', () => {
  assert.match(
    tourSource,
    /useEffect\(\(\) => \{\s*if \(!isDesktopViewport\) setDeviceOverride\(null\)\s*\}, \[isDesktopViewport\]\)/,
  )
})

test('device preview controls are available only on desktop viewports', () => {
  assert.match(tourSource, /\{isDesktopViewport \? \([\s\S]*Desktop[\s\S]*Mobile[\s\S]*\) : null\}/)
})

test('mobile artwork lookup is exhaustive with no desktop fallback', () => {
  assert.match(tourSource, /isMobile\s*\? MOBILE_MOCKUPS\[current\.id\]\s*:\s*DESKTOP_MOCKUPS\[current\.id\]/)
})
