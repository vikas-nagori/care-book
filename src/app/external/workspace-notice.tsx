import type { ReactNode } from 'react'

export function WorkspaceNotice({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-dashed bg-card px-5 py-10 text-center">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {children}
    </div>
  )
}
