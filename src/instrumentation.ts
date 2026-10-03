import type { Instrumentation } from 'next'
import { logger } from '@/lib/logger'

export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  // Use framework route/type metadata, never raw URLs, headers or exception payloads.
  logger.error('runtime/request', error, {
    routerKind: context.routerKind,
    routeType: context.routeType,
    routePattern: context.routePath,
    correlationId: crypto.randomUUID(),
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
  })
}
