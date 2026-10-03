import { expect, it, vi } from 'vitest'
import { onRequestError } from '@/instrumentation'

it('distinguishes server route patterns without logging raw URLs or credentials', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const routePath of ['/patients/[id]', '/schedule/[id]']) {
    onRequestError(new TypeError('Synthetic Patient'), {
      method: 'GET', path: '/patients/private-id?name=Synthetic+Patient', headers: { authorization: 'Bearer secret' },
    }, { routePath, routeType: 'render', routerKind: 'App Router', revalidateReason: undefined })
  }
  const events = vi.mocked(console.error).mock.calls.map(args => JSON.parse(String(args[0])))
  expect(events.map(event => event.meta.routePattern)).toEqual(['/patients/[id]', '/schedule/[id]'])
  const output = JSON.stringify(events)
  expect(output).not.toContain('Synthetic')
  expect(output).not.toContain('private-id')
  expect(output).not.toContain('secret')
})
