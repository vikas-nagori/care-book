const TAG = '[CareBook]'

export const logger = {
  error: (context: string, error: unknown, meta?: Record<string, unknown>) =>
    console.error(`${TAG} [${context}]`, error instanceof Error ? error.message : error, meta ?? ''),
  warn: (context: string, message: string, meta?: Record<string, unknown>) =>
    console.warn(`${TAG} [${context}]`, message, meta ?? ''),
  info: (context: string, message: string, meta?: Record<string, unknown>) =>
    console.log(`${TAG} [${context}]`, message, meta ?? ''),
}
