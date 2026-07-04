import { Loader2 } from 'lucide-react'

export function LoadingSpinner() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: 200,
        width: '100%',
      }}
    >
      <Loader2
        className="animate-spin"
        size={28}
        style={{ color: 'var(--ph-accent)' }}
      />
      <span style={{ fontSize: 12.5, color: 'var(--ph-ink-4)' }}>Loading…</span>
    </div>
  )
}
