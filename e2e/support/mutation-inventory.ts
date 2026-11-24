// Source inventory behind the mutation manifest guard (mutation-manifest.test.ts).
//
// Finds every place the app can write: server action exports and the client files that call
// them, native `<form action>` bindings, direct client Supabase writes and auth calls, and client
// `fetch('/api/…', { method: 'POST' })`. Regex-based on purpose, like the call-site guard in
// src/lib/actions/server-action-call-sites.test.ts whose walker and import resolver this mirrors:
// the code style here is uniform enough, and the non-vacuity floor in the test catches a
// discoverer that silently stops matching.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export type MutationKind = 'server-action' | 'form-action' | 'supabase' | 'fetch'

export type DiscoveredSurface = {
  /** `<actions file>#<export>@<client file>`, `supabase:<table>.<op>@<file>`, `supabase:auth.<method>@<file>`, `fetch:POST <path>@<file>`; an action with no caller is `<actions file>#<export>`. */
  id: string
  kind: MutationKind
  /** The file a user's tap reaches first: the client component (empty for an uncalled export). */
  callSite: string
}

export type SourceInventory = {
  surfaces: DiscoveredSurface[]
  /** Every export of a `'use server'` module, as `<file>#<name>`. */
  actionExports: string[]
  /** Number of `callServerAction(() => X(` call sites (before de-duplicating per file). */
  callServerActionSites: number
  /** `'use client'` files that render a `<form` or an `onSubmit=` handler. */
  clientFormFiles: string[]
  /** Files (relative) that import `name` from the action module `file`, excluding tests. */
  importersOf(actionExport: string): string[]
  /** Non-test source files (relative paths) and their text. */
  sources: ReadonlyMap<string, string>
}

/** Endpoints a client POSTs to that are not user mutations (fire-and-forget telemetry). */
export const NON_MUTATION_ENDPOINTS = ['/api/telemetry'] as const

const DIRECTIVE = (kind: 'client' | 'server') => new RegExp(`^\\s*['"]use ${kind}['"]`)
const AUTH_METHODS = ['signInWithPassword', 'updateUser', 'resetPasswordForEmail', 'signOut'] as const

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full)
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [full] : []
  })
}

function stripExtension(file: string): string {
  return file.replace(/\.(ts|tsx)$/, '')
}

export function inventorySource(root: string): SourceInventory {
  const src = path.join(root, 'src')
  const rel = (file: string) => path.relative(root, file).split(path.sep).join('/')
  const files = walk(src)
  const sources = new Map(files.map((file) => [rel(file), readFileSync(file, 'utf8')]))
  const isClient = (file: string) => DIRECTIVE('client').test(sources.get(file) ?? '')
  const isServerModule = (file: string) => DIRECTIVE('server').test(sources.get(file) ?? '')
  const byStem = new Map([...sources.keys()].map((file) => [stripExtension(file), file]))

  const resolveImport = (fromFile: string, specifier: string): string | null => {
    let target: string
    if (specifier.startsWith('@/')) target = `src/${specifier.slice(2)}`
    else if (specifier.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
    else return null
    return byStem.get(stripExtension(target)) ?? byStem.get(`${stripExtension(target)}/index`) ?? null
  }

  /** local name -> { module, exported name } for every named import of this file. */
  const importsOf = (file: string) => {
    const result = new Map<string, { module: string; name: string }>()
    for (const match of (sources.get(file) ?? '').matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const target = resolveImport(file, match[2])
      if (!target) continue
      for (const part of match[1].split(',')) {
        const spec = part.trim()
        if (!spec || spec.startsWith('type ')) continue
        const [imported, local] = spec.split(/\s+as\s+/).map((value) => value.trim())
        result.set(local ?? imported, { module: target, name: imported })
      }
    }
    return result
  }

  const serverModules = [...sources.keys()].filter(isServerModule)
  const actionExports = serverModules.flatMap((actionModule) => {
    const source = sources.get(actionModule)!
    const names = [
      ...[...source.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((match) => match[1]),
      ...[...source.matchAll(/export\s+const\s+(\w+)\s*=\s*async\b/g)].map((match) => match[1]),
    ]
    return names.map((name) => `${actionModule}#${name}`)
  })
  const actionExportSet = new Set(actionExports)
  const serverActionFor = (file: string, local: string): string | null => {
    const imported = importsOf(file).get(local)
    if (!imported) return null
    const key = `${imported.module}#${imported.name}`
    return actionExportSet.has(key) ? key : null
  }

  const surfaces = new Map<string, DiscoveredSurface>()
  const add = (surface: DiscoveredSurface) => surfaces.set(surface.id, surface)
  const calledActions = new Set<string>()
  let callServerActionSites = 0

  // 1. callServerAction(() => X(…)) in any file.
  for (const [file, source] of sources) {
    if (file === 'src/lib/actions/call-server-action.ts') continue
    for (const match of source.matchAll(/callServerAction\(\s*\(\)\s*=>\s*(\w+)\s*\(/g)) {
      const action = serverActionFor(file, match[1])
      if (!action) continue
      callServerActionSites += 1
      calledActions.add(action)
      add({ id: `${action}@${file}`, kind: 'server-action', callSite: file })
    }
  }

  // 2. <form action={X}> / formAction={X}, where X is a server action imported here or a prop
  //    that some file binds to one (`logoutAction={logoutFromSettings}`), followed transitively.
  const propBindings = new Map<string, Set<string>>()
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/\b(\w+)=\{(\w+)\}/g)) {
      const [, prop, value] = match
      const target = serverActionFor(file, value) ?? `prop:${value}`
      const set = propBindings.get(prop) ?? new Set<string>()
      set.add(target)
      propBindings.set(prop, set)
    }
  }
  const resolveProp = (prop: string, seen = new Set<string>()): string[] => {
    if (seen.has(prop)) return []
    seen.add(prop)
    return [...(propBindings.get(prop) ?? [])].flatMap((target) =>
      target.startsWith('prop:') ? resolveProp(target.slice(5), seen) : [target])
  }
  for (const [file, source] of sources) {
    const bound = [
      ...[...source.matchAll(/<form\b[^>]*?\baction=\{(\w+)\}/g)].map((match) => match[1]),
      ...[...source.matchAll(/\bformAction=\{(\w+)\}/g)].map((match) => match[1]),
    ]
    for (const identifier of bound) {
      const direct = serverActionFor(file, identifier)
      for (const action of direct ? [direct] : resolveProp(identifier)) {
        calledActions.add(action)
        add({ id: `${action}@${file}`, kind: 'form-action', callSite: file })
      }
    }
  }

  // 3. Direct client writes to Supabase tables and auth.
  for (const [file, source] of sources) {
    if (!isClient(file)) continue
    for (const match of source.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)\s*\.(insert|update|delete|upsert)\s*\(/g)) {
      add({ id: `supabase:${match[1]}.${match[2]}@${file}`, kind: 'supabase', callSite: file })
    }
    for (const match of source.matchAll(new RegExp(`\\.auth\\.(${AUTH_METHODS.join('|')})\\s*\\(`, 'g'))) {
      add({ id: `supabase:auth.${match[1]}@${file}`, kind: 'supabase', callSite: file })
    }
  }

  // 4. fetch('/api/…', { method: 'POST' }) outside server code, attributed to the client file
  //    itself or to every client file that imports the helper making the call.
  const importersOfFile = (target: string) => [...sources.keys()].filter((file) =>
    [...importsOf(file).values()].some((imported) => imported.module === target))
  for (const [file, source] of sources) {
    if (isServerModule(file) || file.startsWith('src/app/api/') || /\/route\.ts$/.test(file)) continue
    for (const match of source.matchAll(/fetch\(\s*(?:'(\/api\/[^']*)'|"(\/api\/[^"]*)"|`(\/api\/[^`]*)`)/g)) {
      const options = source.slice(match.index! + match[0].length, match.index! + match[0].length + 400)
      if (!/method:\s*['"]POST['"]/.test(options.split(/\bfetch\(/)[0])) continue
      const literal = match[1] ?? match[2] ?? match[3]
      const endpoint = literal.replace(/\$\{\s*(\w+)\s*\}/g, '[$1]').replace(/\$\{[^}]*\}/g, '[…]')
      if (NON_MUTATION_ENDPOINTS.some((ignored) => endpoint.startsWith(ignored))) continue
      const callers = isClient(file) ? [file] : importersOfFile(file).filter(isClient)
      for (const caller of callers) {
        add({ id: `fetch:POST ${endpoint}@${caller}`, kind: 'fetch', callSite: caller })
      }
    }
  }

  // 5. Exports nobody calls: the manifest must declare them `unused`.
  for (const action of actionExports) {
    if (!calledActions.has(action)) add({ id: action, kind: 'server-action', callSite: '' })
  }

  const clientFormFiles = [...sources.keys()]
    .filter((file) => isClient(file) && /<form\b|onSubmit=/.test(sources.get(file)!))
    .sort()

  return {
    surfaces: [...surfaces.values()].sort((a, b) => a.id.localeCompare(b.id)),
    actionExports,
    callServerActionSites,
    clientFormFiles,
    importersOf(actionExport: string) {
      const [actionModule, name] = actionExport.split('#')
      return [...sources.keys()].filter((file) => file !== actionModule
        && [...importsOf(file).entries()].some(([, imported]) => imported.module === actionModule && imported.name === name))
    },
    sources,
  }
}
