import { LoaderCircle } from 'lucide-react'
import { ExternalWorkspaceShell } from './workspace-shell'

export default function LoadingExternalWorkspace() {
  return (
    <ExternalWorkspaceShell>
      <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        Loading your workspace…
      </div>
    </ExternalWorkspaceShell>
  )
}
