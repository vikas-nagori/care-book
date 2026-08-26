'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { OwnerCredentials } from '@/lib/supabase/types'

type TempPasswordDialogProps = {
  credentials: OwnerCredentials | null
  onClose: () => void
}

/**
 * One-time display of a freshly issued temporary password. The password only exists in this
 * dialog's props — it is never persisted — so closing the dialog is the last chance to copy it.
 */
export function TempPasswordDialog({ credentials, onClose }: TempPasswordDialogProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copyPassword() {
    if (!credentials) return
    try {
      await navigator.clipboard.writeText(credentials.tempPassword)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <Dialog
      open={credentials !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopyState('idle')
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password issued</DialogTitle>
          <DialogDescription>
            This password is shown only once — copy it and share it with the owner directly (for
            example over WhatsApp). They will be asked to set their own password on first login.
          </DialogDescription>
        </DialogHeader>
        {credentials && (
          <div className="space-y-2">
            <p className="break-all text-sm text-muted-foreground">{credentials.email}</p>
            <p
              data-testid="temp-password"
              className="select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-base"
            >
              {credentials.tempPassword}
            </p>
            {copyState === 'failed' && (
              <p className="text-sm text-destructive">
                Copying failed — select the password above and copy it manually.
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={copyPassword}>
            {copyState === 'copied' ? 'Copied!' : 'Copy password'}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setCopyState('idle')
              onClose()
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
