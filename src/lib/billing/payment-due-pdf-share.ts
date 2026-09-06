export type PdfShareResult = 'shared' | 'cancelled' | 'unsupported' | 'failed'

export type PdfShareNavigator = {
  canShare?: (data?: { files?: File[] }) => boolean
  share?: (data: { files: File[] }) => Promise<void>
}

function supportsFileShare(file: File, navigatorLike: PdfShareNavigator | undefined) {
  if (!navigatorLike?.share || !navigatorLike.canShare) return false
  try {
    return navigatorLike.canShare({ files: [file] })
  } catch {
    return false
  }
}

export function canSharePdf(file: File, navigatorLike?: PdfShareNavigator) {
  const target = navigatorLike ?? (typeof navigator === 'undefined' ? undefined : navigator)
  return supportsFileShare(file, target)
}

export async function sharePdf(file: File, navigatorLike?: PdfShareNavigator): Promise<PdfShareResult> {
  const target = navigatorLike ?? (typeof navigator === 'undefined' ? undefined : navigator)
  if (!supportsFileShare(file, target)) return 'unsupported'

  try {
    if (!target) return 'unsupported'
    await target.share!({ files: [file] })
    return 'shared'
  } catch (error) {
    if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled'
    return 'failed'
  }
}
