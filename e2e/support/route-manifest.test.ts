import assert from 'node:assert/strict'
import { access, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import test from 'node:test'

import { PAGE_ROUTE_MANIFEST } from './route-manifest.ts'

const appDirectory = join(process.cwd(), 'src', 'app')

async function inventoryPageRoutes(): Promise<string[]> {
  const routes: string[] = []

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })

    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        return
      }

      if (entry.name !== 'page.tsx') return

      const routeDirectory = relative(appDirectory, directory).split(sep).join('/')
      routes.push(routeDirectory ? `/${routeDirectory}` : '/')
    }))
  }

  await visit(appDirectory)
  return routes.sort()
}

test('every App Router page has exactly one E2E route declaration', async () => {
  const discoveredRoutes = await inventoryPageRoutes()
  const declaredRoutes = PAGE_ROUTE_MANIFEST.map((route) => route.pattern).sort()

  assert.deepEqual(declaredRoutes, discoveredRoutes)
})

test('every route declaration names an existing owning spec', async () => {
  const owners = [...new Set(PAGE_ROUTE_MANIFEST.map((route) => route.owner))]

  await Promise.all(owners.map(async (owner) => {
    assert.match(owner, /^e2e\/.+\.spec\.ts$/, `invalid route owner: ${owner}`)
    await access(join(process.cwd(), owner))
  }))
})
