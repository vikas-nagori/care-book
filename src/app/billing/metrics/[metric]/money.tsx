// Shared rupee figure for the billing drill-down screens. The currency sign sits in its own span so
// the design system can style it independently, which also means a testing-library text query sees
// just the digits.
export function Money({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`ph-money ${className}`}>
      <span className="rs">₹</span>
      {n.toLocaleString('en-IN')}
    </span>
  )
}
