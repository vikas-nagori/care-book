'use client'

import { useRef } from 'react'

/** One idempotency key per booking intent, so a retried submit can't double-book. */
export function useRequestIds() {
  const ids = useRef(new Map<string, string>())
  return {
    getRequestId(intent: string) {
      const existing = ids.current.get(intent)
      if (existing) return existing
      const id = crypto.randomUUID()
      ids.current.set(intent, id)
      return id
    },
    clearRequestId(intent: string) {
      ids.current.delete(intent)
    },
  }
}
