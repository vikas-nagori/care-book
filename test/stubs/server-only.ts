// `server-only` is supplied by Next.js at build time and has no resolvable entry under vitest.
// Component tests that exercise server modules alias the import here so the module graph loads.
export {}
