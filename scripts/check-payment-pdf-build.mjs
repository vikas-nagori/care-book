// Run after next build. A full node_modules checkout hides missing deployment assets.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const tracePath = path.join(root, '.next/server/app/api/billing/payment-due/[patientId]/pdf/route.js.nft.json')
const trace = JSON.parse(await readFile(tracePath, 'utf8'))
const sandbox = await mkdtemp(path.join(tmpdir(), 'care-book-pdf-build-'))

try {
  for (const file of trace.files) {
    const source = path.resolve(path.dirname(tracePath), file)
    const relative = path.relative(root, source)
    assert(!relative.startsWith('..') && !path.isAbsolute(relative), 'Trace must stay inside the project')
    const destination = path.join(sandbox, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  // Import from the isolated trace, with no access to the checkout's dependencies.
  const smokePath = path.join(sandbox, 'smoke.cjs')
  await writeFile(smokePath, `
    const assert = require('node:assert/strict')
    const { createElement } = require('react')
    async function main() {
      const { Document, Page, Text, renderToBuffer } = await import('@react-pdf/renderer')
      const buffer = await renderToBuffer(createElement(Document, null,
        createElement(Page, { size: 'A4' },
          createElement(Text, { style: { fontFamily: 'Helvetica' } }, 'Payment summary'),
          createElement(Text, { style: { fontFamily: 'Helvetica-Bold' } }, 'Total due: INR 500.00'),
        ),
      ))
      assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
      assert(buffer.length > 500)
      console.log('Payment PDF renders using only the production route trace.')
    }
    main().catch(error => { console.error(error); process.exitCode = 1 })
  `)
  execFileSync(process.execPath, [smokePath], {
    cwd: sandbox,
    env: { ...process.env, NODE_ENV: 'production', NODE_PATH: '' },
    stdio: 'inherit',
    timeout: 30_000,
  })
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
