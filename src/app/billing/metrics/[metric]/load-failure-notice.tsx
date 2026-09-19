// Shown in place of a figure when the read behind it failed. A billing screen that answers a failed
// query with "₹0 · no records" is indistinguishable from one reporting a genuinely quiet month, and
// a wrong number stated confidently is worse than an admitted gap.
export function LoadFailureNotice({ subject }: { subject: string }) {
  return (
    <div
      role="alert"
      style={{
        textAlign: 'center', padding: '40px 20px', fontSize: 13,
        color: 'var(--ph-bad)', background: 'var(--ph-surface)',
        border: '1px solid var(--ph-line)', borderRadius: 10,
      }}
    >
      {subject} could not be loaded. Refresh to try again.
    </div>
  )
}
