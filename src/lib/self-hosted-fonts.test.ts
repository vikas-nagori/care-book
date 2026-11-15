import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// The build used to download Inter and JetBrains Mono from Google through next/font/google, and CI
// failed intermittently whenever Google returned a malformed stylesheet. The fonts are now committed
// and declared in src/app/fonts/fonts.css; these checks keep the build offline-safe.

const root = process.cwd()
const fontsDir = join(root, 'src/app/fonts')
const fontsCss = readFileSync(join(fontsDir, 'fonts.css'), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path)
    return /\.(ts|tsx|js|jsx|mjs|css)$/.test(entry) ? [path] : []
  })
}

test('nothing fetches fonts from Google at build or run time', () => {
  const offenders = sourceFiles(join(root, 'src'))
    .filter((file) => !file.endsWith('self-hosted-fonts.test.ts'))
    .filter((file) => /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(file, 'utf8')))
  assert.deepEqual(offenders, [])
})

test('every @font-face points at a committed woff2 file', () => {
  const urls = [...fontsCss.matchAll(/url\("\.\/([^"]+)"\)/g)].map((match) => match[1])
  assert.equal(urls.length, 19, 'Inter: 7 subsets; JetBrains Mono: 6 subsets x weights 400 and 500')
  for (const file of new Set(urls)) {
    assert.ok(file.endsWith('.woff2'), file)
    assert.ok(existsSync(join(fontsDir, file)), `missing ${file}`)
  }
  assert.equal((fontsCss.match(/@font-face \{/g) ?? []).length, 21, '19 web-font faces + 2 metric-matched fallbacks')
})

test('the CSS variables the design system reads are defined', () => {
  assert.match(fontsCss, /--font-sans: "Inter", "Inter Fallback";/)
  assert.match(fontsCss, /--font-mono: "JetBrains Mono", "JetBrains Mono Fallback";/)
  assert.match(readFileSync(join(root, 'src/app/layout.tsx'), 'utf8'), /import '\.\/fonts\/fonts\.css'/)
})

test('Indian rupee sign is covered by a self-hosted face', () => {
  // ₹ (U+20B9) sits in the latin-ext range; dropping that subset would render amounts in Arial.
  const latinExt = fontsCss.split('@font-face').find((face) => face.includes('inter-latin-ext.woff2')) ?? ''
  assert.match(latinExt, /u\+20ad-20c4/)
})

test('the font licences ship alongside the fonts', () => {
  for (const licence of ['Inter-OFL.txt', 'JetBrainsMono-OFL.txt']) {
    assert.match(readFileSync(join(fontsDir, licence), 'utf8'), /SIL Open Font License, Version 1\.1/)
  }
})
