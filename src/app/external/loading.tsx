import { LoaderCircle } from 'lucide-react'

export default function LoadingExternalWorkspace() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-4 py-12 text-sm text-muted-foreground md:p-6">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      Loading your workspace…
    </div>
  )
}
