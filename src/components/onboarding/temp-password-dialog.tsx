'use client'

import { formatMobileNumber } from '@/lib/auth/mobile-number'
import { useState, useSyncExternalStore } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { buildTempPasswordShareText, isShareCancelled } from '@/lib/onboarding/temp-password-share'
import type { TempPasswordCredentials } from '@/lib/supabase/types'

type TempPasswordDialogProps = {
  credentials: TempPasswordCredentials | null
  onClose: () => void
}

type HandoverStatus = 'idle' | 'shared' | 'copied' | 'copy-failed'

const TITLE = 'Temporary password issued'
const DESCRIPTION =
  'This password is shown only once. Share it with them — they sign in with it, then set their own password.'

// Mobile is the primary interface, so the phone layout (a bottom sheet, like every other
// settings flow there) is the default and the server snapshot.
const DESKTOP_MEDIA_QUERY = '(min-width: 768px)'

function subscribeToViewport(onStoreChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY)
  mediaQuery.addEventListener('change', onStoreChange)
  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

function getIsDesktop() {
  return typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_MEDIA_QUERY).matches
}

function getServerIsDesktop() {
  return false
}

function canUseShareSheet() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/**
 * One-time hand-over of a freshly issued temporary password. The password only exists in this
 * component's props — it is never persisted — so it leads with getting the login details to the
 * person: the phone's share sheet (WhatsApp, SMS…) where available, otherwise copying a ready
 * message. Tapping outside or pressing Escape cannot dismiss it until the details were shared or
 * copied; Done and the close button still can, as deliberate choices.
 */
export function TempPasswordDialog({ credentials, onClose }: TempPasswordDialogProps) {
  const isDesktop = useSyncExternalStore(subscribeToViewport, getIsDesktop, getServerIsDesktop)
  const [status, setStatus] = useState<HandoverStatus>('idle')
  const handedOver = status === 'shared' || status === 'copied'
  const canShare = credentials !== null && canUseShareSheet()

  function close() {
    setStatus('idle')
    onClose()
  }

  function getShareText() {
    return credentials ? buildTempPasswordShareText(credentials, window.location.origin) : ''
  }

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(getShareText())
      setStatus('copied')
    } catch {
      setStatus('copy-failed')
    }
  }

  async function shareDetails() {
    try {
      await navigator.share({ title: 'Care-Book login', text: getShareText() })
      setStatus('shared')
    } catch (error) {
      if (isShareCancelled(error)) return
      await copyDetails()
    }
  }

  function guardDismiss(event: Event) {
    if (!handedOver) event.preventDefault()
  }

  const body = credentials && (
    <div className="space-y-3">
      <div className="rounded-[12px] border border-[var(--ph-line)] bg-[var(--ph-surface)] p-3.5">
        {credentials.mobileNumber ? (
          <>
            <p className="text-[11.5px] text-[var(--ph-ink-4)]">Mobile number (sign-in)</p>
            <p data-testid="temp-login-mobile" className="text-[14px] font-medium text-[var(--ph-ink)]">
              {formatMobileNumber(credentials.mobileNumber)}
            </p>
          </>
        ) : (
          <>
            <p className="text-[11.5px] text-[var(--ph-ink-4)]">Email</p>
            <p className="break-all text-[14px] font-medium text-[var(--ph-ink)]">{credentials.email}</p>
          </>
        )}
        <p className="mt-3 text-[11.5px] text-[var(--ph-ink-4)]">Temporary password</p>
        <p
          data-testid="temp-password"
          className="select-all break-all font-mono text-[20px] font-semibold tracking-wide text-[var(--ph-ink)]"
        >
          {credentials.tempPassword}
        </p>
      </div>
      {status === 'copy-failed' && (
        <p role="alert" className="text-sm text-destructive">
          Copying failed — select the password above and copy it manually.
        </p>
      )}
      {handedOver && (
        <p role="status" className="text-sm text-[var(--ph-ok)]">
          {status === 'shared'
            ? 'Login details shared.'
            : 'Login details copied — paste them into WhatsApp or a text message.'}
        </p>
      )}
    </div>
  )

  const actions = (
    <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
      {canShare && (
        <Button type="button" className="h-11 w-full md:w-auto" onClick={shareDetails}>
          <Share2 size={16} /> Share login
        </Button>
      )}
      <Button
        type="button"
        variant={canShare ? 'outline' : 'default'}
        className="h-11 w-full md:w-auto"
        onClick={copyDetails}
      >
        {status === 'copied' ? <Check size={16} /> : <Copy size={16} />}
        {status === 'copied' ? 'Copied' : 'Copy login details'}
      </Button>
      <Button type="button" variant="ghost" className="h-11 w-full md:mr-auto md:w-auto" onClick={close}>
        Done
      </Button>
    </div>
  )

  const open = credentials !== null
  const onOpenChange = (next: boolean) => {
    if (!next) close()
  }

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent onInteractOutside={guardDismiss} onEscapeKeyDown={guardDismiss}>
          <DialogHeader>
            <DialogTitle>{TITLE}</DialogTitle>
            <DialogDescription>{DESCRIPTION}</DialogDescription>
          </DialogHeader>
          {body}
          {actions}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" onInteractOutside={guardDismiss} onEscapeKeyDown={guardDismiss}>
        <SheetHeader className="mb-4 pr-10 text-left">
          <SheetTitle className="text-[16px] font-semibold text-[var(--ph-ink)]">{TITLE}</SheetTitle>
          <SheetDescription className="text-[13px] text-[var(--ph-ink-3)]">{DESCRIPTION}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4">
          {body}
          {actions}
        </div>
      </SheetContent>
    </Sheet>
  )
}
