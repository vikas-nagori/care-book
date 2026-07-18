import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()

function readSource(path: string) {
  const absolutePath = join(root, path)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}

function sha256(path: string) {
  const absolutePath = join(root, path)
  return existsSync(absolutePath)
    ? createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
    : ''
}

function getTrackedTsxSources() {
  return execFileSync('git', ['ls-files', '--', 'src/app', 'src/components'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((path) => path.endsWith('.tsx'))
}

const expectedAssetHashes: Record<string, string> = {
  'src/app/favicon.ico': 'ed4eeeee8f1065e308607d761f8dcf4d4df7f8758fe9b01d4fe00682b96c9cbe',
  'public/icons/icon-16.png': '471730d5cb809b7945614186b2ab4c354fcfb5582d1c5e7a53cf7c8130b1bad1',
  'public/icons/icon-32.png': 'b7d6b1747784766b12c8fe52098cfc9d857992d5595282c34e85469e0f32624b',
  'public/icons/icon-180.png': 'bbd88e92b2636ecec72dfdf59fd2a016e14b8314e1bea9be1190e3a5ea20992c',
  'public/icons/icon-192.png': '5fe475e33dda3c586bce4e12ed786a1f4d35f8b7c6c20ad1bb7d879c52bfdca8',
  'public/icons/icon-512.png': 'a14fe03453170ebac6ba1de90931caf9d56b34b1654134c58a0cda640b22422f',
  'public/icons/icon.svg': '68bf9d6023612f23fcd5c9817048eaa07405264a58060f5ae1f609997ee31cc8',
}

test('brand assets match the supplied artwork byte-for-byte', () => {
  for (const [path, expectedHash] of Object.entries(expectedAssetHashes)) {
    assert.equal(sha256(path), expectedHash, path)
  }
})

test('brand component uses the supplied SVG with a decorative lockup mark', () => {
  const brandSource = readSource('src/components/brand/brand.tsx')

  assert.match(brandSource, /from 'next\/image'/)
  assert.match(brandSource, /src="\/icons\/icon\.svg"/)
  assert.match(brandSource, /export function BrandMark/)
  assert.match(brandSource, /export function BrandLockup/)
  assert.match(brandSource, /alt=""/)
  assert.match(brandSource, />\s*Care-Book\s*</)
  assert.match(brandSource, /preload\?: boolean/)
  assert.match(brandSource, /preload=\{preload\}/)
  assert.doesNotMatch(brandSource, /\bpriority\b/)
})

test('brand identity appears only on the approved chrome and auth surfaces', () => {
  const brandedSourcePaths = getTrackedTsxSources()
    .filter((path) => /\bBrand(?:Mark|Lockup)\b/.test(readSource(path)))
    .sort()
  const sidebarSource = readSource('src/components/layout/sidebar.tsx')
  const loginSource = readSource('src/app/login/page.tsx')
  const onboardingSource = readSource('src/app/clinic-onboarding/clinic-onboarding-form.tsx')
  const inviteSource = readSource('src/app/auth/complete-invite/complete-invite-form.tsx')
  const updatePasswordSource = readSource('src/app/auth/update-password/update-password-form.tsx')

  assert.deepEqual(brandedSourcePaths, [
    'src/app/auth/complete-invite/complete-invite-form.tsx',
    'src/app/auth/update-password/update-password-form.tsx',
    'src/app/clinic-onboarding/clinic-onboarding-form.tsx',
    'src/app/login/page.tsx',
    'src/components/brand/brand.tsx',
    'src/components/layout/sidebar.tsx',
  ])
  assert.match(sidebarSource, /<BrandMark size=\{28\}/)
  assert.doesNotMatch(sidebarSource, />\s*अ\s*</)
  assert.equal((loginSource.match(/<BrandLockup/g) ?? []).length, 2)
  assert.match(onboardingSource, /<BrandLockup/)
  assert.match(inviteSource, /<BrandLockup/)
  assert.match(updatePasswordSource, /<BrandLockup/)
  assert.doesNotMatch(
    brandedSourcePaths.map((path) => readSource(path)).join('\n'),
    /\bpriority\b/,
  )
})

test('metadata and manifest declare the Care-Book PWA identity', () => {
  const layoutSource = readSource('src/app/layout.tsx')
  const manifest = JSON.parse(readSource('public/manifest.json'))

  assert.match(layoutSource, /themeColor: '#2f5d5a'/)
  assert.match(layoutSource, /icons:/)
  assert.doesNotMatch(layoutSource, /\/favicon\.ico/)
  assert.match(layoutSource, /\/icons\/icon\.svg/)
  assert.match(layoutSource, /\/icons\/icon-16\.png/)
  assert.match(layoutSource, /\/icons\/icon-32\.png/)
  assert.match(layoutSource, /\/icons\/icon-180\.png/)
  assert.equal((layoutSource.match(/rel="manifest"/g) ?? []).length, 0)

  assert.equal(manifest.name, 'Care-Book')
  assert.equal(manifest.short_name, 'Care-Book')
  assert.equal(manifest.background_color, '#faf8f5')
  assert.equal(manifest.theme_color, '#2f5d5a')
  assert.deepEqual(manifest.icons, [
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
  ])
})
